from pathlib import PurePosixPath

from fastapi import APIRouter, Depends, Form, HTTPException, Request, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_session
from ..models import ResourceCandidate, Variant
from ..resources import catalog, variants
from ..resources.preview import PreviewError, preview
from ..schemas import CandidateUploadOut, ResourceCandidateOut, ResourceFileOut, VariantOut
from .fmus import get_fmu_or_404

router = APIRouter(prefix="/api/fmus/{fmu_id}", tags=["resources"])

CANDIDATE_NOT_FOUND = "후보를 찾을 수 없습니다"


def _candidate_or_404(session: Session, fmu_id: str, cid: str) -> ResourceCandidate:
    cand = session.get(ResourceCandidate, cid)
    if not cand or cand.fmu_id != fmu_id:
        raise HTTPException(404, CANDIDATE_NOT_FOUND)
    return cand


def _candidate_out(cand: ResourceCandidate, n_runs: int) -> ResourceCandidateOut:
    return ResourceCandidateOut(id=cand.id, path=cand.path, name=cand.name, size=cand.size, sha256=cand.sha256,
                                is_original=cand.is_original, n_runs=n_runs, created_at=cand.created_at)


def _fmu_variants(session: Session, fmu_id: str) -> list[Variant]:
    vs = session.scalars(select(Variant).where(Variant.fmu_id == fmu_id).order_by(Variant.created_at)).all()
    original = variants.original_variant_id(fmu_id)
    return sorted(vs, key=lambda v: v.id != original)  # 원본 먼저


@router.get("/resources", response_model=list[ResourceFileOut])
def list_resources(fmu_id: str, session: Session = Depends(get_session)):
    get_fmu_or_404(session, fmu_id)
    vs, counts = _fmu_variants(session, fmu_id), catalog.run_counts(session, fmu_id)
    return [
        ResourceFileOut(path=f.path, size=f.size, sha256=f.sha256,
                        candidates=[_candidate_out(c, catalog.candidate_runs(c, vs, counts)) for c in cands])
        for f, cands in catalog.list_resources(session, fmu_id)
    ]


@router.post("/resources/candidates", response_model=CandidateUploadOut, status_code=201)
def upload_candidate(fmu_id: str, request: Request, response: Response, file: UploadFile, path: str = Form(...),
                     session: Session = Depends(get_session)):
    get_fmu_or_404(session, fmu_id)
    try:
        cand, existing = catalog.add_candidate(session, request.app.state.settings, fmu_id, path, file.file,
                                               file.filename or path.rsplit("/", 1)[-1])
    except catalog.UnknownResource as e:
        raise HTTPException(404, f"resource 파일이 없습니다: {e.args[0]}") from e
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    if existing:
        response.status_code = 200
    n = catalog.candidate_runs(cand, _fmu_variants(session, fmu_id), catalog.run_counts(session, fmu_id))
    return CandidateUploadOut(**_candidate_out(cand, n).model_dump(), existing=existing)


@router.delete("/resources/candidates/{cid}", status_code=204)
def delete_candidate(fmu_id: str, cid: str, request: Request, session: Session = Depends(get_session)):
    get_fmu_or_404(session, fmu_id)
    cand = _candidate_or_404(session, fmu_id, cid)
    try:
        catalog.delete_candidate(session, request.app.state.settings, fmu_id, cand)
    except catalog.OriginalCandidate as e:
        raise HTTPException(400, str(e)) from e
    except catalog.CandidateInUse as e:
        raise HTTPException(409, str(e)) from e


# preview()가 kind별 계약 형태(CandidatePreviewOut 참고) 그대로의 dict를 만든다
@router.get("/resources/candidates/{cid}/preview")
def preview_candidate(fmu_id: str, cid: str, request: Request, var: str | None = None,
                      session: Session = Depends(get_session)):
    get_fmu_or_404(session, fmu_id)
    cand = _candidate_or_404(session, fmu_id, cid)
    path = catalog.candidate_path(request.app.state.settings, cand)
    if not path.is_file():
        raise HTTPException(404, "후보 파일이 디스크에 없습니다")
    try:
        return preview(path, var, ext=PurePosixPath(cand.path).suffix)
    except PreviewError as e:
        raise HTTPException(400, str(e)) from e


@router.get("/variants", response_model=list[VariantOut])
def list_variants(fmu_id: str, session: Session = Depends(get_session)):
    get_fmu_or_404(session, fmu_id)
    counts = catalog.run_counts(session, fmu_id)
    return [VariantOut(id=v.id, fmu_id=v.fmu_id, label=variants.variant_label(session, v), assignment=v.assignment,
                       is_original=not v.assignment, n_runs=counts.get(v.id, 0))
            for v in _fmu_variants(session, fmu_id)]
