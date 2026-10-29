"""FMU 등록: 내용 해시로 식별, ASCII 경로에 저장·압축해제, modelDescription 변수를 DB에 적재."""
import hashlib
import json
import shutil
import tempfile
import zipfile
from pathlib import Path
from typing import BinaryIO

from fmpy import extract, read_model_description
from sqlalchemy import func, insert, or_, select, text
from sqlalchemy.orm import Session

from ..config import Settings
from ..models import Fmu, ResourceCandidate, ResourceFile, Run, Variable, Variant
from ..resources import catalog

INVALID_FMU = "유효한 FMU 파일이 아닙니다"
CHUNK = 1 << 20


class InvalidFmu(ValueError):
    pass


def fmu_file(settings: Settings, fmu_id: str) -> Path:
    return settings.data_dir / "fmus" / f"{fmu_id}.fmu"


def get_extract_dir(settings: Settings, fmu_id: str) -> Path:
    return settings.data_dir / "extract" / fmu_id


def _parse_start(type_name: str, raw):
    if raw is None:
        return None
    if type_name == "Real":
        return float(raw)
    if type_name in ("Integer", "Enumeration"):
        return int(raw)
    if type_name == "Boolean":
        return str(raw).lower() in ("true", "1")
    return str(raw)


def _float_or_none(v):
    return None if v is None else float(v)


def register_fmu(session: Session, src: BinaryIO, file_name: str, settings: Settings) -> tuple[Fmu, bool]:
    """FMU를 등록한다. 반환: (Fmu, 새로 만들었는지). 같은 내용이면 기존 레코드를 돌려준다."""
    fmus_dir = settings.data_dir / "fmus"
    h = hashlib.sha256()
    with tempfile.NamedTemporaryFile(dir=fmus_dir, suffix=".upload", delete=False) as tmp:
        while chunk := src.read(CHUNK):
            h.update(chunk)
            tmp.write(chunk)
    tmp_path = Path(tmp.name)
    fmu_id = h.hexdigest()[:16]
    try:
        existing = session.get(Fmu, fmu_id)
        if existing:
            return existing, False
        if not zipfile.is_zipfile(tmp_path):
            raise InvalidFmu(INVALID_FMU)
        with zipfile.ZipFile(tmp_path) as z:
            if "modelDescription.xml" not in z.namelist():
                raise InvalidFmu(INVALID_FMU)
        try:
            md = read_model_description(str(tmp_path), validate=False)
        except Exception as e:  # 손상된 XML 등
            raise InvalidFmu(INVALID_FMU) from e

        dest = fmu_file(settings, fmu_id)
        shutil.move(tmp_path, dest)
        extract_dir = get_extract_dir(settings, fmu_id)
        if extract_dir.exists():
            shutil.rmtree(extract_dir)
        extract(str(dest), unzipdir=str(extract_dir))

        variables = md.modelVariables
        exp = md.defaultExperiment
        fmu = Fmu(
            id=fmu_id,
            file_name=file_name,
            model_name=md.modelName,
            guid=md.guid,
            fmi_version=md.fmiVersion,
            fmi_types=[t for t, x in (("ModelExchange", md.modelExchange), ("CoSimulation", md.coSimulation)) if x],
            generation_tool=md.generationTool or "",
            default_experiment={
                "startTime": _float_or_none(exp.startTime) if exp and exp.startTime is not None else 0.0,
                "stopTime": _float_or_none(exp.stopTime) if exp and exp.stopTime is not None else 1.0,
                "tolerance": _float_or_none(exp.tolerance) if exp else None,
            },
            n_parameters=sum(v.causality == "parameter" for v in variables),
            n_outputs=sum(v.causality == "output" for v in variables),
            n_variables=len(variables),
        )
        session.add(fmu)
        session.flush()
        session.execute(insert(Variable), [
            {
                "fmu_id": fmu_id,
                "name": v.name,
                "value_reference": int(v.valueReference),
                "causality": v.causality or "local",
                "variability": v.variability or "continuous",
                "type": v.type,
                "start": json.dumps(_parse_start(v.type, v.start)),
                "unit": getattr(v, "unit", None) or (v.declaredType.unit if getattr(v, "declaredType", None) else None),
                "description": v.description,
            }
            for v in variables
        ])
        catalog.index_resources(session, fmu_id, extract_dir)  # commit 포함
        return fmu, True
    finally:
        tmp_path.unlink(missing_ok=True)


def count_runs(session: Session, fmu_id: str) -> int:
    return session.scalar(select(func.count()).select_from(Run).where(Run.fmu_id == fmu_id)) or 0


def query_variables(session: Session, fmu_id: str, q: str, causality: str | None, offset: int, limit: int):
    stmt = select(Variable).where(Variable.fmu_id == fmu_id)
    if causality and causality != "all":
        stmt = stmt.where(Variable.causality == causality)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(or_(func.lower(Variable.name).like(like), func.lower(Variable.description).like(like)))
    total = session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = session.scalars(stmt.order_by(text("variables.rowid")).offset(offset).limit(limit)).all()
    return total, rows


def delete_fmu(session: Session, fmu: Fmu, settings: Settings) -> None:
    variant_ids = list(session.scalars(select(Variant.id).where(Variant.fmu_id == fmu.id)))
    for model in (Variant, ResourceCandidate, ResourceFile, Variable):
        session.query(model).filter(model.fmu_id == fmu.id).delete()
    session.delete(fmu)
    session.commit()
    fmu_file(settings, fmu.id).unlink(missing_ok=True)
    shutil.rmtree(get_extract_dir(settings, fmu.id), ignore_errors=True)
    shutil.rmtree(settings.data_dir / "resources" / fmu.id, ignore_errors=True)
    for vid in variant_ids:
        catalog.remove_variant_dir(settings, vid)
