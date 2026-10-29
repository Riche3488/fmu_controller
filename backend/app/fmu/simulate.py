"""단일 FMU 시뮬레이션 — 워커 프로세스에서 실행되는 최상위(피클 가능) 함수."""
import os
import shutil
import time
from dataclasses import dataclass, field
from functools import lru_cache

from ..results.storage import write_result
from ..schemas import SimSettings


@dataclass
class SimTask:
    fmu_id: str
    extract_dir: str
    start_values: dict[str, float | bool]
    sim: SimSettings
    record_variables: list[str]
    out_path: str
    # run 전용 작업 디렉터리: 모델이 초기화 때 CWD에 파일(massList.csv)을 쓰므로 병렬 run끼리 분리해야 한다
    work_dir: str


@dataclass
class SimOutcome:
    ok: bool
    error: str | None
    elapsed_sec: float
    columns: list[str] = field(default_factory=list)


def _error_message(e: BaseException) -> str:
    lines = [ln for ln in str(e).strip().splitlines() if ln.strip()]
    return lines[-1] if lines else type(e).__name__


@lru_cache(maxsize=8)
def _model_description(extract_dir: str):
    """워커 프로세스마다 FMU별로 한 번만 파싱한다 (변수 5만여 개라 매 run 파싱은 비싸다)."""
    from fmpy import read_model_description

    md = read_model_description(extract_dir, validate=False)
    return md, frozenset(v.name for v in md.modelVariables)


def run_simulation(task: SimTask) -> SimOutcome:
    from fmpy import simulate_fmu

    t0 = time.perf_counter()
    cwd = os.getcwd()
    os.makedirs(task.work_dir, exist_ok=True)
    try:
        md, names = _model_description(task.extract_dir)
        # FMPy는 없는 변수의 start value를 조용히 무시하므로 직접 검증한다
        unknown = sorted(set(task.start_values) - names) + sorted(set(task.record_variables) - names)
        if unknown:
            raise ValueError(f"FMU에 없는 변수: {', '.join(unknown)}")
        os.chdir(task.work_dir)
        result = simulate_fmu(
            task.extract_dir,
            validate=False,
            model_description=md,
            fmi_type="ModelExchange",
            solver="CVode",
            start_time=task.sim.start_time,
            stop_time=task.sim.stop_time,
            relative_tolerance=task.sim.tolerance,
            output_interval=task.sim.output_interval,
            start_values=dict(task.start_values),
            output=list(task.record_variables) or None,
        )
        write_result(task.out_path, result)
        return SimOutcome(ok=True, error=None, elapsed_sec=time.perf_counter() - t0, columns=list(result.dtype.names))
    except Exception as e:
        return SimOutcome(ok=False, error=_error_message(e), elapsed_sec=time.perf_counter() - t0)
    finally:
        os.chdir(cwd)
        shutil.rmtree(task.work_dir, ignore_errors=True)
