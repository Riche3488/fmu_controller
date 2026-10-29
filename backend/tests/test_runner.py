"""JobManager 테스트 — 가짜 시뮬레이션(tests._tasks.fake_sim)으로 FMU 없이 빠르게."""
import time

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.models import Fmu, Job, Run, Variable
from tests._tasks import fake_sim, sleep_and_return

FMU_ID = "fakefmu000000001"
SIM = {"startTime": 0, "stopTime": 1, "tolerance": 1e-4, "outputInterval": 0.1}


def seed_fake_fmu(session_factory):
    with session_factory() as s:
        if s.get(Fmu, FMU_ID):
            return
        s.add(Fmu(id=FMU_ID, file_name="fake.fmu", model_name="Fake", guid="g", fmi_version="2.0",
                  fmi_types=["ModelExchange"], generation_tool="t",
                  default_experiment={"startTime": 0, "stopTime": 1, "tolerance": 1e-4},
                  n_parameters=4, n_outputs=1, n_variables=5))
        s.flush()
        for i, (name, caus) in enumerate([("p", "parameter"), ("sleep", "parameter"), ("fail", "parameter"),
                                          ("hang", "parameter"), ("y", "output")]):
            s.add(Variable(fmu_id=FMU_ID, name=name, value_reference=i, causality=caus, variability="tunable",
                           type="Real", start="0", unit=None, description=None))
        s.commit()


@pytest.fixture(scope="module")
def mclient(tmp_path_factory):
    settings = Settings(data_dir=tmp_path_factory.mktemp("runner") / "data", parallel="pool", max_workers=4)
    app = create_app(settings)
    with TestClient(app) as c:
        app.state.jobs.sim_fn = fake_sim
        seed_fake_fmu(app.state.session_factory)
        ex = app.state.executor
        for h in [ex.submit(sleep_and_return, 0.01, i) for i in range(4)]:
            ex.result(h)  # 워커 워밍업
        yield c


def batch(name="b", params=None, sampling="grid", fixed=None, workers=4, timeout=60, record=None, n_samples=None):
    return {
        "name": name, "fmuId": FMU_ID, "params": params or [{"name": "p", "mode": "list", "values": [1, 2, 3]}],
        "sampling": sampling, "nSamples": n_samples, "fixedParams": fixed or {}, "sim": SIM,
        "recordVariables": record if record is not None else [], "workers": workers, "runTimeoutSec": timeout,
    }


def submit(c, req) -> dict:
    r = c.post("/api/jobs/batch", json=req)
    assert r.status_code == 201, r.text
    return r.json()


def wait_job(c, job_id, timeout=30.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        j = c.get(f"/api/jobs/{job_id}").json()
        if j["status"] not in ("queued", "running"):
            return j
        time.sleep(0.05)
    raise AssertionError(f"job {job_id} did not finish: {j}")


def runs_of(c, job_id) -> list[dict]:
    return c.get("/api/runs", params={"jobIds": job_id, "limit": 1000}).json()["items"]


def test_batch_runs_all_cases_in_parallel(mclient):
    t = time.time()
    job = submit(mclient, batch(params=[{"name": "p", "mode": "range", "min": 0, "max": 7, "steps": 8}],
                                fixed={"sleep": 0.3}))
    assert job["total"] == 8 and job["kind"] == "batch"
    done = wait_job(mclient, job["id"])
    assert done["status"] == "done" and done["completed"] == 8 and done["failed"] == 0
    assert time.time() - t < 2.0  # 순차라면 2.4s 이상
    runs = runs_of(mclient, job["id"])
    assert sorted(r["index"] for r in runs) == list(range(8))
    assert all(r["params"]["sleep"] == 0.3 for r in runs)


def test_job_config_is_stored_in_camel_case(mclient):
    job = submit(mclient, batch(name="cfg"))
    assert job["config"]["recordVariables"] == [] and job["config"]["sampling"] == "grid"
    assert job["objectiveSnapshot"] is None
    wait_job(mclient, job["id"])


def test_batch_does_not_evaluate_objectives(mclient):
    ev = mclient.app.state.evaluator
    calls = []
    orig = ev.evaluate
    ev.evaluate = lambda *a, **k: calls.append(1) or orig(*a, **k)
    try:
        wait_job(mclient, submit(mclient, batch(name="noeval"))["id"])
    finally:
        ev.evaluate = orig
    assert calls == []


def test_failed_case_does_not_stop_job(mclient):
    job = submit(mclient, batch(params=[{"name": "fail", "mode": "list", "values": [0, 1, 0]}]))
    done = wait_job(mclient, job["id"])
    assert done["status"] == "done" and done["completed"] == 2 and done["failed"] == 1
    failed = [r for r in runs_of(mclient, job["id"]) if r["status"] == "failed"]
    assert failed[0]["error"] == "CVode: convergence failure" and failed[0]["index"] == 1


def test_run_timeout_marks_failed(mclient):
    job = submit(mclient, batch(params=[{"name": "hang", "mode": "list", "values": [1, 0]}], timeout=1))
    done = wait_job(mclient, job["id"])
    assert done["status"] == "done" and done["failed"] == 1 and done["completed"] == 1
    runs = {r["index"]: r for r in runs_of(mclient, job["id"])}
    assert runs[0]["error"] == "timeout" and runs[1]["status"] == "ok"


def test_cancel(mclient):
    job = submit(mclient, batch(params=[{"name": "p", "mode": "range", "min": 0, "max": 19, "steps": 20}],
                                fixed={"sleep": 0.3}, workers=2))
    time.sleep(0.5)
    r = mclient.post(f"/api/jobs/{job['id']}/cancel")
    assert r.status_code == 200
    done = wait_job(mclient, job["id"])
    assert done["status"] == "cancelled"
    assert done["completed"] < 20
    assert len(runs_of(mclient, job["id"])) == done["completed"] + done["failed"]


def test_validation_errors(mclient):
    bad_param = batch(params=[{"name": "nope", "mode": "list", "values": [1]}])
    r = mclient.post("/api/jobs/batch", json=bad_param)
    assert r.status_code == 422 and r.json()["detail"] == "FMU에 없는 변수: nope"
    r = mclient.post("/api/jobs/batch", json=batch(record=["missing.var"]))
    assert r.status_code == 422 and "missing.var" in r.json()["detail"]
    r = mclient.post("/api/jobs/batch", json=batch(params=[{"name": "p", "mode": "list", "values": [1]}], sampling="lhs", n_samples=3))
    assert r.status_code == 422 and r.json()["detail"] == "LHS/random 방식은 range 파라미터만 지원합니다"
    r = mclient.post("/api/jobs/batch", json={**batch(), "fmuId": "nofmu"})
    assert r.status_code == 404


def test_list_jobs_filter(mclient):
    job = submit(mclient, batch(name="listed"))
    wait_job(mclient, job["id"])
    ids = [j["id"] for j in mclient.get("/api/jobs", params={"fmuId": FMU_ID}).json()]
    assert job["id"] in ids
    assert mclient.get("/api/jobs", params={"fmuId": "other"}).json() == []


def test_events_stream(mclient):
    job = submit(mclient, batch(name="sse", fixed={"sleep": 0.2}, workers=1))
    events = []
    with mclient.stream("GET", f"/api/jobs/{job['id']}/events") as resp:
        assert resp.status_code == 200
        for line in resp.iter_lines():
            if line.startswith("event:"):
                events.append(line.split(":", 1)[1].strip())
    assert events[0] == "progress"
    assert events.count("run") == 3
    assert events[-1] == "end"


def test_events_for_finished_job_end_immediately(mclient):
    job = submit(mclient, batch(name="sse2"))
    wait_job(mclient, job["id"])
    with mclient.stream("GET", f"/api/jobs/{job['id']}/events") as resp:
        events = [ln.split(":", 1)[1].strip() for ln in resp.iter_lines() if ln.startswith("event:")]
    assert events == ["progress", "end"]


def test_interrupted_jobs_marked_on_startup(tmp_path):
    settings = Settings(data_dir=tmp_path / "data", parallel="pool", max_workers=1)
    app = create_app(settings)
    with TestClient(app):
        seed_fake_fmu(app.state.session_factory)
        with app.state.session_factory() as s:
            s.add(Job(id="j-run", kind="batch", name="x", fmu_id=FMU_ID, status="running", config={}))
            s.add(Job(id="j-q", kind="batch", name="y", fmu_id=FMU_ID, status="queued", config={}))
            s.add(Job(id="j-done", kind="batch", name="z", fmu_id=FMU_ID, status="done", config={}))
            s.add(Run(id="r1", job_id="j-run", fmu_id=FMU_ID, index=0, params={}, status="ok", result_path="x"))
            s.commit()
    app2 = create_app(settings)
    with TestClient(app2) as c:
        jobs = {j["id"]: j for j in c.get("/api/jobs").json()}
        assert jobs["j-run"]["status"] == "failed" and jobs["j-run"]["error"] == "interrupted"
        assert jobs["j-q"]["status"] == "failed"
        assert jobs["j-done"]["status"] == "done"
        assert len(runs_of(c, "j-run")) == 1
