"""후보 파일 API: 목록·업로드·삭제·미리보기·variant 목록."""
import io

from app.models import Job, Run
from app.resources import catalog, variants
from tests.test_runner import FMU_ID, seed_fake_fmu


def resources(client, fmu_id):
    r = client.get(f"/api/fmus/{fmu_id}/resources")
    assert r.status_code == 200, r.text
    return {f["path"]: f for f in r.json()}


def upload(client, fmu_id, path, name, data: bytes):
    return client.post(f"/api/fmus/{fmu_id}/resources/candidates", data={"path": path},
                       files={"file": (name, io.BytesIO(data))})


def test_list_resources_has_original_first(client, uploaded_fmu):
    res = resources(client, uploaded_fmu)
    assert set(res) == {"NEDC.mat", "RoadWithStops.mat", "StraightRoad.mat"}
    c = res["NEDC.mat"]["candidates"]
    assert len(c) == 1 and c[0]["isOriginal"] and c[0]["name"] == "NEDC.mat" and c[0]["nRuns"] == 0
    assert c[0]["sha256"] == res["NEDC.mat"]["sha256"] and res["NEDC.mat"]["size"] == 2882


def test_upload_candidate_201_then_same_content_200_existing(client, uploaded_fmu):
    r1 = upload(client, uploaded_fmu, "NEDC.mat", "a.mat", b"dummy-a")
    assert r1.status_code == 201, r1.text
    assert r1.json()["existing"] is False and r1.json()["name"] == "a.mat"
    r2 = upload(client, uploaded_fmu, "NEDC.mat", "renamed.mat", b"dummy-a")
    assert r2.status_code == 200
    assert r2.json()["existing"] is True and r2.json()["id"] == r1.json()["id"] and r2.json()["name"] == "a.mat"
    assert [c["name"] for c in resources(client, uploaded_fmu)["NEDC.mat"]["candidates"]] == ["NEDC.mat", "a.mat"]


def test_upload_same_as_original_returns_original(client, uploaded_fmu, settings):
    orig = (settings.data_dir / "extract" / uploaded_fmu / "resources" / "NEDC.mat").read_bytes()
    r = upload(client, uploaded_fmu, "NEDC.mat", "copy.mat", orig)
    assert r.status_code == 200 and r.json()["isOriginal"] and r.json()["existing"]
    assert len(resources(client, uploaded_fmu)["NEDC.mat"]["candidates"]) == 1


def test_upload_wrong_extension_400(client, uploaded_fmu):
    r = upload(client, uploaded_fmu, "NEDC.mat", "a.csv", b"x")
    assert r.status_code == 400 and r.json()["detail"] == "원본과 같은 확장자(.mat)의 파일만 올릴 수 있습니다"


def test_upload_extension_case_insensitive(client, uploaded_fmu):
    assert upload(client, uploaded_fmu, "NEDC.mat", "A.MAT", b"upper").status_code == 201


def test_upload_unknown_path_404(client, uploaded_fmu):
    assert upload(client, uploaded_fmu, "nope.mat", "a.mat", b"x").status_code == 404


def _fake_with_resource(app, settings, rel: str, data: bytes):
    seed_fake_fmu(app.state.session_factory)
    f = settings.data_dir / "extract" / FMU_ID / "resources" / rel
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_bytes(data)
    with app.state.session_factory() as s:
        catalog.index_resources(s, FMU_ID, settings.data_dir / "extract" / FMU_ID)


def test_korean_candidate_name_and_subfolder_path(app, client, settings):
    _fake_with_resource(app, settings, "sub/table.csv", b"t,v\n0,1\n")
    r = upload(client, FMU_ID, "sub/table.csv", "한글 표.csv", b"t,v\n0,2\n")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["name"] == "한글 표.csv" and body["path"] == "sub/table.csv"
    stored = settings.data_dir / "resources" / FMU_ID / body["sha256"]
    assert stored.read_bytes() == b"t,v\n0,2\n"
    p = client.get(f"/api/fmus/{FMU_ID}/resources/candidates/{body['id']}/preview").json()
    assert p == {"kind": "text", "text": "t,v\n0,2\n", "truncated": False}


def test_preview_mat_variables_and_plot(client, uploaded_fmu):
    cid = resources(client, uploaded_fmu)["NEDC.mat"]["candidates"][0]["id"]
    base = f"/api/fmus/{uploaded_fmu}/resources/candidates/{cid}/preview"
    p = client.get(base).json()
    assert p["kind"] == "mat" and p["plot"] is None
    assert {"name": "table", "shape": [119, 3], "dtype": "float64"} in p["variables"]
    p2 = client.get(base, params={"var": "table"}).json()
    rows = p2["plot"]["rows"]
    assert p2["plot"]["name"] == "table" and 0 < len(rows) <= 2000 and all(len(r) == 3 for r in rows)
    assert rows[0] == [0.0, 0.0, 0.0]


def test_preview_long_text_truncated(app, client, settings):
    _fake_with_resource(app, settings, "big.txt", b"a" * (300 * 1024))
    cid = resources(client, FMU_ID)["big.txt"]["candidates"][0]["id"]
    p = client.get(f"/api/fmus/{FMU_ID}/resources/candidates/{cid}/preview").json()
    assert p["kind"] == "text" and p["truncated"] is True and len(p["text"]) == 256 * 1024


def test_preview_binary(app, client, settings):
    _fake_with_resource(app, settings, "blob.bin", b"\x00\x01\x02" * 100)
    cid = resources(client, FMU_ID)["blob.bin"]["candidates"][0]["id"]
    p = client.get(f"/api/fmus/{FMU_ID}/resources/candidates/{cid}/preview").json()
    assert p == {"kind": "binary", "note": "미리보기를 지원하지 않는 바이너리 파일입니다"}


def test_preview_corrupt_mat_is_binary(client, uploaded_fmu):
    cid = upload(client, uploaded_fmu, "NEDC.mat", "broken.mat", b"\x00not a mat file").json()["id"]
    p = client.get(f"/api/fmus/{uploaded_fmu}/resources/candidates/{cid}/preview").json()
    assert p["kind"] == "binary"


def test_delete_original_400(client, uploaded_fmu):
    cid = resources(client, uploaded_fmu)["NEDC.mat"]["candidates"][0]["id"]
    r = client.delete(f"/api/fmus/{uploaded_fmu}/resources/candidates/{cid}")
    assert r.status_code == 400 and r.json()["detail"] == "원본 파일은 삭제할 수 없습니다"


def test_delete_unused_candidate_204(client, uploaded_fmu, settings):
    body = upload(client, uploaded_fmu, "NEDC.mat", "a.mat", b"unused").json()
    assert client.delete(f"/api/fmus/{uploaded_fmu}/resources/candidates/{body['id']}").status_code == 204
    assert len(resources(client, uploaded_fmu)["NEDC.mat"]["candidates"]) == 1
    assert not (settings.data_dir / "resources" / uploaded_fmu / body["sha256"]).exists()


def test_delete_candidate_in_use_409(app, client, uploaded_fmu):
    cid = upload(client, uploaded_fmu, "NEDC.mat", "used.mat", b"used").json()["id"]
    with app.state.session_factory() as s:
        v = variants.ensure_variant(s, uploaded_fmu, {"NEDC.mat": cid})
        s.add(Job(id="j1", kind="batch", name="x", fmu_id=uploaded_fmu, status="done", config={}))
        s.add(Run(id="r1", job_id="j1", fmu_id=uploaded_fmu, index=0, params={}, status="ok", variant_id=v.id))
        s.commit()
    r = client.delete(f"/api/fmus/{uploaded_fmu}/resources/candidates/{cid}")
    assert r.status_code == 409 and r.json()["detail"] == "이 후보로 해석한 결과가 있어 삭제할 수 없습니다"
    cands = resources(client, uploaded_fmu)["NEDC.mat"]["candidates"]
    assert [c["nRuns"] for c in cands] == [0, 1]
    vs = client.get(f"/api/fmus/{uploaded_fmu}/variants").json()
    assert [(v["label"], v["isOriginal"], v["nRuns"]) for v in vs] == [("원본", True, 0), ("NEDC.mat=used.mat", False, 1)]


def test_list_variants_labels(client, uploaded_fmu):
    vs = client.get(f"/api/fmus/{uploaded_fmu}/variants").json()
    assert vs == [{"id": variants.original_variant_id(uploaded_fmu), "fmuId": uploaded_fmu, "label": "원본",
                   "assignment": {}, "isOriginal": True, "nRuns": 0}]


def test_resources_unknown_fmu_404(client):
    assert client.get("/api/fmus/nope/resources").status_code == 404
    assert client.get("/api/fmus/nope/variants").status_code == 404
