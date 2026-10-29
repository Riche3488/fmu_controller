import os

import pytest

from app.fmu.simulate import SimTask, run_simulation
from app.results.storage import read_result
from app.schemas import SimSettings

SPEED = "controlBus.chassisBus.longitudinalVelocity"
CD = "vehicle.body.aerodynamics.Cd"


def make_task(extract_dir, tmp_path, name="r", start_values=None, stop=5.0, record=None):
    return SimTask(
        fmu_id="test",
        extract_dir=str(extract_dir),
        start_values=start_values or {},
        sim=SimSettings(start_time=0.0, stop_time=stop, tolerance=1e-4, output_interval=0.1),
        record_variables=record if record is not None else [SPEED],
        out_path=str(tmp_path / f"{name}.parquet"),
        work_dir=str(tmp_path / f"work-{name}"),
    )


def test_short_simulation_writes_parquet(extract_dir, tmp_path, output_names):
    task = make_task(extract_dir, tmp_path, record=output_names[:3])
    out = run_simulation(task)
    assert out.ok, out.error
    df = read_result(task.out_path)
    assert list(df.columns) == ["time", *output_names[:3]]
    assert out.columns == list(df.columns)
    assert df["time"].iloc[-1] == pytest.approx(5.0)
    assert out.elapsed_sec > 0


def test_start_value_is_applied(extract_dir, tmp_path):
    base = make_task(extract_dir, tmp_path, "base", stop=20.0)
    draggy = make_task(extract_dir, tmp_path, "draggy", start_values={CD: 5.0}, stop=20.0)
    assert run_simulation(base).ok and run_simulation(draggy).ok
    v0 = read_result(base.out_path)[SPEED].iloc[-1]
    v1 = read_result(draggy.out_path)[SPEED].iloc[-1]
    assert v1 != pytest.approx(v0, rel=1e-6)


def test_unknown_variable_returns_failed(extract_dir, tmp_path):
    out = run_simulation(make_task(extract_dir, tmp_path, start_values={"nope": 1.0}))
    assert not out.ok
    assert "nope" in out.error
    assert not os.path.exists(tmp_path / "r.parquet")


def test_runs_in_own_work_dir_and_restores_cwd(extract_dir, tmp_path):
    cwd = os.getcwd()
    task = make_task(extract_dir, tmp_path)
    assert run_simulation(task).ok
    assert os.getcwd() == cwd
    assert not os.path.exists(task.work_dir)


def test_work_dir_cleaned_on_failure(extract_dir, tmp_path):
    task = make_task(extract_dir, tmp_path, start_values={"nope": 1.0})
    run_simulation(task)
    assert not os.path.exists(task.work_dir)
