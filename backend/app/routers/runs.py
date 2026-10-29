import math

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from ..db import get_session
from ..models import Run
from ..results.query import ObjectiveNotFound, RunQuery, query_runs
from ..results.storage import downsample, read_result
from ..schemas import RunPage, Timeseries

router = APIRouter(prefix="/api/runs", tags=["runs"])

RUN_NOT_FOUND = "run을 찾을 수 없습니다"


def split_csv(v: str | None) -> list[str]:
    return [x for x in (v or "").split(",") if x]


def get_run_or_404(session: Session, run_id: str) -> Run:
    run = session.get(Run, run_id)
    if not run:
        raise HTTPException(404, RUN_NOT_FOUND)
    return run


def _clean(values) -> list[float | None]:
    return [None if (v is None or (isinstance(v, float) and not math.isfinite(v))) else float(v) for v in values]


@router.get("/{run_id}/timeseries", response_model=Timeseries)
def get_timeseries(
    run_id: str,
    vars: str = "",
    max_points: int = Query(2000, alias="maxPoints", ge=2, le=200000),
    session: Session = Depends(get_session),
):
    run = get_run_or_404(session, run_id)
    if run.status != "ok" or not run.result_path:
        raise HTTPException(409, "시뮬레이션이 실패한 run에는 시계열이 없습니다")
    names = split_csv(vars)
    try:
        df = downsample(read_result(run.result_path, names), max_points)
    except KeyError as e:
        missing = e.args[0] if e.args and isinstance(e.args[0], list) else [str(e)]
        raise HTTPException(400, f"기록되지 않은 변수: {', '.join(missing)}") from e
    return Timeseries(time=_clean(df["time"]), series={n: _clean(df[n]) for n in names})


@router.get("", response_model=RunPage)
async def list_runs(
    request: Request,
    fmu_id: str | None = Query(None, alias="fmuId"),
    job_ids: str | None = Query(None, alias="jobIds"),
    status: str | None = None,
    objective_ids: str | None = Query(None, alias="objectiveIds"),
    variant_ids: str | None = Query(None, alias="variantIds"),
    sort_by: str = Query("index", alias="sortBy"),
    sort_dir: str = Query("asc", alias="sortDir", pattern="^(asc|desc)$"),
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    session: Session = Depends(get_session),
):
    q = RunQuery(fmu_id=fmu_id, job_ids=split_csv(job_ids) or None, status=status,
                 objective_ids=split_csv(objective_ids) or None, variant_ids=split_csv(variant_ids) or None, sort_by=sort_by, sort_dir=sort_dir,
                 offset=offset, limit=limit)
    st = request.app.state
    try:
        # 목적함수 계산은 블로킹이므로 스레드풀에서
        return await run_in_threadpool(query_runs, session, st.settings, st.evaluator, q)
    except ObjectiveNotFound as e:
        raise HTTPException(404, f"목적함수를 찾을 수 없습니다: {e.args[0]}") from e
