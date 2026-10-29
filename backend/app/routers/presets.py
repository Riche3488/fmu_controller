"""잡 설정 프리셋 CRUD. 설정 내용은 프론트가 채우고 서버는 형식만 검사한다."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import get_session
from ..models import Fmu, Preset, utcnow
from ..schemas import PresetIn, PresetOut

router = APIRouter(prefix="/api/presets", tags=["presets"])

PRESET_NOT_FOUND = "프리셋을 찾을 수 없습니다"
DUPLICATE_NAME = "같은 이름의 프리셋이 이미 있습니다"


def get_preset_or_404(session: Session, preset_id: str) -> Preset:
    p = session.get(Preset, preset_id)
    if not p:
        raise HTTPException(404, PRESET_NOT_FOUND)
    return p


def _apply(session: Session, p: Preset, body: PresetIn) -> None:
    p.name = body.name
    p.kind = body.kind
    p.config = body.config
    p.updated_at = utcnow()
    # 원본 FMU가 나중에 지워져도 어떤 모델용이었는지 보이도록 이름을 같이 남긴다
    if body.source_fmu_id != p.source_fmu_id or not p.source_model_name:
        fmu = session.get(Fmu, body.source_fmu_id) if body.source_fmu_id else None
        p.source_model_name = fmu.model_name if fmu else ""
    p.source_fmu_id = body.source_fmu_id


def _commit(session: Session, p: Preset) -> None:
    try:
        session.commit()
    except IntegrityError as e:
        session.rollback()
        raise HTTPException(409, DUPLICATE_NAME) from e
    # 목록 조회와 같은 시각 표기가 되도록 DB 값으로 다시 읽는다
    session.refresh(p)


@router.get("", response_model=list[PresetOut])
def list_presets(kind: str | None = Query(None), session: Session = Depends(get_session)):
    stmt = select(Preset).order_by(Preset.updated_at.desc())
    if kind:
        stmt = stmt.where(Preset.kind == kind)
    return list(session.scalars(stmt))


@router.post("", response_model=PresetOut, status_code=201)
def create_preset(body: PresetIn, session: Session = Depends(get_session)):
    p = Preset(id=uuid.uuid4().hex[:12], created_at=utcnow())
    _apply(session, p, body)
    session.add(p)
    _commit(session, p)
    return p


@router.get("/{preset_id}", response_model=PresetOut)
def get_preset(preset_id: str, session: Session = Depends(get_session)):
    return get_preset_or_404(session, preset_id)


@router.put("/{preset_id}", response_model=PresetOut)
def update_preset(preset_id: str, body: PresetIn, session: Session = Depends(get_session)):
    p = get_preset_or_404(session, preset_id)
    if body.kind != p.kind:
        raise HTTPException(422, "프리셋 종류는 바꿀 수 없습니다")
    _apply(session, p, body)
    _commit(session, p)
    return p


@router.delete("/{preset_id}", status_code=204)
def delete_preset(preset_id: str, session: Session = Depends(get_session)):
    session.delete(get_preset_or_404(session, preset_id))
    session.commit()
