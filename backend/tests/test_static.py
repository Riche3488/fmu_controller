import time

import pytest
from fastapi.testclient import TestClient

LOCAL = "http://127.0.0.1"

from app.config import Settings
from app.main import create_app
from tests._tasks import fake_sim
from tests.test_runner import FMU_ID, batch, seed_fake_fmu


@pytest.fixture
def dist(tmp_path):
    d = tmp_path / "dist"
    (d / "assets").mkdir(parents=True)
    (d / "index.html").write_text("<!doctype html><title>FMU Controller</title>", encoding="utf-8")
    (d / "assets" / "app.js").write_text("console.log(1)", encoding="utf-8")
    return d


@pytest.fixture
def sclient(tmp_path, dist):
    app = create_app(Settings(data_dir=tmp_path / "data", parallel="pool", max_workers=1, static_dir=dist))
    with TestClient(app, base_url=LOCAL) as c:
        yield c


def test_index_served_at_root(sclient):
    r = sclient.get("/")
    assert r.status_code == 200 and "FMU Controller" in r.text


def test_spa_fallback_for_client_routes(sclient):
    r = sclient.get("/jobs/abc")
    assert r.status_code == 200 and "FMU Controller" in r.text


def test_assets_served(sclient):
    r = sclient.get("/assets/app.js")
    assert r.status_code == 200 and "console.log" in r.text


def test_unknown_api_path_is_json_404(sclient):
    r = sclient.get("/api/nope")
    assert r.status_code == 404 and r.headers["content-type"].startswith("application/json")


def test_no_static_dir_is_fine(tmp_path):
    app = create_app(Settings(data_dir=tmp_path / "d2", parallel="pool", max_workers=1, static_dir=tmp_path / "missing"))
    with TestClient(app, base_url=LOCAL) as c:
        assert c.get("/api/health").status_code == 200
        assert c.get("/").status_code == 404


def test_restart_keeps_results_and_recomputes_objectives(tmp_path):
    settings = Settings(data_dir=tmp_path / "data", parallel="pool", max_workers=2)
    app = create_app(settings)
    with TestClient(app, base_url=LOCAL) as c:
        app.state.jobs.sim_fn = fake_sim
        seed_fake_fmu(app.state.session_factory)
        job = c.post("/api/jobs/batch", json=batch(name="persist")).json()
        for _ in range(200):
            if c.get(f"/api/jobs/{job['id']}").json()["status"] == "done":
                break
            time.sleep(0.05)
        oid = c.post("/api/objectives", json={"name": "p", "code": "def evaluate(r, p):\n    return float(r['p'].iloc[-1])\n"}).json()["id"]
    app2 = create_app(settings)
    with TestClient(app2, base_url=LOCAL) as c:
        page = c.get("/api/runs", params={"jobIds": job["id"], "objectiveIds": oid, "sortBy": "index"}).json()
        assert [r["objectives"][oid]["value"] for r in page["items"]] == [1.0, 2.0, 3.0]
        assert c.get(f"/api/fmus/{FMU_ID}").json()["nRuns"] == 3


def test_timeseries_unrecorded_variable_400(tmp_path):
    settings = Settings(data_dir=tmp_path / "data", parallel="pool", max_workers=1)
    app = create_app(settings)
    with TestClient(app, base_url=LOCAL) as c:
        app.state.jobs.sim_fn = fake_sim
        seed_fake_fmu(app.state.session_factory)
        job = c.post("/api/jobs/batch", json=batch(name="ts", params=[{"name": "p", "mode": "list", "values": [1]}])).json()
        for _ in range(200):
            if c.get(f"/api/jobs/{job['id']}").json()["status"] == "done":
                break
            time.sleep(0.05)
        run = c.get("/api/runs", params={"jobIds": job["id"]}).json()["items"][0]
        r = c.get(f"/api/runs/{run['id']}/timeseries", params={"vars": "y"})
        assert r.status_code == 400 and r.json()["detail"] == "기록되지 않은 변수: y"
