import pytest
from pydantic import ValidationError

from app.schemas import OptimizationRequest

SIM = {"startTime": 0, "stopTime": 10, "tolerance": 1e-4, "outputInterval": 0.1}


def config(**kw):
    return {
        "designVars": [{"name": "a", "min": 0, "max": 1, "kind": "float"}],
        "objectives": [{"objectiveId": "o1", "direction": "minimize"}],
        "algorithm": "tpe", "nTrials": 20, "sim": SIM, "recordVariables": None,
        "plotVariables": [], "workers": 2, "runTimeoutSec": 600,
        "resources": {"NEDC.mat": {"mode": "search", "sha256s": ["s1", "s2"]}},
        **kw,
    }


def create(client, name="base", **kw):
    r = client.post("/api/presets", json={"name": name, "kind": "optimization", "sourceFmuId": None, "config": config(**kw)})
    assert r.status_code == 201, r.text
    return r.json()


def test_create_list_get(client):
    p = create(client)
    assert p["name"] == "base" and p["config"]["resources"]["NEDC.mat"]["sha256s"] == ["s1", "s2"]
    assert p["config"]["recordVariables"] is None and p["sourceModelName"] == ""
    assert [x["id"] for x in client.get("/api/presets?kind=optimization").json()] == [p["id"]]
    assert client.get("/api/presets?kind=batch").json() == []
    assert client.get(f"/api/presets/{p['id']}").json()["config"]["nTrials"] == 20


def test_update_and_list_order(client):
    a = create(client, "a")
    b = create(client, "b")
    r = client.put(f"/api/presets/{a['id']}", json={"name": "a2", "kind": "optimization", "config": config(nTrials=5)})
    assert r.status_code == 200 and r.json()["name"] == "a2" and r.json()["config"]["nTrials"] == 5
    assert r.json()["createdAt"] == a["createdAt"]
    # 최근에 고친 프리셋이 먼저
    assert [x["id"] for x in client.get("/api/presets").json()] == [a["id"], b["id"]]


def test_duplicate_name_409(client):
    create(client, "x")
    other = create(client, "y")
    r = client.post("/api/presets", json={"name": "x", "config": config()})
    assert r.status_code == 409 and r.json()["detail"] == "같은 이름의 프리셋이 이미 있습니다"
    r = client.put(f"/api/presets/{other['id']}", json={"name": "x", "config": config()})
    assert r.status_code == 409
    assert client.get(f"/api/presets/{other['id']}").json()["name"] == "y"


def test_blank_name_and_bad_config_rejected(client):
    assert client.post("/api/presets", json={"name": "  ", "config": config()}).status_code == 422
    assert client.post("/api/presets", json={"name": "z", "config": config(nTrials=0)}).status_code == 422


def test_delete_and_404(client):
    p = create(client)
    assert client.delete(f"/api/presets/{p['id']}").status_code == 204
    assert client.get(f"/api/presets/{p['id']}").status_code == 404
    assert client.delete(f"/api/presets/{p['id']}").json()["detail"] == "프리셋을 찾을 수 없습니다"


def test_source_model_name_survives_fmu(client, uploaded_fmu):
    r = client.post("/api/presets", json={"name": "m", "sourceFmuId": uploaded_fmu, "config": config()})
    assert r.status_code == 201
    assert r.json()["sourceModelName"] == client.get(f"/api/fmus/{uploaded_fmu}").json()["modelName"]


def opt_request(**kw):
    return OptimizationRequest.model_validate({
        "name": "o", "fmuId": "f", "sim": SIM, "recordVariables": ["x", "y"], "workers": 1, "runTimeoutSec": 10,
        "designVars": [{"name": "a", "min": 0, "max": 1}], "objectives": [{"objectiveId": "o1", "direction": "minimize"}],
        "algorithm": "tpe", "nTrials": 3, **kw,
    })


def test_plot_variables_must_be_recorded():
    assert opt_request().plot_variables == []
    assert opt_request(plotVariables=["y"]).model_dump(by_alias=True)["plotVariables"] == ["y"]
    with pytest.raises(ValidationError, match="표시 변수는 기록 변수 중에서"):
        opt_request(plotVariables=["z"])


def batch_config(**kw):
    return {
        "params": [{"name": "a", "mode": "list", "values": []}, {"name": "b", "mode": "range", "min": 0, "max": 1, "steps": 3}],
        "sampling": "zip", "nSamples": 5, "sim": SIM, "recordVariables": ["x"], "plotVariables": ["x"],
        "workers": 1, "runTimeoutSec": 60, "resources": {"NEDC.mat": ["s1", "s2"]}, **kw,
    }


def test_batch_presets_are_separate_kind(client):
    create(client, "same")
    r = client.post("/api/presets", json={"name": "same", "kind": "batch", "config": batch_config()})
    assert r.status_code == 201, r.text
    b = r.json()
    # 입력 중인 빈 목록도 저장된다
    assert b["config"]["params"][0] == {"name": "a", "mode": "list", "values": []}
    assert b["config"]["resources"] == {"NEDC.mat": ["s1", "s2"]}
    assert [p["name"] for p in client.get("/api/presets?kind=batch").json()] == ["same"]
    assert len(client.get("/api/presets").json()) == 2


def test_config_checked_against_kind(client):
    # 최적화 설정을 배치로 보내면 sampling 등은 기본값이 되지만, 잘못된 값은 거절한다
    r = client.post("/api/presets", json={"name": "bad", "kind": "batch", "config": batch_config(sampling="sobol")})
    assert r.status_code == 422 and "batch 프리셋 설정이 올바르지 않습니다" in r.text
    assert client.post("/api/presets", json={"name": "bad", "kind": "batch", "config": batch_config(nSamples=0)}).status_code == 422


def test_kind_cannot_change(client):
    p = create(client)
    r = client.put(f"/api/presets/{p['id']}", json={"name": "base", "kind": "batch", "config": batch_config()})
    assert r.status_code == 422 and r.json()["detail"] == "프리셋 종류는 바꿀 수 없습니다"


def test_batch_plot_variables_must_be_recorded():
    from app.schemas import BatchRequest

    base = {"name": "b", "fmuId": "f", "sim": SIM, "recordVariables": ["x"], "workers": 1, "runTimeoutSec": 10,
            "params": [{"name": "a", "mode": "list", "values": [1]}], "sampling": "grid"}
    assert BatchRequest.model_validate({**base, "plotVariables": ["x"]}).plot_variables == ["x"]
    with pytest.raises(ValidationError, match="표시 변수는 기록 변수 중에서"):
        BatchRequest.model_validate({**base, "plotVariables": ["y"]})


def dashboard_config(**kw):
    return {"layout": "2x3", "syncTimeZoom": False, "panels": [{"id": "p1", "type": "line", "extra": {"a": 1}}], **kw}


def test_dashboard_preset_roundtrip_and_filter(client):
    r = client.post("/api/presets", json={"name": "wb", "kind": "dashboard", "config": dashboard_config()})
    assert r.status_code == 201, r.text
    p = r.json()
    assert p["kind"] == "dashboard" and p["config"] == dashboard_config()
    assert [x["id"] for x in client.get("/api/presets?kind=dashboard").json()] == [p["id"]]
    assert client.get("/api/presets?kind=batch").json() == []
    assert client.get(f"/api/presets/{p['id']}").json()["config"]["layout"] == "2x3"


def test_dashboard_defaults_and_invalid_layout(client):
    r = client.post("/api/presets", json={"name": "d", "kind": "dashboard", "config": {}})
    assert r.status_code == 201 and r.json()["config"] == {"layout": "2x2", "syncTimeZoom": True, "panels": []}
    bad = client.post("/api/presets", json={"name": "bad", "kind": "dashboard", "config": dashboard_config(layout="4x4")})
    assert bad.status_code == 422


def test_dashboard_preset_does_not_affect_candidate_scan(client):
    from app.resources import catalog
    client.post("/api/presets", json={"name": "wb", "kind": "dashboard", "config": dashboard_config()})
    assert not hasattr(catalog, "PRESET_CONFIGS")
    assert client.get("/api/presets").status_code == 200
