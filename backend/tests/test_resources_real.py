"""실제 FMU로 resource 후보 검증: NEDC.mat dummy(속도 ×0.8, ×1.2)는 결과가 달라지고 조합별로 따로 쌓인다."""
import io
import time
import zipfile
from pathlib import Path

import numpy as np
import pytest
import scipy.io as sio
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.resources import variants

LOCAL = "http://127.0.0.1"
VEL = "controlBus.chassisBus.longitudinalVelocity"
SIM = {"startTime": 0, "stopTime": 90, "tolerance": 1e-4, "outputInterval": 0.1}
# spike로 확인한 평균 종방향 속도 (원본, ×0.8, ×1.2)
EXPECTED = {1.0: 3.817, 0.8: 3.014, 1.2: 4.511}
MEAN_VEL = f"def evaluate(r, p):\n    return float(r['{VEL}'].mean())\n"


def make_nedc_dummy(src: Path, k: float) -> bytes:
    """NEDC.mat의 2번째 열(속도)에 k를 곱한 v4 .mat 내용"""
    m = {key: v for key, v in sio.loadmat(str(src)).items() if not key.startswith("__")}
    m["table"] = m["table"] * np.array([1, k, 1])
    buf = io.BytesIO()
    sio.savemat(buf, m, format="4")
    return buf.getvalue()


@pytest.fixture(scope="module")
def rc(tmp_path_factory, fmu_path):
    # 워커 1개: 서로 다른 variant가 같은 워커 프로세스에서 연달아 실행된다
    settings = Settings(data_dir=tmp_path_factory.mktemp("real") / "data", parallel="pool", max_workers=1)
    app = create_app(settings)
    with TestClient(app, base_url=LOCAL) as c:
        r = c.post("/api/fmus", files={"file": ("drive.fmu", fmu_path.read_bytes())})
        assert r.status_code == 201, r.text
        c.fmu_id = r.json()["id"]
        yield c


@pytest.fixture(scope="module")
def param(rc):
    """기본값 그대로 넣을 Real 파라미터 하나 (배치에는 스윕 파라미터가 최소 1개 필요)"""
    page = rc.get(f"/api/fmus/{rc.fmu_id}/variables", params={"q": "v_start", "causality": "parameter", "limit": 50}).json()
    v = next(x for x in page["items"] if x["type"] == "Real" and isinstance(x["start"], (int, float)))
    return v["name"], float(v["start"])


def nedc_path(rc) -> Path:
    return rc.app.state.settings.data_dir / "extract" / rc.fmu_id / "resources" / "NEDC.mat"


def upload(rc, path, name, data):
    r = rc.post(f"/api/fmus/{rc.fmu_id}/resources/candidates", data={"path": path}, files={"file": (name, io.BytesIO(data))})
    assert r.status_code in (200, 201), r.text
    return r.json()


def original(rc, path):
    return next(f for f in rc.get(f"/api/fmus/{rc.fmu_id}/resources").json() if f["path"] == path)["candidates"][0]["id"]


def run_job(rc, kind, req, timeout=300):
    r = rc.post(f"/api/jobs/{kind}", json=req)
    assert r.status_code == 201, r.text
    deadline = time.time() + timeout
    while time.time() < deadline:
        j = rc.get(f"/api/jobs/{r.json()['id']}").json()
        if j["status"] not in ("queued", "running"):
            assert j["status"] == "done" and j["failed"] == 0, j
            return j
        time.sleep(0.2)
    raise AssertionError(j)


def batch(rc, param, values, resources, name="real"):
    return {"name": name, "fmuId": rc.fmu_id, "params": [{"name": param[0], "mode": "list", "values": values}],
            "sampling": "grid", "nSamples": None, "fixedParams": {}, "sim": SIM, "recordVariables": [VEL],
            "workers": 1, "runTimeoutSec": 300, "resources": resources}


def mean_velocity(rc, run_id) -> float:
    ts = rc.get(f"/api/runs/{run_id}/timeseries", params={"vars": VEL, "maxPoints": 200000}).json()
    return float(np.mean(ts["series"][VEL]))


@pytest.fixture(scope="module")
def dummies(rc):
    src = nedc_path(rc)
    return {k: upload(rc, "NEDC.mat", f"nedc_x{k}.mat", make_nedc_dummy(src, k))["id"] for k in (0.8, 1.2)}


def test_nedc_dummies_accumulate_as_separate_variants(rc, param, dummies):
    ids = [original(rc, "NEDC.mat"), dummies[0.8], dummies[1.2]]
    job = run_job(rc, "batch", batch(rc, param, [param[1]], {"NEDC.mat": ids}))
    runs = sorted(rc.get("/api/runs", params={"jobIds": job["id"]}).json()["items"], key=lambda r: r["index"])
    assert len(runs) == 3 and len({r["variantId"] for r in runs}) == 3
    assert runs[0]["variantId"] == variants.original_variant_id(rc.fmu_id)
    for r, k in zip(runs, (1.0, 0.8, 1.2)):
        assert mean_velocity(rc, r["id"]) == pytest.approx(EXPECTED[k], abs=0.05), k
    labels = {v["label"]: v["nRuns"] for v in rc.get(f"/api/fmus/{rc.fmu_id}/variants").json()}
    assert labels["원본"] >= 1 and labels["NEDC.mat=nedc_x0.8.mat"] >= 1 and labels["NEDC.mat=nedc_x1.2.mat"] >= 1


def test_reupload_renamed_dummy_reuses_variant(rc, param, dummies):
    again = upload(rc, "NEDC.mat", "renamed_slow.mat", make_nedc_dummy(nedc_path(rc), 0.8))
    assert again["existing"] is True and again["id"] == dummies[0.8]
    before = {v["label"]: v["nRuns"] for v in rc.get(f"/api/fmus/{rc.fmu_id}/variants").json()}
    run_job(rc, "batch", batch(rc, param, [param[1]], {"NEDC.mat": [again["id"]]}, name="again"))
    after = {v["label"]: v["nRuns"] for v in rc.get(f"/api/fmus/{rc.fmu_id}/variants").json()}
    assert after["NEDC.mat=nedc_x0.8.mat"] == before["NEDC.mat=nedc_x0.8.mat"] + 1
    assert set(after) == set(before)  # 이름만 다른 같은 파일로 새 조합이 생기지 않는다


def test_variants_alternate_in_one_worker(rc, param, dummies):
    ids = [original(rc, "NEDC.mat"), dummies[0.8], dummies[1.2]]
    job = run_job(rc, "batch", batch(rc, param, [param[1], param[1]], {"NEDC.mat": ids}, name="alternate"))
    runs = sorted(rc.get("/api/runs", params={"jobIds": job["id"]}).json()["items"], key=lambda r: r["index"])
    means = [mean_velocity(rc, r["id"]) for r in runs]
    assert len(means) == 6
    for i in range(3):
        assert means[i] == pytest.approx(means[i + 3], abs=1e-9)
        assert means[i] == pytest.approx(EXPECTED[(1.0, 0.8, 1.2)[i]], abs=0.05)


def test_text_resource_candidate(rc, fmu_path, tmp_path, param):
    # 테스트 FMU에 텍스트 resource(dummy.tir)를 추가한 사본
    copy = tmp_path / "with_tir.fmu"
    with zipfile.ZipFile(fmu_path) as src, zipfile.ZipFile(copy, "w", zipfile.ZIP_DEFLATED) as dst:
        for item in src.infolist():
            dst.writestr(item, src.read(item.filename))
        dst.writestr("resources/dummy.tir", "[MDI_HEADER]\nFILE_TYPE = 'tir'\nUNLOADED_RADIUS = 0.31\n")
    r = rc.post("/api/fmus", files={"file": ("with_tir.fmu", copy.read_bytes())})
    assert r.status_code == 201, r.text
    fid = r.json()["id"]
    files = {f["path"]: f for f in rc.get(f"/api/fmus/{fid}/resources").json()}
    assert "dummy.tir" in files
    p = rc.get(f"/api/fmus/{fid}/resources/candidates/{files['dummy.tir']['candidates'][0]['id']}/preview").json()
    assert p["kind"] == "text" and "UNLOADED_RADIUS = 0.31" in p["text"]
    new = rc.post(f"/api/fmus/{fid}/resources/candidates", data={"path": "dummy.tir"},
                  files={"file": ("tireB.tir", io.BytesIO(b"[MDI_HEADER]\nUNLOADED_RADIUS = 0.35\n"))}).json()
    req = batch(rc, param, [param[1]], {"dummy.tir": [new["id"]]}, name="tir")
    req["fmuId"] = fid
    job = run_job(rc, "batch", req)
    run = rc.get("/api/runs", params={"jobIds": job["id"]}).json()["items"][0]
    vdir = rc.app.state.settings.data_dir / "variants" / run["variantId"]
    assert (vdir / "resources" / "dummy.tir").read_bytes() == b"[MDI_HEADER]\nUNLOADED_RADIUS = 0.35\n"
    assert b"0.31" in (rc.app.state.settings.data_dir / "extract" / fid / "resources" / "dummy.tir").read_bytes()


def test_search_optimization_on_nedc(rc, param, dummies):
    o = rc.post("/api/objectives", json={"name": "mean-vel", "code": MEAN_VEL}).json()
    # 설계 변수는 사실상 고정 (값이 크게 바뀌면 솔버가 실패할 수 있다) — 검증 대상은 resource 탐색
    lo, hi = sorted([param[1] * (1 - 1e-6), param[1] * (1 + 1e-6)]) if param[1] else (-1e-6, 1e-6)
    req = {"name": "opt-nedc", "fmuId": rc.fmu_id, "designVars": [{"name": param[0], "min": lo, "max": hi, "kind": "float"}],
           "objectives": [{"objectiveId": o["id"], "direction": "maximize"}], "algorithm": "tpe", "nTrials": 6,
           "fixedParams": {}, "sim": SIM, "recordVariables": [VEL], "workers": 1, "runTimeoutSec": 300,
           "resources": {"NEDC.mat": {"mode": "search", "candidateIds": [original(rc, "NEDC.mat"), dummies[1.2]]}}}
    job = run_job(rc, "optimization", req)
    page = rc.get("/api/runs", params={"jobIds": job["id"], "objectiveIds": o["id"]}).json()
    assert page["total"] == 6 and all(r["variantId"] for r in page["items"])
    by_variant: dict[str, list[float]] = {}
    for r in page["items"]:
        by_variant.setdefault(r["variantId"], []).append(r["objectives"][o["id"]]["value"])
    for vid, vals in by_variant.items():
        expected = EXPECTED[1.0] if vid == variants.original_variant_id(rc.fmu_id) else EXPECTED[1.2]
        assert all(v == pytest.approx(expected, abs=0.1) for v in vals)
