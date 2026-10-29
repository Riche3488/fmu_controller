import numpy as np
import pytest

from app.objectives.evaluator import Evaluator
from app.objectives.worker import EvalItem
from app.parallel.base import create_executor
from app.results.storage import write_result

TEMPLATE = '''import numpy as np
import pandas as pd


def evaluate(result: pd.DataFrame, params: dict) -> float:
    t = result["time"].to_numpy()
    return float(t[-1] - t[0])
'''


@pytest.fixture(scope="module")
def executor():
    ex = create_executor("pool", 2)
    yield ex
    ex.shutdown()


@pytest.fixture
def evaluator(executor):
    return Evaluator(executor, item_timeout_sec=10)


def _item(tmp_path, run_id: str, params=None) -> EvalItem:
    arr = np.zeros(51, dtype=[("time", "f8"), ("speed", "f8")])
    arr["time"] = np.linspace(0, 5, 51)
    arr["speed"] = np.linspace(0, 10, 51)
    path = tmp_path / f"{run_id}.parquet"
    write_result(path, arr)
    return EvalItem(run_id=run_id, result_path=str(path), params=params or {})


@pytest.fixture
def result_item(tmp_path) -> EvalItem:
    return _item(tmp_path, "r1", {"p": 2.0})


@pytest.fixture
def items3(tmp_path) -> list[EvalItem]:
    return [_item(tmp_path, f"r{i}", {"p": float(i)}) for i in range(3)]


def test_evaluate_returns_scalar(evaluator, result_item):
    r = evaluator.evaluate(TEMPLATE, [result_item])[result_item.run_id]
    assert r.error is None
    assert r.value == pytest.approx(5.0)


def test_params_and_columns_are_available(evaluator, result_item):
    code = "def evaluate(r, p):\n    return r['speed'].max() * p['p']\n"
    assert evaluator.evaluate(code, [result_item])["r1"].value == pytest.approx(20.0)


def test_numpy_scalar_accepted(evaluator, result_item):
    code = "import numpy as np\ndef evaluate(r, p):\n    return np.float32(1.5)\n"
    assert evaluator.evaluate(code, [result_item])["r1"].value == pytest.approx(1.5)


@pytest.mark.parametrize("ret,type_name", [("{'a': 1}", "dict"), ("'x'", "str"), ("True", "bool"), ("None", "NoneType")])
def test_non_scalar_return_rejected(evaluator, result_item, ret, type_name):
    r = evaluator.evaluate(f"def evaluate(r, p):\n    return {ret}\n", [result_item])["r1"]
    assert r.value is None
    assert r.error == f"evaluate()는 실수 하나를 반환해야 합니다 (받은 타입: {type_name})"


def test_nan_is_null_with_error(evaluator, result_item):
    r = evaluator.evaluate("def evaluate(r, p):\n    return float('nan')\n", [result_item])["r1"]
    assert r.value is None
    assert r.error == "evaluate()가 NaN 또는 무한대를 반환했습니다"


def test_missing_evaluate(evaluator, result_item):
    r = evaluator.evaluate("x = 1\n", [result_item])["r1"]
    assert r.error == "evaluate 함수가 정의되지 않았습니다"


def test_syntax_error_reports_traceback(evaluator, result_item):
    r = evaluator.evaluate("def evaluate(r, p)\n    return 1\n", [result_item])["r1"]
    assert r.value is None and "SyntaxError" in r.error


def test_runtime_error_traceback_mentions_user_line(evaluator, result_item):
    r = evaluator.evaluate("def evaluate(r, p):\n    return r['missing'].sum()\n", [result_item])["r1"]
    assert "KeyError" in r.error and "line 2" in r.error


def test_print_captured(evaluator, result_item):
    r = evaluator.evaluate("def evaluate(r, p):\n    print('hello', len(r))\n    return 1.0\n", [result_item])["r1"]
    assert r.stdout == "hello 51\n"


def test_one_bad_item_does_not_block_others(evaluator, items3):
    code = "def evaluate(r, p):\n    if p['p'] == 1.0:\n        raise RuntimeError('bad')\n    return p['p']\n"
    out = evaluator.evaluate(code, items3)
    assert out["r0"].value == 0.0 and out["r2"].value == 2.0
    assert out["r1"].value is None and "bad" in out["r1"].error


def test_infinite_loop_times_out_then_continues(executor, items3):
    ev = Evaluator(executor, item_timeout_sec=1)
    code = "def evaluate(r, p):\n    while p['p'] == 0.0:\n        pass\n    return p['p']\n"
    out = ev.evaluate(code, items3)
    assert out["r0"].value is None
    assert out["r0"].error == "목적함수 실행 시간이 1초를 초과했습니다"
    assert out["r1"].value == 1.0 and out["r2"].value == 2.0


class SpyExecutor:
    def __init__(self, inner):
        self.inner = inner
        self.submits = 0
        self.name = inner.name
        self.max_workers = inner.max_workers

    def submit(self, fn, *args):
        self.submits += 1
        return self.inner.submit(fn, *args)

    def __getattr__(self, k):
        return getattr(self.inner, k)


def test_cache_hit_same_code(executor, result_item):
    spy = SpyExecutor(executor)
    ev = Evaluator(spy)
    ev.evaluate(TEMPLATE, [result_item])
    assert spy.submits == 1
    ev.evaluate(TEMPLATE, [result_item])
    assert spy.submits == 1


def test_changed_code_recomputes(evaluator, result_item):
    a = evaluator.evaluate("def evaluate(r,p): return 1.0", [result_item])
    b = evaluator.evaluate("def evaluate(r,p): return 2.0", [result_item])
    assert (a["r1"].value, b["r1"].value) == (1.0, 2.0)


def test_timeouts_are_not_cached(executor, result_item):
    spy = SpyExecutor(executor)
    ev = Evaluator(spy, item_timeout_sec=1)
    code = "import time\ndef evaluate(r, p):\n    time.sleep(3)\n    return 1.0\n"
    ev.evaluate(code, [result_item])
    ev.evaluate(code, [result_item])
    assert spy.submits == 2


def test_evaluate_one_uncached(executor, result_item):
    spy = SpyExecutor(executor)
    ev = Evaluator(spy)
    ev.evaluate_one_uncached(TEMPLATE, result_item)
    ev.evaluate_one_uncached(TEMPLATE, result_item)
    assert spy.submits == 2
