"""JobManager: 잡마다 백그라운드 스레드 하나가 ParallelExecutor로 run들을 병렬 실행하고 진행 이벤트를 발행한다.
배치 잡은 목적함수를 계산하지 않는다 (값은 조회 시 최신 코드로 계산)."""
import asyncio
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
from ..models import Fmu, Job, Run, Variable, utcnow
from ..objectives.evaluator import Evaluator
from ..parallel.base import ParallelExecutor, TaskCancelled
from ..models import Objective
from ..objectives import store
from ..schemas import BatchRequest, JobOut, OptimizationRequest, RunOut, SimSettings
from .optimize import Optimization
from .sampling import generate_cases

log = logging.getLogger("app.jobs")

POLL_SEC = 0.25
TIMEOUT_ERROR = "timeout"
INTERRUPTED = "interrupted"
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
            job = Job(id=new_id(), kind="batch", name=req.name, fmu_id=req.fmu_id, status="queued", total=len(cases),
                      config=req.model_dump(mode="json", by_alias=True), objective_snapshot=None)
            s.add(job)
            s.commit()
        specs = iter([CaseSpec(i, {**req.fixed_params, **c}) for i, c in enumerate(cases)])
        self._start(job, lambda: self._run_cases(job.id, req.fmu_id, req, specs))
        return job

    # ---------- 최적화 ----------
    def submit_optimization(self, req: OptimizationRequest) -> Job:
        if req.algorithm == "cmaes" and len(req.objectives) > 1:
            raise JobValidationError("CMA-ES는 단일 목적만 지원합니다")
        for d in req.design_vars:
            if not d.min < d.max:
                raise JobValidationError(f"설계 변수 {d.name}: 최솟값은 최댓값보다 작아야 합니다")
        self._validate_sim(req.sim)
        with self.session_factory() as s:
            self._validate_common(s, req.fmu_id, [d.name for d in req.design_vars] + list(req.fixed_params),
                                  req.record_variables)
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
        optimization = Optimization(req, codes, self.evaluator)

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
        """케이스들을 병렬 실행. cases는 지연 생성 가능(최적화 ask). 취소되면 False."""
        ctx = self._jobs[job_id]
        extract_dir = str(get_extract_dir(self.settings, fmu_id))
        results_dir = self.settings.data_dir / "results" / job_id
        limit = max(1, min(req.workers, self.executor.max_workers))
        inflight: dict[Any, _Inflight] = {}
        exhausted = False

        def submit_next() -> bool:
            case = next(cases, None)
            if case is None:
                return False
            run_id = new_id()
            task = SimTask(fmu_id=fmu_id, extract_dir=extract_dir, start_values=case.params, sim=req.sim,
                           record_variables=list(req.record_variables), out_path=str(results_dir / f"{run_id}.parquet"),
                           work_dir=str(self.settings.data_dir / "work" / run_id))
            inflight[self.executor.submit(self.sim_fn, task)] = _Inflight(case, run_id, time.monotonic())
            return True

        while True:
            if ctx.cancel.is_set():
                for h in list(inflight):
                    self.executor.cancel(h, force=True)
                    try:
                        self.executor.result(h)
                    except Exception:
                        pass
                    shutil.rmtree(self.settings.data_dir / "work" / inflight.pop(h).run_id, ignore_errors=True)
                return False
            while not exhausted and len(inflight) < limit:
                if not submit_next():
                    exhausted = True
            if exhausted and not inflight:
                return True
            for h in self.executor.wait_any(list(inflight), timeout=POLL_SEC):
                info = inflight.pop(h)
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
            now = time.monotonic()
            overdue = [h for h, i in inflight.items() if now - i.started > req.run_timeout_sec]
            for h in overdue:
                info = inflight.pop(h)
                self.executor.cancel(h, force=True)
                try:
                    self.executor.result(h)
                except Exception:
                    pass
                shutil.rmtree(self.settings.data_dir / "work" / info.run_id, ignore_errors=True)
                run = self._record(job_id, fmu_id, info.case, info.run_id, None, TIMEOUT_ERROR, "")
                if on_done:
                    on_done(info.case, run)
            if overdue:
                # Pool 폴백은 취소 시 다른 run을 재시작하므로 시작 시각을 갱신
                now = time.monotonic()
                for i in inflight.values():
                    i.started = now

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
