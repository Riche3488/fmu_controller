import hashlib

import pytest

from tests.test_runner import FMU_ID, batch, mclient, submit, wait_job  # noqa: F401  (module fixture 재사용)

OBJ_P = "def evaluate(r, p):\n    return float(r['p'].iloc[-1])\n"


def make_objective(c, name, code):
    r = c.post("/api/objectives", json={"name": name, "code": code})
    if r.status_code == 409:
        oid = next(o["id"] for o in c.get("/api/objectives").json() if o["name"] == name)
        return c.put(f"/api/objectives/{oid}", json={"name": name, "code": code}).json()
    return r.json()


@pytest.fixture(scope="module")
def seeded(mclient):  # noqa: F811
    job = submit(mclient, batch(name="seed", params=[{"name": "p", "mode": "list", "values": [3, 1, 2]}],
                                record=[]))
    wait_job(mclient, job["id"])
    failing = submit(mclient, batch(name="seed-fail", params=[{"name": "fail", "mode": "list", "values": [1]}]))
    wait_job(mclient, failing["id"])
    return job["id"], failing["id"]


def values(page, oid):
    return [r["objectives"][oid]["value"] for r in page["items"]]


def test_runs_with_objective_sorted(mclient, seeded):  # noqa: F811
    job, failing = seeded
    o = make_objective(mclient, "pval", OBJ_P)
    q = {"jobIds": f"{job},{failing}", "objectiveIds": o["id"], "sortBy": f"objective:{o['id']}", "sortDir": "desc"}
    page = mclient.get("/api/runs", params=q).json()
    assert values(page, o["id"]) == [3.0, 2.0, 1.0, None]  # null은 방향과 무관하게 마지막
    assert page["items"][-1]["objectives"][o["id"]]["error"] == "시뮬레이션 실패"
    assert page["codeHashes"][o["id"]] == hashlib.sha256(OBJ_P.encode()).hexdigest()
    asc = mclient.get("/api/runs", params={**q, "sortDir": "asc"}).json()
    assert values(asc, o["id"]) == [1.0, 2.0, 3.0, None]


def test_objective_edit_changes_values_immediately(mclient, seeded):  # noqa: F811
    job, _ = seeded
    o = make_objective(mclient, "editme", OBJ_P)
    v1 = values(mclient.get("/api/runs", params={"jobIds": job, "objectiveIds": o["id"]}).json(), o["id"])
    mclient.put(f"/api/objectives/{o['id']}", json={"name": "editme", "code": "def evaluate(r,p): return 42.0"})
    page = mclient.get("/api/runs", params={"jobIds": job, "objectiveIds": o["id"]}).json()
    assert v1 == [3.0, 1.0, 2.0]
    assert set(values(page, o["id"])) == {42.0}
    assert page["codeHashes"][o["id"]] == hashlib.sha256(b"def evaluate(r,p): return 42.0").hexdigest()


def test_no_objectives_means_no_values(mclient, seeded):  # noqa: F811
    job, _ = seeded
    page = mclient.get("/api/runs", params={"jobIds": job}).json()
    assert page["codeHashes"] == {} and all(r["objectives"] == {} for r in page["items"])


def test_sort_by_param_and_pagination(mclient, seeded):  # noqa: F811
    job, _ = seeded
    page = mclient.get("/api/runs", params={"jobIds": job, "sortBy": "param:p", "offset": 1, "limit": 1}).json()
    assert page["total"] == 3 and [r["params"]["p"] for r in page["items"]] == [2.0]


def test_status_and_fmu_filter(mclient, seeded):  # noqa: F811
    _, failing = seeded
    assert all(r["status"] == "failed" for r in mclient.get("/api/runs", params={"status": "failed"}).json()["items"])
    assert mclient.get("/api/runs", params={"fmuId": "other"}).json()["total"] == 0
    assert mclient.get("/api/runs", params={"fmuId": FMU_ID, "jobIds": failing}).json()["total"] == 1


def test_unknown_objective_404(mclient, seeded):  # noqa: F811
    assert mclient.get("/api/runs", params={"objectiveIds": "nope"}).status_code == 404


def test_objective_error_keeps_run_ok(mclient, seeded):  # noqa: F811
    job, _ = seeded
    o = make_objective(mclient, "broken", "def evaluate(r, p):\n    raise RuntimeError('boom')\n")
    page = mclient.get("/api/runs", params={"jobIds": job, "objectiveIds": o["id"]}).json()
    assert all(r["status"] == "ok" for r in page["items"])
    assert all("boom" in r["objectives"][o["id"]]["error"] for r in page["items"])


TEMPLATE = '''import pandas as pd


def evaluate(result: pd.DataFrame, params: dict) -> float:
    t = result["time"].to_numpy()
    return float(t[-1] - t[0])
'''


def test_real_fmu_batch_smoke(client, uploaded_fmu):
    req = {
        "name": "real", "fmuId": uploaded_fmu,
        "params": [{"name": "vehicle.body.aerodynamics.Cd", "mode": "list", "values": [0.28, 0.5]}],
        "sampling": "grid", "nSamples": None, "fixedParams": {},
        "sim": {"startTime": 0, "stopTime": 5, "tolerance": 1e-4, "outputInterval": 0.1},
        "recordVariables": ["controlBus.chassisBus.longitudinalVelocity"], "workers": 2, "runTimeoutSec": 120,
    }
    job = submit(client, req)
    done = wait_job(client, job["id"], timeout=180)
    assert done["status"] == "done" and done["completed"] == 2, done
    o = client.post("/api/objectives", json={"name": "duration", "code": TEMPLATE}).json()
    page = client.get("/api/runs", params={"jobIds": job["id"], "objectiveIds": o["id"]}).json()
    assert [r["objectives"][o["id"]]["value"] for r in page["items"]] == [pytest.approx(5.0)] * 2
    ts = client.get(f"/api/runs/{page['items'][0]['id']}/timeseries",
                    params={"vars": "controlBus.chassisBus.longitudinalVelocity"}).json()
    assert ts["time"][-1] == pytest.approx(5.0)
    assert client.get(f"/api/fmus/{uploaded_fmu}").json()["nRuns"] == 2
