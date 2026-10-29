import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

BACKEND_DIR = Path(__file__).resolve().parents[1]
DEFAULT_TEST_FMU = BACKEND_DIR.parent / "my_0test_DriveCycleAT.fmu"


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(data_dir=tmp_path / "data", parallel="pool", max_workers=2)


@pytest.fixture
def app(settings):
    return create_app(settings)


@pytest.fixture
def client(app):
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def fmu_path() -> Path:
    p = Path(os.environ.get("FMUC_TEST_FMU", DEFAULT_TEST_FMU))
    if not p.exists():
        pytest.skip(f"test FMU not found: {p}")
    return p
