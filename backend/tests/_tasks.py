"""병렬 실행 테스트용 작업 함수 (워커에서 import 가능해야 하므로 최상위 모듈에 둔다)."""
import os
import time


def sleep_and_return(sec: float, value):
    time.sleep(sec)
    return value


def boom(msg: str):
    raise ValueError(msg)


def hang():
    while True:
        time.sleep(0.1)


def pid() -> int:
    return os.getpid()


def fake_sim(task):
    """FMU 없이 SimTask를 흉내: start_values의 sleep/fail/hang 키로 동작 제어, 파라미터를 시계열 컬럼으로 기록."""
    import numpy as np

    from app.fmu.simulate import SimOutcome
    from app.results.storage import write_result

    t0 = time.perf_counter()
    sv = task.start_values
    if sv.get("hang"):
        hang()
    time.sleep(float(sv.get("sleep", 0.0)))
    if sv.get("fail"):
        return SimOutcome(ok=False, error="CVode: convergence failure", elapsed_sec=time.perf_counter() - t0)
    names = ["time", *sorted(k for k in sv if k not in ("sleep", "fail", "hang"))]
    arr = np.zeros(11, dtype=[(n, "f8") for n in names])
    arr["time"] = np.linspace(task.sim.start_time, task.sim.stop_time, 11)
    for n in names[1:]:
        arr[n] = float(sv[n])
    write_result(task.out_path, arr)
    return SimOutcome(ok=True, error=None, elapsed_sec=time.perf_counter() - t0, columns=names)


def resource_echo_sim(task):
    """resources/*.txt 파일 내용(숫자)을 같은 이름의 시계열 컬럼으로 기록 — variant 폴더가 맞는 파일을 담았는지 확인용."""
    from pathlib import Path

    import numpy as np

    from app.fmu.simulate import SimOutcome
    from app.results.storage import write_result

    files = sorted((Path(task.extract_dir) / "resources").glob("*.txt"))
    names = ["time", *(f.stem for f in files), *sorted(task.start_values)]
    arr = np.zeros(3, dtype=[(n, "f8") for n in names])
    for f in files:
        arr[f.stem] = float(f.read_text().strip())
    for k, v in task.start_values.items():
        arr[k] = float(v)
    write_result(task.out_path, arr)
    return SimOutcome(ok=True, error=None, elapsed_sec=0.0, columns=names)
