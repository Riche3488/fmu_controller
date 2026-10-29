"""이전 버전 DB 보정: runs.variant_id 추가, 기존 FMU resource 색인, 기존 run을 원본 variant로."""
from sqlalchemy import Engine, inspect, select, text, update
from sqlalchemy.orm import Session, sessionmaker

from ..config import Settings
from ..models import Fmu, Run, Variant
from . import catalog, variants


def migrate(engine: Engine, session_factory: sessionmaker[Session], settings: Settings) -> None:
    cols = {c["name"] for c in inspect(engine).get_columns("runs")}
    if "variant_id" not in cols:
        with engine.begin() as c:
            c.execute(text("ALTER TABLE runs ADD COLUMN variant_id VARCHAR(16)"))
            c.execute(text("CREATE INDEX IF NOT EXISTS ix_runs_variant_id ON runs (variant_id)"))

    from ..fmu.registry import get_extract_dir

    with session_factory() as s:
        for fmu in s.scalars(select(Fmu)).all():
            if not s.get(Variant, variants.original_variant_id(fmu.id)):
                catalog.index_resources(s, fmu.id, get_extract_dir(settings, fmu.id))
        for fmu_id in s.scalars(select(Run.fmu_id).where(Run.variant_id.is_(None)).distinct()).all():
            v = variants.ensure_variant(s, fmu_id, {})
            s.execute(update(Run).where(Run.fmu_id == fmu_id, Run.variant_id.is_(None)).values(variant_id=v.id))
        s.commit()
