import io
import time
import zipfile

import pytest

from app.models import Fmu


def test_upload_parses_real_fmu(client, fmu_path):
    t = time.time()
    r = client.post("/api/fmus", files={"file": ("my 복사본.fmu", fmu_path.read_bytes())})
    elapsed = time.time() - t
    body = r.json()
    assert r.status_code == 201, r.text
    assert body["modelName"] == "my_test.DriveCycleAT"
    assert body["fileName"] == "my 복사본.fmu"
    assert body["fmiTypes"] == ["ModelExchange"]
    assert (body["nParameters"], body["nOutputs"], body["nVariables"]) == (2867, 140, 54616)
    assert body["defaultExperiment"] == {"startTime": 0.0, "stopTime": 1400.0, "tolerance": 1e-4}
    assert body["nRuns"] == 0
    assert len(body["id"]) == 16
    assert elapsed < 10


def test_reupload_same_content_returns_same_id(app, client, fmu_path):
    data = fmu_path.read_bytes()
    a = client.post("/api/fmus", files={"file": ("a.fmu", data)})
    b = client.post("/api/fmus", files={"file": ("b.fmu", data)})
    assert a.status_code == 201 and b.status_code == 200
    assert a.json()["id"] == b.json()["id"]
    with app.state.session_factory() as s:
        assert s.query(Fmu).count() == 1


def test_list_and_get(client, uploaded_fmu):
    assert [f["id"] for f in client.get("/api/fmus").json()] == [uploaded_fmu]
    assert client.get(f"/api/fmus/{uploaded_fmu}").json()["guid"] == "{d96e27c5-094f-41dc-b0b1-183535ae4553}"
    assert client.get("/api/fmus/nope").status_code == 404


def test_variables_search_paginates(client, uploaded_fmu):
    r = client.get(f"/api/fmus/{uploaded_fmu}/variables",
                   params={"q": "road.stopTable", "causality": "parameter", "limit": 2})
    body = r.json()
    assert body["total"] >= 2 and len(body["items"]) == 2
    first = body["items"][0]
    assert first["name"] == "road.stopTable[1,1]"
    assert first["start"] == 45
    assert first["type"] == "Real"
    assert first["causality"] == "parameter"


def test_variables_search_is_case_insensitive_and_matches_description(client, uploaded_fmu):
    r = client.get(f"/api/fmus/{uploaded_fmu}/variables", params={"q": "DRAG COEFFICIENT", "causality": "parameter"})
    names = [v["name"] for v in r.json()["items"]]
    assert "vehicle.body.aerodynamics.Cd" in names


def test_variables_offset_and_all_causality(client, uploaded_fmu):
    r1 = client.get(f"/api/fmus/{uploaded_fmu}/variables", params={"offset": 0, "limit": 100})
    r2 = client.get(f"/api/fmus/{uploaded_fmu}/variables", params={"causality": "all", "offset": 100, "limit": 100})
    assert r1.json()["total"] == r2.json()["total"] == 54616
    assert {v["name"] for v in r1.json()["items"]}.isdisjoint({v["name"] for v in r2.json()["items"]})


def test_boolean_start_values(client, uploaded_fmu):
    r = client.get(f"/api/fmus/{uploaded_fmu}/variables", params={"q": "road.tableBasedStops"})
    assert r.json()["items"][0]["start"] is True


def test_rejects_non_fmu(client):
    r = client.post("/api/fmus", files={"file": ("x.fmu", b"not a zip")})
    assert r.status_code == 400
    assert r.json()["detail"] == "유효한 FMU 파일이 아닙니다"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("hello.txt", "x")
    r = client.post("/api/fmus", files={"file": ("y.fmu", buf.getvalue())})
    assert r.status_code == 400


def test_stored_paths_are_ascii(client, settings, uploaded_fmu):
    paths = list(settings.data_dir.rglob("*"))
    assert any(p.suffix == ".fmu" for p in paths)
    assert (settings.data_dir / "extract" / uploaded_fmu / "modelDescription.xml").exists()
    assert all(str(p).isascii() for p in paths)


def test_delete_without_runs(client, settings, uploaded_fmu):
    assert client.delete(f"/api/fmus/{uploaded_fmu}").status_code == 204
    assert client.get("/api/fmus").json() == []
    assert not (settings.data_dir / "fmus" / f"{uploaded_fmu}.fmu").exists()
