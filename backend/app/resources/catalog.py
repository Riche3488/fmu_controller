"""resource 파일 색인과 후보 파일 관리. 후보는 (fmu_id, path, 내용 sha256)으로 식별한다."""
import hashlib
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import Settings
from ..models import ResourceCandidate, ResourceFile
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


def candidate_path(settings: Settings, cand: ResourceCandidate) -> Path:
    """후보 파일의 실제 위치: 원본은 압축해제 폴더, 업로드 후보는 data/resources/<fmu_id>/<sha256>."""
    if cand.is_original:
        from ..fmu.registry import get_extract_dir

        return get_extract_dir(settings, cand.fmu_id) / "resources" / Path(*cand.path.split("/"))
    return settings.data_dir / "resources" / cand.fmu_id / cand.sha256
