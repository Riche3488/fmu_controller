import numpy as np
import pytest
from sqlalchemy import func, select

from app.db import Base
from app.models import Job, Run
from app.results.storage import write_result

CODE = "def evaluate(r, p):\n    return p['p'] * 2\n"


@pytest.fixture
def runs(app, client, settings, uploaded_fmu):
    arr = np.zeros(11, dtype=[("time", "f8"), ("speed", "f8")])
    arr["time"] = np.linspace(0, 10, 11)
    with app.state.session_factory() as s:
        s.add(Job(id="j1", kind="batch", name="j", fmu_id=uploaded_fmu, status="done", config={}))
        for i, pv in enumerate([3.0, 5.0]):
            path = settings.data_dir / "results" / "j1" / f"r{i}.parquet"
            write_result(path, arr)
            s.add(Run(id=f"r{i}", job_id="j1", fmu_id=uploaded_fmu, index=i, params={"p": pv}, status="ok", result_path=str(path)))
        s.add(Run(id="rf", job_id="j1", fmu_id=uploaded_fmu, index=2, params={"p": 1.0}, status="failed", result_path=None))
        s.commit()


def counts(app):
    with app.state.session_factory() as s:
        return {t.name: s.scalar(select(func.count()).select_from(t)) for t in Base.metadata.sorted_tables}


def test_batch_mixed(app, client, runs):
    before = counts(app)
    r = client.post("/api/objectives/test-batch", json={"code": CODE, "runIds": ["r1", "nope", "rf", "r0"]})
    assert r.status_code == 200, r.text
    res = r.json()["results"]
    assert list(res) == ["r1", "nope", "rf", "r0"]
    assert res["r1"]["value"] == 10.0 and res["r1"]["error"] is None
    assert res["r0"]["value"] == 6.0
    assert res["nope"] == {"value": None, "error": "run을 찾을 수 없습니다", "stdout": "", "durationMs": 0}
    assert res["rf"]["error"] == "시뮬레이션이 실패한 run으로는 테스트할 수 없습니다"
    assert res["rf"]["value"] is None
    assert counts(app) == before


def test_batch_limits(client):
    assert client.post("/api/objectives/test-batch", json={"code": CODE, "runIds": [f"r{i}" for i in range(201)]}).status_code == 422
    assert client.post("/api/objectives/test-batch", json={"code": CODE, "runIds": []}).status_code == 422
