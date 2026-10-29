"""최종 리뷰 지적 사항 재현 테스트."""
import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.models import Job
from app.parallel.base import create_executors
from tests._tasks import fake_sim, hang, sleep_and_return
from tests.test_runner import FMU_ID, batch, seed_fake_fmu

LOCAL = "http://127.0.0.1"


def wait_job(c, job_id, timeout=30.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        j = c.get(f"/api/jobs/{job_id}").json()
        if j["status"] not in ("queued", "running"):
            return j
        time.sleep(0.05)
    raise AssertionError(j)


@pytest.fixture(scope="module")
def rclient(tmp_path_factory):
    settings = Settings(data_dir=tmp_path_factory.mktemp("review") / "data", parallel="pool", max_workers=4, eval_workers=1)
    app = create_app(settings)
    with TestClient(app, base_url=LOCAL) as c:
        app.state.jobs.sim_fn = fake_sim
        seed_fake_fmu(app.state.session_factory)
        for ex in (app.state.executor, app.state.eval_executor):
            for h in [ex.submit(sleep_and_return, 0.01, i) for i in range(ex.max_workers)]:
                ex.result(h)
        yield c


# ---- #1 시뮬레이션과 목적함수 평가는 서로 다른 실행기를 쓴다 ----
def test_separate_executors_for_simulation_and_evaluation():
    sim, ev = create_executors("pool", 2, 1)
    try:
        assert sim is not ev and sim.max_workers == 2 and ev.max_workers == 1
        long = sim.submit(sleep_and_return, 1.0, "sim")
        stuck = ev.submit(hang)
        time.sleep(0.2)
        gen = sim.generation
        ev.cancel(stuck, force=True)
        assert sim.generation == gen  # 평가 쪽 취소가 시뮬레이션 풀을 재시작하지 않는다
        assert sim.result(long) == "sim"
    finally:
        sim.shutdown()
        ev.shutdown()


def test_objective_evaluation_while_simulations_saturate_workers(rclient):
    o = rclient.post("/api/objectives", json={"name": "pval", "code": "def evaluate(r, p):\n    return float(r['p'].iloc[-1])\n"}).json()
    first = rclient.post("/api/jobs/batch", json=batch(name="first")).json()
    wait_job(rclient, first["id"])
    ev = rclient.app.state.evaluator
    old_timeout, ev.item_timeout_sec = ev.item_timeout_sec, 1.0
    try:
        busy = rclient.post("/api/jobs/batch", json=batch(
            name="busy", params=[{"name": "p", "mode": "range", "min": 0, "max": 3, "steps": 4}],
            fixed={"sleep": 2.0}, timeout=10)).json()
        time.sleep(0.3)
        page = rclient.get("/api/runs", params={"jobIds": first["id"], "objectiveIds": o["id"]}).json()
        assert [r["objectives"][o["id"]]["value"] for r in page["items"]] == [1.0, 2.0, 3.0]
        done = wait_job(rclient, busy["id"])
        assert done["completed"] == 4 and done["failed"] == 0
    finally:
        ev.item_timeout_sec = old_timeout


# ---- #2 큐 대기 시간은 run 타임아웃에 포함되지 않는다 ----
def test_queue_wait_does_not_count_toward_run_timeout(rclient):
    req = dict(params=[{"name": "p", "mode": "range", "min": 0, "max": 3, "steps": 4}], fixed={"sleep": 0.7}, timeout=1.2)
    a = rclient.post("/api/jobs/batch", json=batch(name="qa", **req)).json()
    b = rclient.post("/api/jobs/batch", json=batch(name="qb", **req)).json()
    da, db = wait_job(rclient, a["id"]), wait_job(rclient, b["id"])
    assert (da["failed"], db["failed"]) == (0, 0), (da, db)


# ---- #1c 다른 잡의 타임아웃으로 풀이 재시작되면 시작 시각을 갱신한다 ----
def test_pool_restart_by_other_job_resets_run_clock(rclient):
    victim = rclient.post("/api/jobs/batch", json=batch(
        name="victim", params=[{"name": "p", "mode": "list", "values": [1, 2]}], fixed={"sleep": 1.0}, workers=2, timeout=1.6)).json()
    time.sleep(0.05)
    killer = rclient.post("/api/jobs/batch", json=batch(
        name="killer", params=[{"name": "hang", "mode": "list", "values": [1]}], workers=1, timeout=0.8)).json()
    dk, dv = wait_job(rclient, killer["id"]), wait_job(rclient, victim["id"])
    assert dk["failed"] == 1
    assert dv["failed"] == 0, dv


# ---- #5 같은 (run, 코드) 평가는 동시에 요청돼도 한 번만 실행 ----
def test_concurrent_identical_evaluations_are_deduplicated(tmp_path):
    import numpy as np

    from app.objectives.evaluator import Evaluator
    from app.objectives.worker import EvalItem
    from app.results.storage import write_result

    arr = np.zeros(3, dtype=[("time", "f8")])
    write_result(tmp_path / "r.parquet", arr)
    item = EvalItem("r1", str(tmp_path / "r.parquet"), {})
    _, ex = create_executors("pool", 1, 1)
    submits = []
    orig = ex.submit
    ex.submit = lambda fn, *a: submits.append(1) or orig(fn, *a)
    ev = Evaluator(ex)
    code = "import time\ndef evaluate(r, p):\n    time.sleep(0.5)\n    return 1.0\n"
    out = []
    ts = [threading.Thread(target=lambda: out.append(ev.evaluate(code, [item])["r1"].value)) for _ in range(3)]
    try:
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        assert out == [1.0, 1.0, 1.0] and len(submits) == 1
    finally:
        ex.shutdown()


# ---- #3 정적 파일 폴백은 UNC/절대 경로로 파일시스템에 접근하지 않는다 ----
@pytest.mark.parametrize("path", ["///evil/share/x", "/%5C%5Cevil%5Cshare%5Cx", "/C:/Windows/win.ini", "/assets/../../secret"])
def test_static_fallback_rejects_unsafe_paths(tmp_path, monkeypatch, path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("INDEX", encoding="utf-8")
    (tmp_path / "secret").write_text("SECRET", encoding="utf-8")
    touched = []
    orig = Path.is_file
    monkeypatch.setattr(Path, "is_file", lambda self: touched.append(str(self)) or orig(self))
    app = create_app(Settings(data_dir=tmp_path / "data", parallel="pool", max_workers=1, static_dir=dist))
    with TestClient(app, base_url=LOCAL) as c:
        r = c.get(path)
    assert "SECRET" not in r.text
    # 네트워크 공유(UNC)나 dist 밖의 경로는 파일시스템에서 조회조차 하지 않는다
    assert not [t for t in touched if t.startswith("\\\\") or not Path(t).resolve().is_relative_to(dist.resolve())]


# ---- #4 Host/Origin 검사 ----
def test_foreign_host_rejected(tmp_path):
    app = create_app(Settings(data_dir=tmp_path / "data", parallel="pool", max_workers=1))
    with TestClient(app, base_url="http://evil.example") as c:
        assert c.get("/api/health").status_code == 400
    with TestClient(app, base_url="http://localhost:8000") as c:
        assert c.get("/api/health").status_code == 200


def test_cross_origin_writes_rejected(client):
    r = client.post("/api/objectives/test", json={"code": "x", "runId": "r"}, headers={"Origin": "https://evil.example"})
    assert r.status_code == 403
    ok = client.post("/api/objectives", json={"name": "o", "code": "x"}, headers={"Origin": "http://localhost:5173"})
    assert ok.status_code == 201


# ---- #6 잡이 있는 FMU 삭제는 409 ----
def test_delete_fmu_with_jobs_but_no_runs_is_409(app, client, uploaded_fmu):
    with app.state.session_factory() as s:
        s.add(Job(id="j0", kind="batch", name="x", fmu_id=uploaded_fmu, status="cancelled", config={}))
        s.commit()
    r = client.delete(f"/api/fmus/{uploaded_fmu}")
    assert r.status_code == 409


# ---- #7 run_cases가 예외로 끝나도 실행 중인 작업을 정리한다 ----
def test_crash_in_run_cases_cancels_inflight(rclient):
    from app.jobs.runner import CaseSpec

    mgr = rclient.app.state.jobs
    job = rclient.post("/api/jobs/batch", json=batch(name="crash-seed", params=[{"name": "p", "mode": "list", "values": [1]}])).json()
    wait_job(rclient, job["id"])
    with rclient.app.state.session_factory() as s:
        s.add(Job(id="crashjob", kind="batch", name="crash", fmu_id=FMU_ID, status="queued", total=3, config={}))
        s.commit()

    class Req:
        workers, run_timeout_sec, record_variables = 3, 60, []
        sim = __import__("app.schemas", fromlist=["SimSettings"]).SimSettings(start_time=0, stop_time=1, tolerance=1e-4, output_interval=0.1)

    cases = iter([CaseSpec(0, {"p": 1.0}), CaseSpec(1, {"hang": 1.0}), CaseSpec(2, {"hang": 1.0})])

    def boom(case, run):
        raise RuntimeError("on_done failed")

    mgr._start(Job(id="crashjob"), lambda: mgr.run_cases("crashjob", FMU_ID, Req, cases, boom))
    j = wait_job(rclient, "crashjob")
    assert j["status"] == "failed" and "on_done failed" in j["error"]
    ex = rclient.app.state.executor
    deadline = time.time() + 5
    while ex._entries and time.time() < deadline:
        time.sleep(0.05)
    assert not ex._entries
