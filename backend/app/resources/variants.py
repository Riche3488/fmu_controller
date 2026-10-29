"""Resource 조합(variant): id는 FMU와 바꾼 파일 내용으로만 결정된다 (이름·업로드 순서와 무관)."""
import hashlib
import os
import posixpath
import shutil
import threading
import uuid
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from ..config import Settings
from ..models import ResourceCandidate, Variant
from ..paths import get_extract_dir, variant_dir

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
    # 다른 잡이 같은 조합을 동시에 만들 수 있다. IntegrityError → rollback은 호출자가 아직 commit하지 않은
    # 작업까지 버리므로, 충돌을 무시하는 INSERT로 만든다.
    session.execute(sqlite_insert(Variant).values(
        id=vid, fmu_id=fmu_id, assignment={p: c.id for p, c in sorted(replaced.items())}).on_conflict_do_nothing())
    session.commit()
    return session.get(Variant, vid)


def variant_labels(session: Session, fmu_id: str, vs: list[Variant]) -> dict[str, str]:
    """variant id -> 표시 이름. 후보를 한 번에 읽어 만든다 (variant·path마다 쿼리하지 않는다)."""
    cands = {c.id: c for c in session.scalars(select(ResourceCandidate).where(ResourceCandidate.fmu_id == fmu_id))}
    names: dict[tuple[str, str], int] = {}
    for c in cands.values():
        names[(c.path, c.name)] = names.get((c.path, c.name), 0) + 1

    def display(cid: str) -> str:
        c = cands.get(cid)
        if c is None:
            return "?"
        # 같은 path에 같은 이름의 후보가 또 있으면(예: 수정본을 원래 이름으로 여러 번 업로드) 해시 앞 8자를 붙인다
        return f"{c.name}[{c.sha256[:8]}]" if names[(c.path, c.name)] > 1 else c.name

    return {v.id: ", ".join(f"{posixpath.basename(p)}={display(v.assignment[p])}" for p in sorted(v.assignment))
            or ORIGINAL_LABEL for v in vs}


def variant_label(session: Session, v: Variant) -> str:
    return variant_labels(session, v.fmu_id, [v])[v.id]


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
    from .catalog import candidate_path  # catalog가 이 모듈을 import한다

    src = get_extract_dir(settings, v.fmu_id)
    if not v.assignment:
        return src
    dest = variant_dir(settings, v.id)
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
