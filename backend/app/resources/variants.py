"""Resource 조합(variant): id는 FMU와 바꾼 파일 내용으로만 결정된다 (이름·업로드 순서와 무관)."""
import hashlib
import posixpath

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import ResourceCandidate, Variant

ORIGINAL_LABEL = "원본"


class InvalidAssignment(ValueError):
    pass


def variant_id(fmu_id: str, replaced: list[tuple[str, str]]) -> str:
    """replaced: 원본이 아닌 후보의 (path, 후보 sha256) 목록"""
    key = fmu_id + "".join(f"\n{path}={sha}" for path, sha in sorted(replaced))
    return hashlib.sha256(key.encode()).hexdigest()[:16]


def original_variant_id(fmu_id: str) -> str:
    return variant_id(fmu_id, [])


def ensure_variant(session: Session, fmu_id: str, assignment: dict[str, str]) -> Variant:
    """assignment(path -> 후보 id)에 해당하는 variant를 찾거나 만든다. 원본 후보는 조합에서 뺀다."""
    replaced: dict[str, ResourceCandidate] = {}
    for path, cid in assignment.items():
        cand = session.get(ResourceCandidate, cid)
        if not cand or cand.fmu_id != fmu_id or cand.path != path:
            raise InvalidAssignment(f"{path}의 후보가 아닙니다: {cid}")
        if not cand.is_original:
            replaced[path] = cand
    vid = variant_id(fmu_id, [(p, c.sha256) for p, c in replaced.items()])
    v = session.get(Variant, vid)
    if v:
        return v
    v = Variant(id=vid, fmu_id=fmu_id, assignment={p: c.id for p, c in sorted(replaced.items())})
    session.add(v)
    try:
        session.commit()
    except IntegrityError:  # 다른 잡이 같은 조합을 동시에 만든 경우
        session.rollback()
        v = session.get(Variant, vid)
    return v


def variant_label(session: Session, v: Variant) -> str:
    if not v.assignment:
        return ORIGINAL_LABEL
    parts = []
    for path in sorted(v.assignment):
        cand = session.get(ResourceCandidate, v.assignment[path])
        parts.append(f"{posixpath.basename(path)}={cand.name if cand else '?'}")
    return ", ".join(parts)
