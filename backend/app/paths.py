"""data 디렉터리 안의 파일 위치 (모듈 간 순환 import 없이 어디서나 쓰도록 분리)."""
from pathlib import Path

from .config import Settings


def fmu_file(settings: Settings, fmu_id: str) -> Path:
    return settings.data_dir / "fmus" / f"{fmu_id}.fmu"


def get_extract_dir(settings: Settings, fmu_id: str) -> Path:
    return settings.data_dir / "extract" / fmu_id


def variant_dir(settings: Settings, vid: str) -> Path:
    return settings.data_dir / "variants" / vid
