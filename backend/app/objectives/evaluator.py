"""목적함수 온디맨드 평가기. 값은 저장하지 않고 (run_id, code_hash) 메모리 캐시로만 재사용한다."""
import hashlib
import threading
import time
from collections import OrderedDict
from concurrent.futures import Future

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
        self._pending: dict[tuple[str, str], Future] = {}  # 계산 중인 (run_id, code_hash) — 동시 요청 중복 제거
        self._lock = threading.Lock()
        # 동시에 들어온 여러 요청이 공유하는 평가 슬롯 (큐 대기가 타임아웃에 포함되지 않도록)
        self._slots = threading.BoundedSemaphore(max(1, executor.max_workers))

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
        """항목마다 작업 제출. 공유 슬롯을 얻은 뒤에만 제출하고, 각 작업은 시작 후 item_timeout_sec를 넘기면 강제 취소한다."""
        out: dict[str, EvalResult] = {}
        queue = list(items)
        inflight: dict = {}  # handle -> (item, started)
        gen = self.executor.generation
        timeout_err = EvalResult(None, timeout_message(self.item_timeout_sec))

        def finish(h) -> EvalItem:
            item, _ = inflight.pop(h)
            self._slots.release()
            return item

        try:
            while queue or inflight:
                while queue and self._slots.acquire(blocking=False):
                    item = queue.pop(0)
                    inflight[self.executor.submit(evaluate_item, code, item)] = (item, time.monotonic())
                if not inflight:
                    time.sleep(0.05)
                    continue
                for h in self.executor.wait_any(list(inflight), timeout=0.2):
                    item = finish(h)
                    try:
                        out[item.run_id] = self.executor.result(h)
                    except TaskCancelled:
                        out[item.run_id] = timeout_err
                    except Exception as e:  # 워커 크래시 등
                        out[item.run_id] = EvalResult(None, f"목적함수 실행 실패: {e}")
                if self.executor.generation != gen:
                    gen = self.executor.generation
                    now = time.monotonic()
                    inflight = {h: (it, now) for h, (it, _) in inflight.items()}
                now = time.monotonic()
                for h in [h for h, (_, t) in inflight.items() if now - t > self.item_timeout_sec]:
                    item = finish(h)
                    self.executor.cancel(h, force=True)
                    try:
                        self.executor.result(h)
                    except Exception:
                        pass
                    out[item.run_id] = timeout_err
        finally:
            for h in list(inflight):
                finish(h)
                self.executor.cancel(h, force=True)
        return out

    def evaluate(self, code: str, items: list[EvalItem]) -> dict[str, EvalResult]:
        h = code_hash(code)
        out: dict[str, EvalResult] = {}
        mine: list[EvalItem] = []  # 이 호출이 직접 계산할 항목
        waiting: dict[str, Future] = {}  # 다른 호출이 계산 중인 항목
        with self._lock:
            for it in items:
                key = (it.run_id, h)
                cached = self._cache.get(key)
                if cached is not None:
                    self._cache.move_to_end(key)
                    out[it.run_id] = cached
                elif key in self._pending:
                    waiting[it.run_id] = self._pending[key]
                else:
                    self._pending[key] = Future()
                    mine.append(it)
        if mine:
            timeout_err = timeout_message(self.item_timeout_sec)
            results: dict[str, EvalResult] = {}
            try:
                results = self._run(code, mine)
            finally:
                for it in mine:
                    r = results.get(it.run_id) or EvalResult(None, "목적함수 실행 실패")
                    out[it.run_id] = r
                    if r.error != timeout_err and it.run_id in results:
                        self._put((it.run_id, h), r)
                    with self._lock:
                        fut = self._pending.pop((it.run_id, h))
                    fut.set_result(r)
        for run_id, fut in waiting.items():
            out[run_id] = fut.result()
        return out

    def evaluate_one_uncached(self, code: str, item: EvalItem) -> EvalResult:
        return self._run(code, [item])[item.run_id]
