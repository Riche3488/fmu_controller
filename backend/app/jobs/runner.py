"""JobManager: 잡마다 백그라운드 스레드 하나가 ParallelExecutor로 run들을 병렬 실행하고 진행 이벤트를 발행한다.
배치 잡은 목적함수를 계산하지 않는다 (값은 조회 시 최신 코드로 계산)."""
import asyncio
import itertools
import logging
import shutil
import threading
import time
import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

from ..config import Settings
from ..fmu.registry import get_extract_dir
from ..fmu.simulate import SimOutcome, SimTask, run_simulation
from ..models import Fmu, Job, ResourceCandidate, ResourceFile, Run, Variable, Variant, utcnow
from ..objectives.evaluator import Evaluator
from ..parallel.base import ParallelExecutor, TaskCancelled
from ..models import Objective
from ..objectives import store
from ..resources import variants
from ..schemas import BatchRequest, JobOut, OptimizationRequest, RunOut, SimSettings
from . import optimize
from .optimize import Optimization
from .sampling import generate_cases

log = logging.getLogger("app.jobs")

POLL_SEC = 0.25
TIMEOUT_ERROR = "timeout"
INTERRUPTED = "interrupted"
RESOURCE_PREP_ERROR = "resource 준비 실패"
ACTIVE = ("queued", "running")


class JobValidationError(ValueError):
    pass


class FmuNotFound(LookupError):
    pass


def job_out(job: Job) -> JobOut:
    return JobOut.model_validate(job)


def run_out(run: Run) -> RunOut:
    return RunOut.model_validate(run)


def mark_interrupted_jobs(session: Session) -> int:
    res = session.execute(
        update(Job).where(Job.status.in_(ACTIVE)).values(status="failed", error=INTERRUPTED, finished_at=utcnow())
    )
    session.commit()
    return res.rowcount or 0


def new_id() -> str:
    return uuid.uuid4().hex[:16]


@dataclass
class CaseSpec:
    index: int
    params: dict[str, Any]
    variant_id: str | None = None  # None = 원본 variant


@dataclass
class _Inflight:
    case: CaseSpec
    run_id: str
    started: float


@dataclass
class _JobCtx:
    cancel: threading.Event = field(default_factory=threading.Event)
    thread: threading.Thread | None = None


class JobManager:
    def __init__(self, settings: Settings, session_factory: sessionmaker[Session], executor: ParallelExecutor,
                 evaluator: Evaluator, sim_fn: Callable[[SimTask], SimOutcome] = run_simulation):
        self.settings = settings
        self.session_factory = session_factory
        self.executor = executor
        self.evaluator = evaluator
        self.sim_fn = sim_fn
        self._jobs: dict[str, _JobCtx] = {}
        self._subs: dict[str, set[tuple[asyncio.AbstractEventLoop, asyncio.Queue]]] = {}
        self._lock = threading.Lock()
        # 모든 잡이 공유하는 시뮬레이션 슬롯
        self._slots = threading.BoundedSemaphore(executor.max_workers)

    # ---------- 이벤트 ----------
    def subscribe(self, job_id: str, loop: asyncio.AbstractEventLoop) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        with self._lock:
            self._subs.setdefault(job_id, set()).add((loop, q))
        return q

    def unsubscribe(self, job_id: str, q: asyncio.Queue) -> None:
        with self._lock:
            subs = self._subs.get(job_id, set())
            for item in [s for s in subs if s[1] is q]:
                subs.discard(item)

    def _publish(self, job_id: str, event: dict) -> None:
        with self._lock:
            subs = list(self._subs.get(job_id, ()))
        for loop, q in subs:
            try:
                loop.call_soon_threadsafe(q.put_nowait, event)
            except RuntimeError:  # 루프 종료됨
                self.unsubscribe(job_id, q)

    def _publish_job(self, job: Job, kind: str = "progress") -> None:
        self._publish(job.id, {"type": kind, "job": job_out(job).model_dump(mode="json", by_alias=True)})

    # ---------- 검증 ----------
    def _validate_common(self, session: Session, fmu_id: str, names: list[str], record: list[str]) -> Fmu:
        fmu = session.get(Fmu, fmu_id)
        if not fmu:
            raise FmuNotFound(fmu_id)
        wanted = set(names) | set(record)
        found = set(session.scalars(select(Variable.name).where(Variable.fmu_id == fmu_id, Variable.name.in_(wanted))))
        missing = [n for n in [*names, *record] if n not in found]
        if missing:
            raise JobValidationError(f"FMU에 없는 변수: {', '.join(dict.fromkeys(missing))}")
        return fmu

    @staticmethod
    def _check_candidates(session: Session, fmu_id: str, path: str, ids: list[str]) -> None:
        if not ids:
            raise JobValidationError(f"resource 후보를 하나 이상 고르세요: {path}")
        if not session.get(ResourceFile, (fmu_id, path)):
            raise JobValidationError(f"resource 파일이 없습니다: {path}")
        for cid in ids:
            c = session.get(ResourceCandidate, cid)
            if not c or c.fmu_id != fmu_id or c.path != path:
                raise JobValidationError(f"{path}의 후보가 아닙니다: {cid}")

    @classmethod
    def _resolve_resources(cls, session: Session, fmu_id: str, sel: dict[str, list[str]]) -> list[str]:
        """resource 선택(path -> 후보 id 목록)의 직곱(path 정렬 순)을 variant id 목록으로. 선택이 없으면 원본 하나."""
        paths = sorted(sel)
        for path in paths:
            cls._check_candidates(session, fmu_id, path, sel[path])
        try:
            return [variants.ensure_variant(session, fmu_id, dict(zip(paths, combo))).id
                    for combo in itertools.product(*(sel[p] for p in paths))]
        except variants.InvalidAssignment as e:
            raise JobValidationError(str(e)) from e

    @staticmethod
    def _validate_sim(sim: SimSettings) -> None:
        if not sim.stop_time > sim.start_time:
            raise JobValidationError("종료 시간은 시작 시간보다 커야 합니다")
        if not sim.output_interval > 0:
            raise JobValidationError("출력 간격은 0보다 커야 합니다")

    # ---------- 배치 ----------
    def submit_batch(self, req: BatchRequest) -> Job:
        try:
            cases = generate_cases(req.params, req.sampling, req.n_samples)
        except ValueError as e:
            raise JobValidationError(str(e)) from e
        self._validate_sim(req.sim)
        with self.session_factory() as s:
            self._validate_common(s, req.fmu_id, [p.name for p in req.params] + list(req.fixed_params), req.record_variables)
            variant_ids = self._resolve_resources(s, req.fmu_id, req.resources)
            job = Job(id=new_id(), kind="batch", name=req.name, fmu_id=req.fmu_id, status="queued",
                      total=len(cases) * len(variant_ids),
                      config=req.model_dump(mode="json", by_alias=True), objective_snapshot=None)
            s.add(job)
            s.commit()
        # 파라미터 케이스(바깥) × resource 조합(안쪽)
        specs = iter([CaseSpec(i, {**req.fixed_params, **c}, vid)
                      for i, (c, vid) in enumerate(itertools.product(cases, variant_ids))])
        self._start(job, lambda: self._run_cases(job.id, req.fmu_id, req, specs))
        return job

    # ---------- 최적화 ----------
    def submit_optimization(self, req: OptimizationRequest) -> Job:
        if req.algorithm == "cmaes" and len(req.objectives) > 1:
            raise JobValidationError("CMA-ES는 단일 목적만 지원합니다")
        if req.algorithm == "gp" and not optimize.gp_available():
            raise JobValidationError('GP를 쓰려면 torch를 설치하세요 (pip install -e "backend[gp]")')
        search = {p: r.candidate_ids for p, r in req.resources.items() if r.mode == "search"}
        if any(len(ids) < 2 for ids in search.values()):
            raise JobValidationError("탐색할 후보를 2개 이상 고르세요")
        if search and req.algorithm == "cmaes":
            raise JobValidationError("CMA-ES는 파일 탐색(선택형 변수)을 지원하지 않습니다")
        for d in req.design_vars:
            if not d.min < d.max:
                raise JobValidationError(f"설계 변수 {d.name}: 최솟값은 최댓값보다 작아야 합니다")
        self._validate_sim(req.sim)
        with self.session_factory() as s:
            self._validate_common(s, req.fmu_id, [d.name for d in req.design_vars] + list(req.fixed_params),
                                  req.record_variables)
            for path, r in req.resources.items():
                self._check_candidates(s, req.fmu_id, path, r.candidate_ids if r.mode == "search" else [r.candidate_id])
            codes: dict[str, str] = {}
            snapshot: dict[str, dict] = {}
            for o in req.objectives:
                obj = s.get(Objective, o.objective_id)
                if not obj:
                    raise JobValidationError(f"목적함수를 찾을 수 없습니다: {o.objective_id}")
                # 제출 시점 코드로 최적화한다 (실행 중 편집되어도 일관성 유지). 잡에는 해시만 기록
                codes[obj.id], h = store.load(self.settings, obj.id)
                snapshot[obj.id] = {"name": obj.name, "codeHash": h}
            job = Job(id=new_id(), kind="optimization", name=req.name, fmu_id=req.fmu_id, status="queued",
                      total=req.n_trials, config=req.model_dump(mode="json", by_alias=True), objective_snapshot=snapshot)
            s.add(job)
            s.commit()
        def resolve_variant(assignment: dict[str, str]) -> str:
            with self.session_factory() as s:
                return variants.ensure_variant(s, req.fmu_id, assignment).id

        optimization = Optimization(req, codes, self.evaluator, resolve_variant)

        def target():
            self._set_running(job.id)
            finished = self.run_cases(job.id, req.fmu_id, req, optimization.cases(CaseSpec), optimization.on_done)
            self._finish(job.id, "done" if finished else "cancelled")

        self._start(job, target)
        return job

    def _start(self, job: Job, target: Callable[[], None]) -> None:
        ctx = _JobCtx()
        with self._lock:
            self._jobs[job.id] = ctx
        ctx.thread = threading.Thread(target=self._guard, args=(job.id, target), name=f"job-{job.id}", daemon=True)
        ctx.thread.start()

    def _guard(self, job_id: str, target: Callable[[], None]) -> None:
        try:
            target()
        except Exception as e:
            log.exception("job %s crashed", job_id)
            self._finish(job_id, "failed", error=f"{type(e).__name__}: {e}")
        finally:
            with self._lock:
                self._jobs.pop(job_id, None)

    def _set_running(self, job_id: str) -> None:
        with self.session_factory() as s:
            job = s.get(Job, job_id)
            job.status = "running"
            s.commit()
            self._publish_job(job)

    def _finish(self, job_id: str, status: str, error: str | None = None) -> None:
        with self.session_factory() as s:
            job = s.get(Job, job_id)
            if job.status not in ACTIVE:
                return
            job.status = status
            job.error = error
            job.finished_at = utcnow()
            s.commit()
            self._publish_job(job, "end")

    def _record(self, job_id: str, fmu_id: str, case: CaseSpec, run_id: str, out: SimOutcome | None, error: str | None,
                out_path: str) -> Run:
        ok = out is not None and out.ok
        with self.session_factory() as s:
            run = Run(id=run_id, job_id=job_id, fmu_id=fmu_id, index=case.index, params=case.params,
                      variant_id=case.variant_id or variants.original_variant_id(fmu_id),
                      status="ok" if ok else "failed", error=None if ok else (error or (out.error if out else None)),
                      elapsed_sec=out.elapsed_sec if out else 0.0, result_path=out_path if ok else None)
            s.add(run)
            job = s.get(Job, job_id)
            if ok:
                job.completed += 1
            else:
                job.failed += 1
            s.commit()
            self._publish(job_id, {"type": "run", "run": run_out(run).model_dump(mode="json", by_alias=True)})
            self._publish_job(job)
            return run

    def run_cases(self, job_id: str, fmu_id: str, req, cases: Iterator[CaseSpec],
                  on_done: Callable[[CaseSpec, Run], None] | None = None) -> bool:
        """케이스들을 병렬 실행. cases는 지연 생성 가능(최적화 ask). 취소되면 False.

        모든 잡이 공유하는 슬롯(_slots)을 얻은 뒤에만 제출하므로 제출 시각 ≈ 시작 시각이다
        (큐 대기 시간이 run 타임아웃에 포함되지 않는다)."""
        ctx = self._jobs[job_id]
        variant_dirs: dict[str | None, str] = {None: str(get_extract_dir(self.settings, fmu_id))}

        def variant_dir(vid: str | None) -> str:
            """variant 실행 폴더 (잡 스레드에서 처음 쓸 때 만든다)"""
            if vid not in variant_dirs:
                with self.session_factory() as s:
                    v = s.get(Variant, vid)
                    if v is None:
                        raise RuntimeError(f"variant를 찾을 수 없습니다: {vid}")
                    variant_dirs[vid] = str(variants.materialize(self.settings, s, v))
            return variant_dirs[vid]
        results_dir = self.settings.data_dir / "results" / job_id
        limit = max(1, min(req.workers, self.executor.max_workers))
        inflight: dict[Any, _Inflight] = {}
        exhausted = False
        gen = self.executor.generation

        def submit(case: CaseSpec) -> None:
            run_id = new_id()
            task = SimTask(fmu_id=fmu_id, extract_dir=variant_dir(case.variant_id), start_values=case.params, sim=req.sim,
                           record_variables=list(req.record_variables), out_path=str(results_dir / f"{run_id}.parquet"),
                           work_dir=str(self.settings.data_dir / "work" / run_id))
            inflight[self.executor.submit(self.sim_fn, task)] = _Inflight(case, run_id, time.monotonic())

        def drop(h) -> _Inflight:
            """실행 중 작업을 강제 취소하고 슬롯을 반납"""
            info = inflight.pop(h)
            self.executor.cancel(h, force=True)
            try:
                self.executor.result(h)
            except Exception:
                pass
            self._slots.release()
            shutil.rmtree(self.settings.data_dir / "work" / info.run_id, ignore_errors=True)
            return info

        try:
            while True:
                if ctx.cancel.is_set():
                    return False
                while not exhausted and len(inflight) < limit and self._slots.acquire(blocking=False):
                    try:
                        case = next(cases, None)
                    except BaseException:
                        self._slots.release()
                        raise
                    if case is None:
                        self._slots.release()
                        exhausted = True
                        continue
                    try:
                        submit(case)
                    except Exception as e:  # variant 폴더 준비 실패 등: 이 케이스만 실패로 기록하고 계속
                        self._slots.release()
                        log.exception("job %s: case %s could not be submitted", job_id, case.index)
                        run = self._record(job_id, fmu_id, case, new_id(), None,
                                           f"{RESOURCE_PREP_ERROR}: {type(e).__name__}: {e}", "")
                        if on_done:
                            on_done(case, run)
                if exhausted and not inflight:
                    return True
                if not inflight:  # 다른 잡이 슬롯을 모두 쓰는 중
                    time.sleep(POLL_SEC)
                    continue
                for h in self.executor.wait_any(list(inflight), timeout=POLL_SEC):
                    info = inflight.pop(h)
                    self._slots.release()
                    out_path = str(results_dir / f"{info.run_id}.parquet")
                    try:
                        out, err = self.executor.result(h), None
                    except TaskCancelled:
                        out, err = None, TIMEOUT_ERROR
                    except Exception as e:
                        out, err = None, f"{type(e).__name__}: {e}"
                    run = self._record(job_id, fmu_id, info.case, info.run_id, out, err, out_path)
                    if on_done:
                        on_done(info.case, run)
                if self.executor.generation != gen:
                    # Pool 폴백이 (어느 잡에서든) 강제 취소로 풀을 재시작하면 남은 run은 처음부터 다시 돈다
                    gen = self.executor.generation
                    now = time.monotonic()
                    for i in inflight.values():
                        i.started = now
                now = time.monotonic()
                for h in [h for h, i in inflight.items() if now - i.started > req.run_timeout_sec]:
                    info = drop(h)
                    gen = self.executor.generation  # 방금 우리가 일으킨 재시작
                    for i in inflight.values():
                        i.started = time.monotonic()
                    run = self._record(job_id, fmu_id, info.case, info.run_id, None, TIMEOUT_ERROR, "")
                    if on_done:
                        on_done(info.case, run)
        finally:
            # 정상 종료/취소/예외 어느 경우든 남은 작업을 정리한다
            for h in list(inflight):
                drop(h)

    def _run_cases(self, job_id: str, fmu_id: str, req, cases: Iterator[CaseSpec]) -> None:
        self._set_running(job_id)
        finished = self.run_cases(job_id, fmu_id, req, cases)
        self._finish(job_id, "done" if finished else "cancelled")

    # ---------- 제어 ----------
    def cancel(self, job_id: str) -> None:
        with self._lock:
            ctx = self._jobs.get(job_id)
        if ctx:
            ctx.cancel.set()
            if ctx.thread:
                ctx.thread.join(timeout=30)
        self._finish(job_id, "cancelled")

    def shutdown(self) -> None:
        with self._lock:
            ctxs = list(self._jobs.values())
        for c in ctxs:
            c.cancel.set()
        for c in ctxs:
            if c.thread:
                c.thread.join(timeout=30)
