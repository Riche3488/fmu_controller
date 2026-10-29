import hashlib

import numpy as np
import pytest

from app.models import Job, Run
from app.results.storage import write_result

CODE1 = "def evaluate(r, p):\n    return 1.0\n"
CODE2 = "def evaluate(r, p):\n    return 2.0\n"


def sha(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


def create(client, name="fuel", code=CODE1):
    r = client.post("/api/objectives", json={"name": name, "code": code})
    assert r.status_code == 201, r.text
    return r.json()


def test_create_get_list(client, settings):
    o = create(client)
    assert o["name"] == "fuel" and o["code"] == CODE1 and o["codeHash"] == sha(CODE1)
    assert client.get(f"/api/objectives/{o['id']}").json()["code"] == CODE1
    assert [x["id"] for x in client.get("/api/objectives").json()] == [o["id"]]
    assert (settings.data_dir / "objectives" / f"{o['id']}.py").read_text(encoding="utf-8") == CODE1


def test_update_overwrites_and_changes_hash(client, settings):
    o = create(client)
    r = client.put(f"/api/objectives/{o['id']}", json={"name": "fuel2", "code": CODE2})
    assert r.status_code == 200
    u = r.json()
    assert u["codeHash"] == sha(CODE2) and u["name"] == "fuel2"
    files = sorted(p.name for p in (settings.data_dir / "objectives").iterdir())
    assert files == [f"{o['id']}.py"]
    assert client.get(f"/api/objectives/{o['id']}").json()["code"] == CODE2


def test_duplicate_name_409(client):
    o = create(client)
    r = client.post("/api/objectives", json={"name": "fuel", "code": CODE2})
    assert r.status_code == 409 and r.json()["detail"] == "같은 이름의 목적함수가 이미 있습니다"
    other = create(client, "comfort")
    r = client.put(f"/api/objectives/{other['id']}", json={"name": "fuel", "code": CODE2})
    assert r.status_code == 409
    assert o["id"] != other["id"]


def test_blank_name_rejected(client):
    assert client.post("/api/objectives", json={"name": "  ", "code": CODE1}).status_code == 422


def test_delete(client, settings):
    o = create(client)
    assert client.delete(f"/api/objectives/{o['id']}").status_code == 204
    assert client.get(f"/api/objectives/{o['id']}").status_code == 404
    assert not (settings.data_dir / "objectives" / f"{o['id']}.py").exists()


def test_not_found(client):
    assert client.get("/api/objectives/nope").status_code == 404
    assert client.put("/api/objectives/nope", json={"name": "x", "code": CODE1}).status_code == 404


@pytest.fixture
def ok_run(app, client, settings, uploaded_fmu) -> str:
    arr = np.zeros(11, dtype=[("time", "f8"), ("speed", "f8")])
    arr["time"] = np.linspace(0, 10, 11)
    path = settings.data_dir / "results" / "j1" / "r1.parquet"
    write_result(path, arr)
    with app.state.session_factory() as s:
        s.add(Job(id="j1", kind="batch", name="j", fmu_id=uploaded_fmu, status="done", config={}))
        s.add(Run(id="r1", job_id="j1", fmu_id=uploaded_fmu, index=0, params={"p": 3.0}, status="ok", result_path=str(path)))
        s.commit()
    return "r1"


def test_test_endpoint_uses_unsaved_code(client, ok_run):
    r = client.post("/api/objectives/test", json={"code": "def evaluate(r, p):\n    print('x')\n    return p['p'] * 2\n", "runId": ok_run})
    body = r.json()
    assert r.status_code == 200
    assert body["value"] == 6.0 and body["error"] is None and body["stdout"] == "x\n"
    assert body["durationMs"] >= 0


def test_test_endpoint_error(client, ok_run):
    body = client.post("/api/objectives/test", json={"code": "x = 1", "runId": ok_run}).json()
    assert body["value"] is None and body["error"] == "evaluate 함수가 정의되지 않았습니다"


def test_test_endpoint_unknown_run(client):
    assert client.post("/api/objectives/test", json={"code": CODE1, "runId": "nope"}).status_code == 404
