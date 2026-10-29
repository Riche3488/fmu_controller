"""워커 프로세스에서 실행되는 목적함수 평가 (최상위 함수, 피클 가능)."""
import contextlib
import io
import math
import numbers
import time
import traceback
from dataclasses import dataclass

from ..results.storage import read_result

MISSING_EVALUATE = "evaluate 함수가 정의되지 않았습니다"
NOT_FINITE = "evaluate()가 NaN 또는 무한대를 반환했습니다"
OBJECTIVE_FILENAME = "<objective>"


def not_scalar_message(value) -> str:
    return f"evaluate()는 실수 하나를 반환해야 합니다 (받은 타입: {type(value).__name__})"


@dataclass
class EvalItem:
    run_id: str
    result_path: str
    params: dict


@dataclass
class EvalResult:
    value: float | None
    error: str | None
    stdout: str = ""
    duration_ms: int = 0


def _user_traceback(e: BaseException) -> str:
    """사용자 코드 프레임만 남긴 traceback"""
    tb = traceback.TracebackException.from_exception(e)
    tb.stack = traceback.StackSummary.from_list([f for f in tb.stack if f.filename == OBJECTIVE_FILENAME])
    return "".join(tb.format()).strip()


def to_scalar(value) -> tuple[float | None, str | None]:
    if isinstance(value, bool) or not isinstance(value, numbers.Real):
        # numpy bool_도 numbers.Real이 아니므로 여기서 걸린다
        return None, not_scalar_message(value)
    v = float(value)
    if not math.isfinite(v):
        return None, NOT_FINITE
    return v, None


def evaluate_item(code: str, item: EvalItem) -> EvalResult:
    t0 = time.perf_counter()
    out = io.StringIO()
    value, error = None, None
    try:
        with contextlib.redirect_stdout(out):
            namespace: dict = {"__name__": "objective"}
            exec(compile(code, OBJECTIVE_FILENAME, "exec"), namespace)
            fn = namespace.get("evaluate")
            if not callable(fn):
                error = MISSING_EVALUATE
            else:
                value, error = to_scalar(fn(read_result(item.result_path), dict(item.params)))
    except Exception as e:
        value, error = None, _user_traceback(e)
    return EvalResult(value=value, error=error, stdout=out.getvalue(), duration_ms=int((time.perf_counter() - t0) * 1000))
