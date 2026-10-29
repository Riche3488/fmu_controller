"""resource 파일 색인과 후보 파일 관리. 후보는 (fmu_id, path, 내용 sha256)으로 식별한다."""
import hashlib
import json
import os
import shutil
import tempfile
from pathlib import Path, PurePosixPath
from typing import BinaryIO

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import Settings
from ..models import Job, ResourceCandidate, ResourceFile, Run, Variant
from . import variants

CHUNK = 1 << 20


def candidate_id(fmu_id: str, path: str, sha: str) -> str:
    return hashlib.sha256(f"{fmu_id}:{path}:{sha}".encode()).hexdigest()[:16]


def file_sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        while chunk := f.read(CHUNK):
            h.update(chunk)
    return h.hexdigest()


def index_resources(session: Session, fmu_id: str, extract_dir: Path) -> None:
    """압축해제 폴더의 resources/ 파일·원본 후보·원본 variant를 기록한다 (멱등)."""
    res_dir = Path(extract_dir) / "resources"
    known = set(session.scalars(select(ResourceFile.path).where(ResourceFile.fmu_id == fmu_id)))
    if res_dir.is_dir():
        for f in sorted(res_dir.rglob("*")):
            if not f.is_file():
                continue
            path = f.relative_to(res_dir).as_posix()
            if path in known:
                continue
            sha, size = file_sha256(f), f.stat().st_size
            session.add(ResourceFile(fmu_id=fmu_id, path=path, size=size, sha256=sha))
            session.add(ResourceCandidate(id=candidate_id(fmu_id, path, sha), fmu_id=fmu_id, path=path, name=f.name,
                                          sha256=sha, size=size, is_original=True))
    session.flush()
    variants.ensure_variant(session, fmu_id, {})
    session.commit()


def remove_variant_dir(settings: Settings, vid: str) -> None:
    """먼저 이름을 바꾼 뒤 지운다. 이름을 못 바꾸면(파일 사용 중) 폴더를 온전히 남긴다 —
    variant id는 내용으로 정해지므로 같은 조합이 다시 생기면 그대로 재사용해도 된다."""
    d = settings.data_dir / "variants" / vid
    if not d.exists():
        return
    trash = d.with_name(f".trash-{vid}-{os.getpid()}-{id(d):x}")
    try:
        os.replace(d, trash)
    except OSError:
        return
    shutil.rmtree(trash, ignore_errors=True)


def candidate_path(settings: Settings, cand: ResourceCandidate) -> Path:
    """후보 파일의 실제 위치: 원본은 압축해제 폴더, 업로드 후보는 data/resources/<fmu_id>/<sha256>."""
    if cand.is_original:
        from ..fmu.registry import get_extract_dir

        return get_extract_dir(settings, cand.fmu_id) / "resources" / Path(*cand.path.split("/"))
    return settings.data_dir / "resources" / cand.fmu_id / cand.sha256


class CandidateInUse(RuntimeError):
    pass


class OriginalCandidate(ValueError):
    pass


class UnknownResource(LookupError):
    pass


EXTENSION_ERROR = "원본과 같은 확장자({ext})의 파일만 올릴 수 있습니다"
ORIGINAL_DELETE_ERROR = "원본 파일은 삭제할 수 없습니다"
IN_USE_ERROR = "이 후보로 해석한 결과가 있어 삭제할 수 없습니다"
ACTIVE_JOB_ERROR = "실행 중이거나 대기 중인 잡이 이 후보를 쓰고 있어 삭제할 수 없습니다"


def _ext(name: str) -> str:
    return PurePosixPath(name).suffix.lower()


def run_counts(session: Session, fmu_id: str) -> dict[str, int]:
    """variant_id -> run 수"""
    rows = session.execute(select(Run.variant_id, func.count()).where(Run.fmu_id == fmu_id).group_by(Run.variant_id))
    return {vid: n for vid, n in rows if vid}


def candidate_runs(cand: ResourceCandidate, fmu_variants: list[Variant], counts: dict[str, int]) -> int:
    """그 후보를 쓰는 variant들의 run 수 합 (원본 후보는 그 path를 바꾸지 않은 variant)"""
    return sum(counts.get(v.id, 0) for v in fmu_variants
               if (cand.path not in v.assignment if cand.is_original else v.assignment.get(cand.path) == cand.id))


def list_resources(session: Session, fmu_id: str) -> list[tuple[ResourceFile, list[ResourceCandidate]]]:
    files = session.scalars(select(ResourceFile).where(ResourceFile.fmu_id == fmu_id).order_by(ResourceFile.path)).all()
    cands = session.scalars(select(ResourceCandidate).where(ResourceCandidate.fmu_id == fmu_id)
                            .order_by(ResourceCandidate.is_original.desc(), ResourceCandidate.created_at)).all()
    by_path: dict[str, list[ResourceCandidate]] = {}
    for c in cands:
        by_path.setdefault(c.path, []).append(c)
    return [(f, by_path.get(f.path, [])) for f in files]


def add_candidate(session: Session, settings: Settings, fmu_id: str, path: str, src: BinaryIO,
                  name: str) -> tuple[ResourceCandidate, bool]:
    """후보 업로드. 반환: (후보, 이미 있었는지). 같은 내용(원본 포함)이면 기존 후보를 돌려준다."""
    rf = session.get(ResourceFile, (fmu_id, path))
    if not rf:
        raise UnknownResource(path)
    ext = _ext(path)
    if _ext(name) != ext:
        raise ValueError(EXTENSION_ERROR.format(ext=ext or "없음"))
    store = settings.data_dir / "resources" / fmu_id
    store.mkdir(parents=True, exist_ok=True)
    h = hashlib.sha256()
    size = 0
    with tempfile.NamedTemporaryFile(dir=store, suffix=".upload", delete=False) as tmp:
        while chunk := src.read(CHUNK):
            h.update(chunk)
            size += len(chunk)
            tmp.write(chunk)
    tmp_path = Path(tmp.name)
    try:
        sha = h.hexdigest()
        existing = session.scalar(select(ResourceCandidate).where(
            ResourceCandidate.fmu_id == fmu_id, ResourceCandidate.path == path, ResourceCandidate.sha256 == sha))
        if existing:
            return existing, True
        dest = store / sha
        if not dest.exists():
            os.replace(tmp_path, dest)
        cand = ResourceCandidate(id=candidate_id(fmu_id, path, sha), fmu_id=fmu_id, path=path, name=name,
                                 sha256=sha, size=size, is_original=False)
        session.add(cand)
        session.commit()
        return cand, False
    finally:
        tmp_path.unlink(missing_ok=True)


def delete_candidate(session: Session, settings: Settings, fmu_id: str, cand: ResourceCandidate) -> None:
    if cand.is_original:
        raise OriginalCandidate(ORIGINAL_DELETE_ERROR)
    fmu_variants = list(session.scalars(select(Variant).where(Variant.fmu_id == fmu_id)))
    counts = run_counts(session, fmu_id)
    if candidate_runs(cand, fmu_variants, counts):
        raise CandidateInUse(IN_USE_ERROR)
    active = session.scalars(select(Job).where(Job.fmu_id == fmu_id, Job.status.in_(("queued", "running"))))
    if any(cand.id in json.dumps(j.config) for j in active):
        raise CandidateInUse(ACTIVE_JOB_ERROR)
    unused = [v for v in fmu_variants if v.assignment.get(cand.path) == cand.id]
    for v in unused:
        session.delete(v)
    session.delete(cand)
    session.commit()
    for v in unused:
        remove_variant_dir(settings, v.id)
    # 같은 내용의 파일을 다른 path 후보가 공유할 수 있다
    shared = session.scalar(select(func.count()).select_from(ResourceCandidate).where(
        ResourceCandidate.fmu_id == fmu_id, ResourceCandidate.sha256 == cand.sha256, ResourceCandidate.is_original.is_(False)))
    if not shared:
        (settings.data_dir / "resources" / fmu_id / cand.sha256).unlink(missing_ok=True)
