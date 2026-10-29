"""목적함수 온디맨드 평가기. 값은 저장하지 않고 (run_id, code_hash) 메모리 캐시로만 재사용한다."""
import hashlib
import threading
import time
from collections import OrderedDict

from ..parallel.base import ParallelExecutor, TaskCancelled
from .worker import EvalItem, EvalResult, evaluate_item


def code_hash(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def timeout_message(sec: float) -> str:
    return f"목적함수 실행 시간이 {sec:g}초를 초과했습니다"


class Evaluator:
    def __init__(self, executor: ParallelExecutor, item_timeout_sec: float = 10.0, cache_size: int = 200_000):
        self.executor = executor
        self.item_timeout_sec = item_timeout_sec
        self.cache_size = cache_size
        self._cache: OrderedDict[tuple[str, str], EvalResult] = OrderedDict()
        self._lock = threading.Lock()

    def _get(self, key):
        with self._lock:
            r = self._cache.get(key)
            if r is not None:
                self._cache.move_to_end(key)
            return r

    def _put(self, key, r: EvalResult):
        with self._lock:
            self._cache[key] = r
            self._cache.move_to_end(key)
            while len(self._cache) > self.cache_size:
                self._cache.popitem(last=False)

    def _run(self, code: str, items: list[EvalItem]) -> dict[str, EvalResult]:
        """항목마다 작업 제출. 동시 실행은 executor.max_workers로 제한하고 (큐 대기가 타임아웃에 포함되지 않도록)
        각 작업은 시작 후 item_timeout_sec를 넘기면 강제 취소한다."""
        out: dict[str, EvalResult] = {}
        queue = list(items)
        inflight: dict = {}  # handle -> (item, started)
        limit = max(1, self.executor.max_workers)
        while queue or inflight:
            while queue and len(inflight) < limit:
                item = queue.pop(0)
                inflight[self.executor.submit(evaluate_item, code, item)] = (item, time.monotonic())
            for h in self.executor.wait_any(list(inflight), timeout=0.2):
                item, _ = inflight.pop(h)
                try:
                    out[item.run_id] = self.executor.result(h)
                except TaskCancelled:
                    out[item.run_id] = EvalResult(None, timeout_message(self.item_timeout_sec))
                except Exception as e:  # 워커 크래시 등
                    out[item.run_id] = EvalResult(None, f"목적함수 실행 실패: {e}")
            now = time.monotonic()
            overdue = [h for h, (_, t) in inflight.items() if now - t > self.item_timeout_sec]
            for h in overdue:
                item, _ = inflight.pop(h)
                self.executor.cancel(h, force=True)
                try:
                    self.executor.result(h)
                except Exception:
                    pass
                out[item.run_id] = EvalResult(None, timeout_message(self.item_timeout_sec))
            if overdue:
                # Pool 폴백은 취소 시 풀을 재시작하고 나머지를 다시 제출하므로 시작 시각을 갱신한다
                now = time.monotonic()
                inflight = {h: (it, now) for h, (it, _) in inflight.items()}
        return out

    def evaluate(self, code: str, items: list[EvalItem]) -> dict[str, EvalResult]:
        h = code_hash(code)
        out: dict[str, EvalResult] = {}
        missing = []
        for it in items:
            cached = self._get((it.run_id, h))
            if cached is not None:
                out[it.run_id] = cached
            else:
                missing.append(it)
        if missing:
            timeout_err = timeout_message(self.item_timeout_sec)
            for run_id, r in self._run(code, missing).items():
                out[run_id] = r
                if r.error != timeout_err:
                    self._put((run_id, h), r)
        return out

    def evaluate_one_uncached(self, code: str, item: EvalItem) -> EvalResult:
        return self._run(code, [item])[item.run_id]
