"""최적화 잡 테스트 — 가짜 시뮬레이션은 파라미터를 시계열 컬럼으로 기록하고, 목적함수가 그 값을 읽는다."""
import hashlib

from sqlalchemy import inspect

from tests.test_runner import FMU_ID, SIM, mclient, wait_job  # noqa: F401

F_QUAD = "def evaluate(r, p):\n    x = float(r['p'].iloc[-1])\n    return (x - 0.3) ** 2\n"
F1 = "def evaluate(r, p):\n    return float(r['p'].iloc[-1]) ** 2\n"
F2 = "def evaluate(r, p):\n    return (float(r['p'].iloc[-1]) - 1) ** 2\n"


def objective(c, name, code):
    r = c.post("/api/objectives", json={"name": name, "code": code})
    if r.status_code == 409:
        oid = next(o["id"] for o in c.get("/api/objectives").json() if o["name"] == name)
        r = c.put(f"/api/objectives/{oid}", json={"name": name, "code": code})
    return r.json()


def opt(objectives, n_trials=20, algorithm="tpe", design=None, name="opt", workers=4):
    return {
        "name": name, "fmuId": FMU_ID,
        "designVars": design or [{"name": "p", "min": -1, "max": 2, "kind": "float"}],
        "objectives": objectives, "algorithm": algorithm, "nTrials": n_trials, "fixedParams": {},
        "sim": SIM, "recordVariables": [], "workers": workers, "runTimeoutSec": 60,
    }


def submit(c, req):
    r = c.post("/api/jobs/optimization", json=req)
    assert r.status_code == 201, r.text
    return r.json()


def values(c, job_id, oid):
    page = c.get("/api/runs", params={"jobIds": job_id, "objectiveIds": oid, "limit": 1000}).json()
    return page, [r["objectives"][oid]["value"] for r in page["items"]]


def test_single_objective_tpe_finds_minimum(mclient):  # noqa: F811
    o = objective(mclient, "quad", F_QUAD)
    job = submit(mclient, opt([{"objectiveId": o["id"], "direction": "minimize"}], n_trials=40))
    assert job["kind"] == "optimization" and job["total"] == 40
    assert job["objectiveSnapshot"] == {o["id"]: {"name": "quad", "codeHash": o["codeHash"]}}
    done = wait_job(mclient, job["id"], timeout=60)
    assert done["status"] == "done" and done["completed"] == 40
    _, vals = values(mclient, job["id"], o["id"])
    assert min(vals) < 0.01


def test_maximize_direction(mclient):  # noqa: F811
    o = objective(mclient, "quad-max", F_QUAD)
    job = submit(mclient, opt([{"objectiveId": o["id"], "direction": "maximize"}], n_trials=30, name="max"))
    wait_job(mclient, job["id"], timeout=60)
    page, vals = values(mclient, job["id"], o["id"])
    # 최대는 경계 x=-1 → 1.69
    assert max(vals) > 1.5
    assert {r["index"] for r in page["items"]} == set(range(30))


def test_multi_objective_nsga2_returns_tradeoff(mclient):  # noqa: F811
    a = objective(mclient, "f1", F1)
    b = objective(mclient, "f2", F2)
    job = submit(mclient, opt([{"objectiveId": a["id"], "direction": "minimize"},
                               {"objectiveId": b["id"], "direction": "minimize"}], n_trials=40, algorithm="nsga2"))
    done = wait_job(mclient, job["id"], timeout=60)
    assert done["status"] == "done"
    page = mclient.get("/api/runs", params={"jobIds": job["id"], "objectiveIds": f"{a['id']},{b['id']}", "limit": 100}).json()
    pts = [(r["params"]["p"], r["objectives"][a["id"]]["value"], r["objectives"][b["id"]]["value"]) for r in page["items"]]
    front = [p for p in pts if not any(q[1] <= p[1] and q[2] <= p[2] and (q[1] < p[1] or q[2] < p[2]) for q in pts)]
    # 참 Pareto 집합은 x∈[0,1]. 유한 표본의 경험적 front는 경계 근처 점을 포함할 수 있다
    assert sum(0 <= x <= 1 for x, _, _ in front) >= 5
    assert all(-0.2 <= x <= 1.2 for x, _, _ in front)


def test_cmaes_rejects_multi(mclient):  # noqa: F811
    a = objective(mclient, "f1", F1)
    b = objective(mclient, "f2", F2)
    r = mclient.post("/api/jobs/optimization", json=opt([{"objectiveId": a["id"], "direction": "minimize"},
                                                        {"objectiveId": b["id"], "direction": "minimize"}], algorithm="cmaes"))
    assert r.status_code == 422 and r.json()["detail"] == "CMA-ES는 단일 목적만 지원합니다"


def test_cmaes_single(mclient):  # noqa: F811
    o = objective(mclient, "quad", F_QUAD)
    job = submit(mclient, opt([{"objectiveId": o["id"], "direction": "minimize"}], n_trials=20, algorithm="cmaes", name="cma"))
    assert wait_job(mclient, job["id"], timeout=60)["status"] == "done"


def test_validation(mclient):  # noqa: F811
    o = objective(mclient, "quad", F_QUAD)
    one = [{"objectiveId": o["id"], "direction": "minimize"}]
    assert mclient.post("/api/jobs/optimization", json=opt([])).status_code == 422
    r = mclient.post("/api/jobs/optimization", json=opt(one, design=[{"name": "p", "min": 1, "max": 1, "kind": "float"}]))
    assert r.status_code == 422 and r.json()["detail"] == "설계 변수 p: 최솟값은 최댓값보다 작아야 합니다"
    r = mclient.post("/api/jobs/optimization", json=opt([{"objectiveId": "nope", "direction": "minimize"}]))
    assert r.status_code == 422 and r.json()["detail"] == "목적함수를 찾을 수 없습니다: nope"
    r = mclient.post("/api/jobs/optimization", json=opt(one, design=[{"name": "zz", "min": 0, "max": 1, "kind": "float"}]))
    assert r.status_code == 422 and r.json()["detail"] == "FMU에 없는 변수: zz"


def test_failed_trials_counted_not_fatal(mclient):  # noqa: F811
    o = objective(mclient, "quad", F_QUAD)
    req = opt([{"objectiveId": o["id"], "direction": "minimize"}], n_trials=12, name="withfail",
              design=[{"name": "p", "min": -1, "max": 2, "kind": "float"}, {"name": "fail", "min": 0, "max": 1, "kind": "int"}])
    done = wait_job(mclient, submit(mclient, req)["id"], timeout=60)
    assert done["status"] == "done" and done["completed"] + done["failed"] == 12
    assert done["failed"] >= 1


def test_objective_error_fails_trial(mclient):  # noqa: F811
    o = objective(mclient, "raises", "def evaluate(r, p):\n    raise ValueError('x')\n")
    job = submit(mclient, opt([{"objectiveId": o["id"], "direction": "minimize"}], n_trials=6, name="err"))
    done = wait_job(mclient, job["id"], timeout=60)
    assert done["status"] == "done" and done["completed"] == 6  # 시뮬레이션은 성공, trial만 FAIL


def test_int_design_var(mclient):  # noqa: F811
    o = objective(mclient, "quad", F_QUAD)
    job = submit(mclient, opt([{"objectiveId": o["id"], "direction": "minimize"}], n_trials=8, name="int",
                              design=[{"name": "p", "min": 0, "max": 5, "kind": "int"}]))
    wait_job(mclient, job["id"], timeout=60)
    runs = mclient.get("/api/runs", params={"jobIds": job["id"]}).json()["items"]
    assert all(float(r["params"]["p"]).is_integer() and 0 <= r["params"]["p"] <= 5 for r in runs)


def test_snapshot_used_even_if_edited_midrun(mclient):  # noqa: F811
    o = objective(mclient, "snap", F_QUAD)
    snap_hash = o["codeHash"]
    job = submit(mclient, opt([{"objectiveId": o["id"], "direction": "minimize"}], n_trials=10, name="snap", workers=1))
    new_code = "def evaluate(r, p):\n    return 999.0\n"
    mclient.put(f"/api/objectives/{o['id']}", json={"name": "snap", "code": new_code})
    done = wait_job(mclient, job["id"], timeout=60)
    assert done["objectiveSnapshot"][o["id"]]["codeHash"] == snap_hash
    ev = mclient.app.state.evaluator
    runs = mclient.get("/api/runs", params={"jobIds": job["id"]}).json()["items"]
    # 최적화 중 평가는 스냅샷 코드로 이뤄져 캐시에 (run, 스냅샷 해시)로 남아 있다
    assert all(ev._get((r["id"], snap_hash)) is not None for r in runs)
    page, vals = values(mclient, job["id"], o["id"])
    assert set(vals) == {999.0}
    assert page["codeHashes"][o["id"]] == hashlib.sha256(new_code.encode()).hexdigest() != snap_hash


def test_no_objective_values_in_db(mclient):  # noqa: F811
    insp = inspect(mclient.app.state.engine)
    assert set(insp.get_table_names()) == {"fmus", "variables", "objectives", "jobs", "runs"}
    assert {c["name"] for c in insp.get_columns("runs")} == {
        "id", "job_id", "fmu_id", "index", "params", "status", "error", "elapsed_sec", "result_path"}
    with mclient.app.state.session_factory() as s:
        from app.models import Job
        for j in s.query(Job).filter(Job.kind == "optimization"):
            assert set(j.objective_snapshot.get(next(iter(j.objective_snapshot)), {})) <= {"name", "codeHash"}
