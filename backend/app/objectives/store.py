"""목적함수 저장소: 코드는 data/objectives/<id>.py 최신본 1개, DB에는 이름과 코드 해시만."""
import uuid
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import Settings
from ..models import Objective, utcnow
from .evaluator import code_hash

DUPLICATE_NAME = "같은 이름의 목적함수가 이미 있습니다"


class DuplicateName(ValueError):
    pass


def code_path(settings: Settings, objective_id: str) -> Path:
    return settings.data_dir / "objectives" / f"{objective_id}.py"


def _write(settings: Settings, objective_id: str, code: str) -> None:
    p = code_path(settings, objective_id)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(code, encoding="utf-8", newline="")
    tmp.replace(p)


def _commit(session: Session) -> None:
    try:
        session.commit()
    except IntegrityError as e:
        session.rollback()
        raise DuplicateName(DUPLICATE_NAME) from e


def list_objectives(session: Session) -> list[Objective]:
    return list(session.scalars(select(Objective).order_by(Objective.name)))


def create(session: Session, settings: Settings, name: str, code: str) -> Objective:
    o = Objective(id=uuid.uuid4().hex[:12], name=name, code_hash=code_hash(code), updated_at=utcnow())
    session.add(o)
    _commit(session)
    _write(settings, o.id, code)
    return o


def update(session: Session, settings: Settings, o: Objective, name: str, code: str) -> Objective:
    o.name = name
    o.code_hash = code_hash(code)
    o.updated_at = utcnow()
    _commit(session)
    _write(settings, o.id, code)
    return o


def load_code(settings: Settings, objective_id: str) -> str:
    return code_path(settings, objective_id).read_text(encoding="utf-8")


def load(settings: Settings, objective_id: str) -> tuple[str, str]:
    """(code, code_hash). 해시는 파일 내용에서 다시 계산한다."""
    code = load_code(settings, objective_id)
    return code, code_hash(code)


def delete(session: Session, settings: Settings, o: Objective) -> None:
    session.delete(o)
    session.commit()
    code_path(settings, o.id).unlink(missing_ok=True)
