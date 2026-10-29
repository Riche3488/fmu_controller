from pathlib import Path

import pytest
from sqlalchemy import inspect

from app.config import Settings


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_settings_rejects_non_ascii_data_dir():
    with pytest.raises(ValueError, match="data_dir must be ASCII-only"):
        Settings(data_dir=Path("D:/복사본"))


def test_tables_created_without_objective_value_storage(app, client):
    insp = inspect(app.state.engine)
    assert set(insp.get_table_names()) == {"fmus", "variables", "objectives", "jobs", "runs", "resource_files", "resource_candidates", "variants", "presets"}
    runs_cols = {c["name"] for c in insp.get_columns("runs")}
    assert runs_cols == {"id", "job_id", "fmu_id", "index", "params", "status", "error", "elapsed_sec", "result_path", "variant_id"}
    objective_cols = {c["name"] for c in insp.get_columns("objectives")}
    assert objective_cols == {"id", "name", "code_hash", "updated_at"}
    # 프리셋은 설정(목적함수 id·방향)만 담는다
    preset_cols = {c["name"] for c in insp.get_columns("presets")}
    assert preset_cols == {"id", "kind", "name", "source_fmu_id", "source_model_name", "config", "created_at", "updated_at"}


def test_data_dirs_created(settings, client):
    for sub in ("fmus", "extract", "results", "objectives", "work"):
        assert (settings.data_dir / sub).is_dir()
