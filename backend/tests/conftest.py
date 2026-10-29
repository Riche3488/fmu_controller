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


@pytest.fixture
def uploaded_fmu(client, fmu_path) -> str:
    r = client.post("/api/fmus", files={"file": ("my 복사본.fmu", fmu_path.read_bytes())})
    assert r.status_code == 201, r.text
    return r.json()["id"]


@pytest.fixture(scope="session")
def extract_dir(tmp_path_factory, fmu_path) -> Path:
    """세션당 한 번 압축 해제한 FMU (시뮬레이션 테스트용, ASCII 경로)."""
    from fmpy import extract

    d = tmp_path_factory.mktemp("fmu_extract")
    assert str(d).isascii()
    extract(str(fmu_path), unzipdir=str(d))
    return d


@pytest.fixture(scope="session")
def output_names(extract_dir) -> list[str]:
    from fmpy import read_model_description

    md = read_model_description(str(extract_dir), validate=False)
    return [v.name for v in md.modelVariables if v.causality == "output"]
