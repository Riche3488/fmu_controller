"""Resource 조합(variant): id는 FMU와 바꾼 파일 내용으로만 결정된다 (이름·업로드 순서와 무관)."""
import hashlib
import os
import posixpath
import shutil
import threading
import uuid
from pathlib import Path

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import Settings
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


_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock(vid: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(vid, threading.Lock())


def _link_or_copy(src: str, dst: str) -> None:
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def materialize(settings: Settings, session: Session, v: Variant) -> Path:
    """variant 실행 폴더를 돌려준다. 원본은 압축해제 폴더 그대로, 그 외는 data/variants/<id>/ (없으면 만든다).

    원본 폴더를 하드링크(불가하면 복사)로 복제하고, 교체 파일은 링크를 끊은 뒤 실제 복사한다
    (하드링크된 원본 파일을 덮어쓰면 원본이 바뀌기 때문)."""
    from ..fmu.registry import get_extract_dir
    from .catalog import candidate_path

    src = get_extract_dir(settings, v.fmu_id)
    if not v.assignment:
        return src
    dest = settings.data_dir / "variants" / v.id
    if dest.is_dir():
        return dest
    with _lock(v.id):
        if dest.is_dir():
            return dest
        tmp = dest.with_name(f".tmp-{v.id}-{uuid.uuid4().hex[:8]}")
        try:
            shutil.copytree(src, tmp, copy_function=_link_or_copy)
            for path, cid in v.assignment.items():
                target = tmp / "resources" / Path(*path.split("/"))
                target.unlink(missing_ok=True)
                shutil.copy2(candidate_path(settings, session.get(ResourceCandidate, cid)), target)
            os.replace(tmp, dest)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    return dest
