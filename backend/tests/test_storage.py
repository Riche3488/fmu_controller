import numpy as np
import pytest

from app.models import Job, Run
from app.results.storage import downsample, read_result, write_result


def structured(n=10_001):
    t = np.linspace(0, 100, n)
    arr = np.zeros(n, dtype=[("time", "f8"), ("a.b[1]", "f8"), ("flag", "?")])
    arr["time"] = t
    arr["a.b[1]"] = np.sin(t)
    arr["flag"] = t > 50
    return arr


def test_roundtrip_keeps_column_names(tmp_path):
    p = tmp_path / "x.parquet"
    write_result(p, structured(11))
    df = read_result(p)
    assert list(df.columns) == ["time", "a.b[1]", "flag"]
    assert df["flag"].iloc[-1]


def test_read_selected_columns(tmp_path):
    p = tmp_path / "x.parquet"
    write_result(p, structured(11))
    assert list(read_result(p, ["a.b[1]"]).columns) == ["time", "a.b[1]"]


def test_downsample_keeps_endpoints():
    import pandas as pd
    df = pd.DataFrame(structured())
    small = downsample(df, 2000)
    assert len(small) <= 2000
    assert small["time"].iloc[0] == 0
    assert small["time"].iloc[-1] == 100


def test_downsample_noop_when_small():
    import pandas as pd
    df = pd.DataFrame(structured(50))
    assert len(downsample(df, 2000)) == 50


@pytest.fixture
def stored_run(app, client, settings, uploaded_fmu):
    path = settings.data_dir / "results" / "j1" / "r1.parquet"
    path.parent.mkdir(parents=True)
    write_result(path, structured(101))
    with app.state.session_factory() as s:
        s.add(Job(id="j1", kind="batch", name="j", fmu_id=uploaded_fmu, status="done", config={}))
        s.add(Run(id="r1", job_id="j1", fmu_id=uploaded_fmu, index=0, params={}, status="ok", result_path=str(path)))
        s.commit()
    return "r1"


def test_timeseries_endpoint(client, stored_run):
    r = client.get(f"/api/runs/{stored_run}/timeseries", params={"vars": "a.b[1]", "maxPoints": 20})
    assert r.status_code == 200
    body = r.json()
    assert len(body["time"]) <= 20 and body["time"][-1] == 100
    assert list(body["series"]) == ["a.b[1]"]
    assert len(body["series"]["a.b[1]"]) == len(body["time"])


def test_timeseries_unknown_run_404(client):
    assert client.get("/api/runs/nope/timeseries", params={"vars": "x"}).status_code == 404
