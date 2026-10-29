import importlib.util
import logging
import sys
import time

import pytest

from app.parallel.base import TaskCancelled, create_executor
from tests._tasks import boom, hang, sleep_and_return

HAS_RAY = importlib.util.find_spec("ray") is not None
MODES = ["pool", pytest.param("ray", marks=pytest.mark.skipif(not HAS_RAY, reason="ray not installed"))]


@pytest.fixture(scope="module", params=MODES)
def executor(request):
    ex = create_executor(request.param, max_workers=4)
    # 워커 기동 시간을 측정에서 빼기 위한 워밍업
    hs = [ex.submit(sleep_and_return, 0.01, i) for i in range(4)]
    for h in hs:
        ex.result(h)
    yield ex
    ex.shutdown()


def wait_all(ex, handles, timeout=30.0):
    pending = list(handles)
    deadline = time.time() + timeout
    while pending:
        assert time.time() < deadline, "timeout waiting for tasks"
        done = ex.wait_any(pending, timeout=1.0)
        pending = [h for h in pending if h not in done]


def test_runs_in_parallel(executor):
    t = time.time()
    hs = [executor.submit(sleep_and_return, 0.5, i) for i in range(4)]
    wait_all(executor, hs)
    assert sorted(executor.result(h) for h in hs) == [0, 1, 2, 3]
    assert time.time() - t < 1.5


def test_task_exception_propagates(executor):
    h = executor.submit(boom, "boom")
    wait_all(executor, [h])
    with pytest.raises(ValueError, match="boom"):
        executor.result(h)


def test_force_cancel_kills_hung_task(executor):
    hung = executor.submit(hang)
    normal = executor.submit(sleep_and_return, 0.3, "ok")
    time.sleep(0.2)
    executor.cancel(hung, force=True)
    with pytest.raises(TaskCancelled):
        executor.result(hung)
    wait_all(executor, [normal])
    assert executor.result(normal) == "ok"


def test_executor_survives_after_cancel(executor):
    h = executor.submit(hang)
    time.sleep(0.1)
    executor.cancel(h, force=True)
    h2 = executor.submit(sleep_and_return, 0.05, 42)
    wait_all(executor, [h2])
    assert executor.result(h2) == 42


def test_wait_any_returns_cancelled_as_done(executor):
    h = executor.submit(hang)
    executor.cancel(h, force=True)
    assert executor.wait_any([h], timeout=1.0) == [h]


def test_auto_falls_back_to_pool(monkeypatch, caplog):
    monkeypatch.setitem(sys.modules, "app.parallel.ray_backend", None)
    with caplog.at_level(logging.WARNING):
        ex = create_executor("auto", 2)
    try:
        assert ex.name == "pool"
        assert "Ray" in caplog.text
    finally:
        ex.shutdown()


def test_explicit_ray_failure_raises(monkeypatch):
    monkeypatch.setitem(sys.modules, "app.parallel.ray_backend", None)
    with pytest.raises(RuntimeError, match="Ray를 사용할 수 없습니다"):
        create_executor("ray", 2)


def test_health_reports_backend(client):
    assert client.get("/api/health").json() == {"status": "ok", "parallelBackend": "pool"}


def test_runs_real_simulation(executor, extract_dir, tmp_path):
    from app.fmu.simulate import SimTask, run_simulation
    from app.schemas import SimSettings

    tasks = [
        SimTask(fmu_id="t", extract_dir=str(extract_dir), start_values={"vehicle.body.aerodynamics.Cd": cd},
                sim=SimSettings(start_time=0, stop_time=5, tolerance=1e-4, output_interval=0.1),
                record_variables=["controlBus.chassisBus.longitudinalVelocity"],
                out_path=str(tmp_path / f"{i}.parquet"), work_dir=str(tmp_path / f"w{i}"))
        for i, cd in enumerate([0.28, 0.5])
    ]
    hs = [executor.submit(run_simulation, t) for t in tasks]
    wait_all(executor, hs, timeout=120)
    outs = [executor.result(h) for h in hs]
    assert all(o.ok for o in outs), [o.error for o in outs]


def test_app_creates_and_shuts_down_executor(settings):
    from fastapi.testclient import TestClient

    from app.main import create_app

    app = create_app(settings)
    with TestClient(app) as c:
        ex = app.state.executor
        assert ex.name == "pool" and ex.max_workers == settings.max_workers
        assert c.get("/api/health").json()["parallelBackend"] == ex.name
    assert ex._pool is None
