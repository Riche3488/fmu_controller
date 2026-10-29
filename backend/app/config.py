import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

ParallelMode = Literal["auto", "ray", "pool"]

DEFAULT_DATA_DIR = Path(__file__).resolve().parents[1] / "data"
DEFAULT_STATIC_DIR = Path(__file__).resolve().parents[2] / "frontend" / "dist"
SUBDIRS = ("fmus", "extract", "results", "objectives", "work")


def _default_workers() -> int:
    return max(1, (os.cpu_count() or 2) - 1)


@dataclass(frozen=True)
class Settings:
    """앱 설정. 모든 저장 경로는 ASCII여야 한다 (FMU DLL 로딩 문제 회피)."""

    data_dir: Path = DEFAULT_DATA_DIR
    parallel: ParallelMode = "auto"
    max_workers: int = field(default_factory=_default_workers)
    # 빌드된 프론트엔드 (없으면 API만 제공)
    static_dir: Path = DEFAULT_STATIC_DIR

    def __post_init__(self):
        object.__setattr__(self, "data_dir", Path(self.data_dir).resolve())
        if not str(self.data_dir).isascii():
            raise ValueError(f"data_dir must be ASCII-only: {self.data_dir}")
        if self.parallel not in ("auto", "ray", "pool"):
            raise ValueError(f"parallel must be auto|ray|pool: {self.parallel}")

    @classmethod
    def from_env(cls) -> "Settings":
        kwargs = {}
        if v := os.environ.get("FMUC_DATA_DIR"):
            kwargs["data_dir"] = Path(v)
        if v := os.environ.get("FMUC_PARALLEL"):
            kwargs["parallel"] = v
        if v := os.environ.get("FMUC_MAX_WORKERS"):
            kwargs["max_workers"] = int(v)
        if v := os.environ.get("FMUC_STATIC_DIR"):
            kwargs["static_dir"] = Path(v)
        return cls(**kwargs)

    @property
    def db_path(self) -> Path:
        return self.data_dir / "app.db"

    def ensure_dirs(self) -> None:
        for sub in SUBDIRS:
            (self.data_dir / sub).mkdir(parents=True, exist_ok=True)
