import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from sse_starlette.sse import EventSourceResponse

from ..db import get_session
from ..jobs.runner import ACTIVE, FmuNotFound, JobValidationError, job_out
from ..models import Job
from ..schemas import BatchRequest, JobOut, OptimizationRequest
from .fmus import FMU_NOT_FOUND

router = APIRouter(prefix="/api/jobs", tags=["jobs"])

JOB_NOT_FOUND = "잡을 찾을 수 없습니다"


def get_job_or_404(session: Session, job_id: str) -> Job:
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(404, JOB_NOT_FOUND)
    return job


def _submit(fn, req):
    try:
        return job_out(fn(req))
    except FmuNotFound as e:
        raise HTTPException(404, FMU_NOT_FOUND) from e
    except JobValidationError as e:
        raise HTTPException(422, str(e)) from e


@router.post("/batch", response_model=JobOut, status_code=201)
def create_batch(req: BatchRequest, request: Request):
    return _submit(request.app.state.jobs.submit_batch, req)


@router.post("/optimization", response_model=JobOut, status_code=201)
def create_optimization(req: OptimizationRequest, request: Request):
    return _submit(request.app.state.jobs.submit_optimization, req)


@router.get("", response_model=list[JobOut])
def list_jobs(fmu_id: str | None = Query(None, alias="fmuId"), session: Session = Depends(get_session)):
    stmt = select(Job).order_by(Job.created_at.desc())
    if fmu_id:
        stmt = stmt.where(Job.fmu_id == fmu_id)
    return [job_out(j) for j in session.scalars(stmt)]


@router.get("/{job_id}", response_model=JobOut)
def get_job(job_id: str, session: Session = Depends(get_session)):
    return job_out(get_job_or_404(session, job_id))


@router.post("/{job_id}/cancel", response_model=JobOut)
def cancel_job(job_id: str, request: Request, session: Session = Depends(get_session)):
    get_job_or_404(session, job_id)
    request.app.state.jobs.cancel(job_id)
    session.expire_all()
    return job_out(get_job_or_404(session, job_id))


@router.get("/{job_id}/events")
async def job_events(job_id: str, request: Request):
    manager = request.app.state.jobs
    # 구독을 먼저 걸고 현재 상태를 보내야 그 사이 이벤트를 놓치지 않는다
    queue = manager.subscribe(job_id, asyncio.get_running_loop())
    with request.app.state.session_factory() as s:
        job = s.get(Job, job_id)
        if not job:
            manager.unsubscribe(job_id, queue)
            raise HTTPException(404, JOB_NOT_FOUND)
        current = job_out(job).model_dump(mode="json", by_alias=True)

    async def stream():
        try:
            yield {"event": "progress", "data": json.dumps({"type": "progress", "job": current})}
            if current["status"] not in ACTIVE:
                yield {"event": "end", "data": json.dumps({"type": "end", "job": current})}
                return
            while True:
                try:
                    e = await asyncio.wait_for(queue.get(), timeout=15)
                except TimeoutError:
                    if await request.is_disconnected():
                        return
                    continue
                yield {"event": e["type"], "data": json.dumps(e)}
                if e["type"] == "end":
                    return
        finally:
            manager.unsubscribe(job_id, queue)

    return EventSourceResponse(stream(), ping=10)
