"""빌더 TS 평가기와 생성된 Python 코드의 패리티.

fixture는 frontend의 `UPDATE_PARITY=1 npm test -- parity`가 만든다 (TS가 기준).
"""
import json
from pathlib import Path

import numpy as np
import pytest

from app.objectives.worker import EvalItem, evaluate_item
from app.results.storage import write_result

FIXTURE = Path(__file__).parent / "fixtures" / "builder_parity.json"
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))


def _write(path: Path, data: dict) -> None:
    cols = {"time": data["time"], **data["cols"]}
    arr = np.zeros(len(data["time"]), dtype=[(k, "f8") for k in cols])
    for k, v in cols.items():
        arr[k] = v
    write_result(path, arr)


def test_fixture_not_empty():
    assert len(CASES) >= 25


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_parity(case, tmp_path):
    path = tmp_path / "r.parquet"
    _write(path, case["data"])
    item = EvalItem(run_id=case["name"], result_path=str(path), params=case["data"]["params"])
    result = evaluate_item(case["code"], item)
    exp = case["expected"]
    if exp["error"] is not None:
        assert result.value is None
        assert result.error is not None and exp["error"] in result.error
    else:
        assert result.error is None, result.error
        assert result.value == pytest.approx(exp["value"], rel=1e-9, abs=1e-12)
