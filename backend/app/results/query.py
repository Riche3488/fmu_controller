"""run 목록 조회. objectiveIds가 있으면 각 목적함수의 현재 코드로 값을 계산해 붙인다 (DB에는 저장하지 않음)."""
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import Settings
from ..models import Objective, Run
from ..objectives import store
from ..objectives.evaluator import Evaluator
from ..objectives.worker import EvalItem
from ..schemas import ObjectiveValue, RunPage, RunRow

SIM_FAILED = "시뮬레이션 실패"


class ObjectiveNotFound(LookupError):
    pass


@dataclass
class RunQuery:
    fmu_id: str | None = None
    job_ids: list[str] | None = None
    status: str | None = None
    objective_ids: list[str] | None = None
    variant_ids: list[str] | None = None
    sort_by: str = "index"
    sort_dir: str = "asc"
    offset: int = 0
    limit: int = 100


def _sort_key(sort_by: str, values: dict[str, dict[str, ObjectiveValue]]):
    def key(r: Run):
        if sort_by == "index":
            v = r.index
        elif sort_by == "elapsedSec":
            v = r.elapsed_sec
        elif sort_by.startswith("param:"):
            v = r.params.get(sort_by[6:])
            v = float(v) if isinstance(v, (int, float)) else None
        elif sort_by.startswith("objective:"):
            ov = values.get(r.id, {}).get(sort_by[10:])
            v = ov.value if ov else None
        else:
            v = r.index
        return v
    return key


def evaluate_runs(evaluator: Evaluator, codes: dict[str, str], runs: list[Run]) -> dict[str, dict[str, ObjectiveValue]]:
    """run_id -> objective_id -> 값. 실패한 run은 '시뮬레이션 실패'."""
    out: dict[str, dict[str, ObjectiveValue]] = {r.id: {} for r in runs}
    ok = [r for r in runs if r.status == "ok" and r.result_path]
    items = [EvalItem(run_id=r.id, result_path=r.result_path, params=r.params) for r in ok]
    for oid, code in codes.items():
        res = evaluator.evaluate(code, items) if items else {}
        for r in runs:
            if r.id in res:
                out[r.id][oid] = ObjectiveValue(value=res[r.id].value, error=res[r.id].error)
            else:
                out[r.id][oid] = ObjectiveValue(value=None, error=SIM_FAILED)
    return out


def query_runs(session: Session, settings: Settings, evaluator: Evaluator, q: RunQuery) -> RunPage:
    stmt = select(Run)
    if q.fmu_id:
        stmt = stmt.where(Run.fmu_id == q.fmu_id)
    if q.job_ids:
        stmt = stmt.where(Run.job_id.in_(q.job_ids))
    if q.status:
        stmt = stmt.where(Run.status == q.status)
    if q.variant_ids:
        stmt = stmt.where(Run.variant_id.in_(q.variant_ids))
    runs = list(session.scalars(stmt.order_by(Run.job_id, Run.index)))

    objective_ids = list(dict.fromkeys(q.objective_ids or []))
    codes: dict[str, str] = {}
    code_hashes: dict[str, str] = {}
    for oid in objective_ids:
        if not session.get(Objective, oid):
            raise ObjectiveNotFound(oid)
        codes[oid], code_hashes[oid] = store.load(settings, oid)

    desc = q.sort_dir == "desc"
    values: dict[str, dict[str, ObjectiveValue]] = {}
    if q.sort_by.startswith("objective:") and q.sort_by[10:] in codes:
        # 목적함수로 정렬하려면 필터된 run 전체를 계산해야 한다
        values = evaluate_runs(evaluator, codes, runs)
    key = _sort_key(q.sort_by, values)
    present = [r for r in runs if key(r) is not None]
    absent = [r for r in runs if key(r) is None]  # 값 없음은 방향과 무관하게 마지막
    ordered = sorted(present, key=key, reverse=desc) + absent
    page = ordered[q.offset:q.offset + q.limit]
    if codes and not values:
        values = evaluate_runs(evaluator, codes, page)

    items = [RunRow(id=r.id, job_id=r.job_id, fmu_id=r.fmu_id, index=r.index, params=r.params, status=r.status,
                    error=r.error, elapsed_sec=r.elapsed_sec, variant_id=r.variant_id,
                    objectives=values.get(r.id, {})) for r in page]
    return RunPage(total=len(runs), items=items, code_hashes=code_hashes)
