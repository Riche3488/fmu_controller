from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_session
from ..models import Objective, Run
from ..objectives import store
from ..objectives.worker import EvalItem
from ..schemas import (
    ObjectiveIn,
    ObjectiveOut,
    ObjectiveTestBatchIn,
    ObjectiveTestBatchOut,
    ObjectiveTestIn,
    ObjectiveTestResult,
)
from .runs import get_run_or_404

router = APIRouter(prefix="/api/objectives", tags=["objectives"])

OBJECTIVE_NOT_FOUND = "목적함수를 찾을 수 없습니다"


def get_objective_or_404(session: Session, objective_id: str) -> Objective:
    o = session.get(Objective, objective_id)
    if not o:
        raise HTTPException(404, OBJECTIVE_NOT_FOUND)
    return o


def to_out(request: Request, o: Objective) -> ObjectiveOut:
    code = store.load_code(request.app.state.settings, o.id)
    return ObjectiveOut(id=o.id, name=o.name, code=code, code_hash=o.code_hash, updated_at=o.updated_at)


@router.get("", response_model=list[ObjectiveOut])
def list_objectives(request: Request, session: Session = Depends(get_session)):
    return [to_out(request, o) for o in store.list_objectives(session)]


@router.post("", response_model=ObjectiveOut, status_code=201)
def create_objective(body: ObjectiveIn, request: Request, session: Session = Depends(get_session)):
    try:
        o = store.create(session, request.app.state.settings, body.name, body.code)
    except store.DuplicateName as e:
        raise HTTPException(409, str(e)) from e
    return to_out(request, o)


@router.post("/test", response_model=ObjectiveTestResult)
async def test_objective(body: ObjectiveTestIn, request: Request, session: Session = Depends(get_session)):
    """저장 전 코드로 run 하나를 계산한다 (캐시 미사용)."""
    run = get_run_or_404(session, body.run_id)
    if run.status != "ok" or not run.result_path:
        raise HTTPException(409, "시뮬레이션이 실패한 run으로는 테스트할 수 없습니다")
    item = EvalItem(run_id=run.id, result_path=run.result_path, params=run.params)
    r = await run_in_threadpool(request.app.state.evaluator.evaluate_one_uncached, body.code, item)
    return ObjectiveTestResult(value=r.value, error=r.error, stdout=r.stdout, duration_ms=r.duration_ms)


@router.post("/test-batch", response_model=ObjectiveTestBatchOut)
async def test_objective_batch(body: ObjectiveTestBatchIn, request: Request, session: Session = Depends(get_session)):
    """저장 전 코드로 run 여러 개를 한 번에 계산한다. run별 오류는 그 run 결과에만 담는다."""
    found = {r.id: r for r in session.scalars(select(Run).where(Run.id.in_(body.run_ids)))}
    results: dict[str, ObjectiveTestResult] = {}
    items: list[EvalItem] = []
    for rid in body.run_ids:
        run = found.get(rid)
        if run is None:
            msg = "run을 찾을 수 없습니다"
        elif run.status != "ok" or not run.result_path:
            msg = "시뮬레이션이 실패한 run으로는 테스트할 수 없습니다"
        else:
            items.append(EvalItem(run_id=run.id, result_path=run.result_path, params=run.params))
            continue
        results[rid] = ObjectiveTestResult(value=None, error=msg, stdout="", duration_ms=0)
    evaluated = await run_in_threadpool(request.app.state.evaluator.evaluate, body.code, items) if items else {}
    out: dict[str, ObjectiveTestResult] = {}
    for rid in body.run_ids:
        if rid in results:
            out[rid] = results[rid]
        else:
            r = evaluated[rid]
            out[rid] = ObjectiveTestResult(value=r.value, error=r.error, stdout=r.stdout, duration_ms=r.duration_ms)
    return ObjectiveTestBatchOut(results=out)


@router.get("/{objective_id}", response_model=ObjectiveOut)
def get_objective(objective_id: str, request: Request, session: Session = Depends(get_session)):
    return to_out(request, get_objective_or_404(session, objective_id))


@router.put("/{objective_id}", response_model=ObjectiveOut)
def update_objective(objective_id: str, body: ObjectiveIn, request: Request, session: Session = Depends(get_session)):
    o = get_objective_or_404(session, objective_id)
    try:
        o = store.update(session, request.app.state.settings, o, body.name, body.code)
    except store.DuplicateName as e:
        raise HTTPException(409, str(e)) from e
    return to_out(request, o)


@router.delete("/{objective_id}", status_code=204)
def delete_objective(objective_id: str, request: Request, session: Session = Depends(get_session)):
    store.delete(session, request.app.state.settings, get_objective_or_404(session, objective_id))
