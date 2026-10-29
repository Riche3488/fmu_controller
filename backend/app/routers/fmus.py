import json

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_session
from ..fmu import registry
from ..models import Fmu, Run
from ..schemas import DefaultExperiment, FmuSummary, Page, VariableOut

router = APIRouter(prefix="/api/fmus", tags=["fmus"])

FMU_NOT_FOUND = "FMU를 찾을 수 없습니다"
HAS_RUNS = "이 FMU에 저장된 해석 결과가 있어 삭제할 수 없습니다"


def to_summary(fmu: Fmu, n_runs: int) -> FmuSummary:
    return FmuSummary(
        id=fmu.id, file_name=fmu.file_name, model_name=fmu.model_name, guid=fmu.guid,
        fmi_version=fmu.fmi_version, fmi_types=fmu.fmi_types, generation_tool=fmu.generation_tool,
        default_experiment=DefaultExperiment.model_validate(fmu.default_experiment),
        n_parameters=fmu.n_parameters, n_outputs=fmu.n_outputs, n_variables=fmu.n_variables,
        uploaded_at=fmu.uploaded_at, n_runs=n_runs,
    )


def get_fmu_or_404(session: Session, fmu_id: str) -> Fmu:
    fmu = session.get(Fmu, fmu_id)
    if not fmu:
        raise HTTPException(404, FMU_NOT_FOUND)
    return fmu


@router.get("", response_model=list[FmuSummary])
def list_fmus(session: Session = Depends(get_session)):
    counts = dict(session.execute(select(Run.fmu_id, func.count()).group_by(Run.fmu_id)).all())
    fmus = session.scalars(select(Fmu).order_by(Fmu.uploaded_at.desc())).all()
    return [to_summary(f, counts.get(f.id, 0)) for f in fmus]


@router.post("", response_model=FmuSummary, status_code=201)
def upload_fmu(file: UploadFile, request: Request, response: Response, session: Session = Depends(get_session)):
    try:
        fmu, created = registry.register_fmu(session, file.file, file.filename or "model.fmu", request.app.state.settings)
    except registry.InvalidFmu as e:
        raise HTTPException(400, str(e)) from e
    if not created:
        response.status_code = 200
    return to_summary(fmu, registry.count_runs(session, fmu.id))


@router.get("/{fmu_id}", response_model=FmuSummary)
def get_fmu(fmu_id: str, session: Session = Depends(get_session)):
    fmu = get_fmu_or_404(session, fmu_id)
    return to_summary(fmu, registry.count_runs(session, fmu.id))


@router.delete("/{fmu_id}", status_code=204)
def delete_fmu(fmu_id: str, request: Request, session: Session = Depends(get_session)):
    fmu = get_fmu_or_404(session, fmu_id)
    if registry.count_runs(session, fmu_id):
        raise HTTPException(409, HAS_RUNS)
    registry.delete_fmu(session, fmu, request.app.state.settings)


@router.get("/{fmu_id}/variables", response_model=Page[VariableOut])
def list_variables(
    fmu_id: str,
    q: str = "",
    causality: str | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    session: Session = Depends(get_session),
):
    get_fmu_or_404(session, fmu_id)
    total, rows = registry.query_variables(session, fmu_id, q, causality, offset, limit)
    items = [
        VariableOut(
            name=v.name, value_reference=v.value_reference, causality=v.causality, variability=v.variability,
            type=v.type, start=json.loads(v.start) if v.start is not None else None, unit=v.unit, description=v.description,
        )
        for v in rows
    ]
    return Page[VariableOut](total=total, items=items)
