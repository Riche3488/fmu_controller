"""variant 폴더 생성 + resource 배치 + variant별 run 조회 (가짜 시뮬레이터)."""
import io
import threading
import time

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.models import Variant
from app.resources import catalog, variants
from tests._tasks import resource_echo_sim
from tests.test_runner import FMU_ID, batch, seed_fake_fmu

LOCAL = "http://127.0.0.1"


@pytest.fixture(scope="module")
def vclient(tmp_path_factory):
    settings = Settings(data_dir=tmp_path_factory.mktemp("variants") / "data", parallel="pool", max_workers=2)
    app = create_app(settings)
    with TestClient(app, base_url=LOCAL) as c:
        app.state.jobs.sim_fn = resource_echo_sim
        seed_fake_fmu(app.state.session_factory)
        ex = settings.data_dir / "extract" / FMU_ID
        (ex / "resources").mkdir(parents=True)
        (ex / "resources" / "a.txt").write_bytes(b"1")
        (ex / "resources" / "b.txt").write_bytes(b"10")
        (ex / "binaries").mkdir()
        (ex / "binaries" / "model.dll").write_bytes(b"DLL")
        with app.state.session_factory() as s:
            catalog.index_resources(s, FMU_ID, ex)
        yield c


def cand(c, path, data: bytes, name=None) -> str:
    r = c.post(f"/api/fmus/{FMU_ID}/resources/candidates", data={"path": path},
               files={"file": (name or f"{data.decode()}.txt", io.BytesIO(data))})
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def original(c, path) -> str:
    return next(f for f in c.get(f"/api/fmus/{FMU_ID}/resources").json() if f["path"] == path)["candidates"][0]["id"]


def run_batch(c, req) -> dict:
    r = c.post("/api/jobs/batch", json=req)
    assert r.status_code == 201, r.text
    job = r.json()
    deadline = time.time() + 30
    while time.time() < deadline:
        j = c.get(f"/api/jobs/{job['id']}").json()
        if j["status"] not in ("queued", "running"):
            return j
        time.sleep(0.05)
    raise AssertionError(j)


def column(c, run_id, name) -> float:
    return c.get(f"/api/runs/{run_id}/timeseries", params={"vars": name}).json()["series"][name][0]


def test_batch_crosses_resources_and_tags_variants(vclient):
    c2 = cand(vclient, "a.txt", b"2")
    req = batch(name="cross", params=[{"name": "p", "mode": "list", "values": [1, 2]}])
    req["resources"] = {"a.txt": [original(vclient, "a.txt"), c2]}
    job = run_batch(vclient, req)
    assert job["total"] == 4 and job["completed"] == 4, job
    runs = vclient.get("/api/runs", params={"jobIds": job["id"]}).json()["items"]
    runs.sort(key=lambda r: r["index"])
    orig_v = variants.original_variant_id(FMU_ID)
    assert [r["params"]["p"] for r in runs] == [1, 1, 2, 2]
    assert [r["variantId"] == orig_v for r in runs] == [True, False, True, False]
    assert [column(vclient, r["id"], "a") for r in runs] == [1, 2, 1, 2]
    assert all(column(vclient, r["id"], "b") == 10 for r in runs)


def test_variant_dir_contains_replaced_file_and_original_untouched(vclient):
    settings = vclient.app.state.settings
    c3 = cand(vclient, "b.txt", b"30")
    req = batch(name="dir", params=[{"name": "p", "mode": "list", "values": [1]}])
    req["resources"] = {"b.txt": [c3]}
    job = run_batch(vclient, req)
    run = vclient.get("/api/runs", params={"jobIds": job["id"]}).json()["items"][0]
    vdir = settings.data_dir / "variants" / run["variantId"]
    assert (vdir / "resources" / "b.txt").read_bytes() == b"30"
    assert (vdir / "resources" / "a.txt").read_bytes() == b"1"
    assert (vdir / "binaries" / "model.dll").read_bytes() == b"DLL"
    ex = settings.data_dir / "extract" / FMU_ID
    assert (ex / "resources" / "b.txt").read_bytes() == b"10"
    assert column(vclient, run["id"], "b") == 30


def test_concurrent_materialize_same_variant(vclient):
    settings = vclient.app.state.settings
    c4 = cand(vclient, "a.txt", b"4")
    sf = vclient.app.state.session_factory
    with sf() as s:
        vid = variants.ensure_variant(s, FMU_ID, {"a.txt": c4}).id
    out, errors = [], []

    def go():
        try:
            with sf() as s:
                out.append(variants.materialize(settings, s, s.get(Variant, vid)))
        except Exception as e:  # pragma: no cover - 실패 시 보고용
            errors.append(e)

    ts = [threading.Thread(target=go) for _ in range(4)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    assert not errors and len(set(out)) == 1
    assert (out[0] / "resources" / "a.txt").read_bytes() == b"4"
    assert not list((settings.data_dir / "variants").glob(".tmp-*"))


def test_runs_filter_by_variant_ids(vclient):
    c5 = cand(vclient, "a.txt", b"5")
    req = batch(name="filter", params=[{"name": "p", "mode": "list", "values": [1, 2, 3]}])
    req["resources"] = {"a.txt": [original(vclient, "a.txt"), c5]}
    job = run_batch(vclient, req)
    runs = vclient.get("/api/runs", params={"jobIds": job["id"]}).json()["items"]
    vid = next(r["variantId"] for r in runs if r["variantId"] != variants.original_variant_id(FMU_ID))
    page = vclient.get("/api/runs", params={"jobIds": job["id"], "variantIds": vid}).json()
    assert page["total"] == 3 and {r["variantId"] for r in page["items"]} == {vid}


def test_batch_without_resources_uses_original_variant(vclient):
    job = run_batch(vclient, batch(name="plain", params=[{"name": "p", "mode": "list", "values": [7]}]))
    run = vclient.get("/api/runs", params={"jobIds": job["id"]}).json()["items"][0]
    assert run["variantId"] == variants.original_variant_id(FMU_ID)
    assert column(vclient, run["id"], "a") == 1


@pytest.mark.parametrize("resources, msg", [
    ({"a.txt": []}, "resource 후보를 하나 이상 고르세요"),
    ({"nope.txt": ["x"]}, "resource 파일이 없습니다"),
    ({"a.txt": ["0000000000000000"]}, "a.txt의 후보가 아닙니다"),
])
def test_batch_rejects_bad_resources(vclient, resources, msg):
    req = batch(name="bad")
    req["resources"] = resources
    r = vclient.post("/api/jobs/batch", json=req)
    assert r.status_code == 422 and msg in r.json()["detail"]


def test_batch_rejects_candidate_of_other_path(vclient):
    cb = cand(vclient, "b.txt", b"77")
    req = batch(name="cross-path")
    req["resources"] = {"a.txt": [cb]}
    r = vclient.post("/api/jobs/batch", json=req)
    assert r.status_code == 422 and "a.txt의 후보가 아닙니다" in r.json()["detail"]
