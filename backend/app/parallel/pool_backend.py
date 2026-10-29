"""multiprocessing.Pool 기반 실행기 (Ray 폴백)."""
import multiprocessing as mp
import threading
import time
from multiprocessing.pool import AsyncResult, Pool
from typing import Any

from .base import TaskCancelled, TaskHandle

POLL_SEC = 0.02


class _Entry:
    __slots__ = ("fn", "args", "ar", "gen", "cancelled")

    def __init__(self, fn, args, ar: AsyncResult, gen: int):
        self.fn, self.args, self.ar, self.gen, self.cancelled = fn, args, ar, gen, False


class PoolExecutor:
    """Pool은 작업 하나만 죽일 수 없으므로 force cancel 시 풀 전체를 terminate하고,
    같은 풀에서 돌던 다른 미완료 작업은 같은 인자로 다시 제출한다 (핸들은 유지)."""

    name = "pool"

    def __init__(self, max_workers: int):
        self.max_workers = max(1, max_workers)
        self._ctx = mp.get_context("spawn")
        self._pool: Pool | None = None
        self._gen = 0
        self._entries: dict[TaskHandle, _Entry] = {}
        self._lock = threading.RLock()

    @property
    def generation(self) -> int:
        return self._gen

    def _get_pool(self) -> Pool:
        if self._pool is None:
            self._pool = self._ctx.Pool(self.max_workers, maxtasksperchild=50)
        return self._pool

    def submit(self, fn, *args) -> TaskHandle:
        with self._lock:
            h = TaskHandle()
            self._entries[h] = _Entry(fn, args, self._get_pool().apply_async(fn, args), self._gen)
            return h

    def _done(self, e: _Entry) -> bool:
        return e.cancelled or e.ar.ready()

    def wait_any(self, handles: list[TaskHandle], timeout: float | None) -> list[TaskHandle]:
        deadline = None if timeout is None else time.monotonic() + timeout
        while True:
            with self._lock:
                done = [h for h in handles if self._done(self._entries[h])]
            if done or (deadline is not None and time.monotonic() >= deadline):
                return done
            time.sleep(POLL_SEC)

    def result(self, h: TaskHandle) -> Any:
        with self._lock:
            e = self._entries[h]
        if e.cancelled:
            self._forget(h)
            raise TaskCancelled()
        try:
            return e.ar.get()
        finally:
            self._forget(h)

    def _forget(self, h: TaskHandle) -> None:
        with self._lock:
            self._entries.pop(h, None)

    def cancel(self, h: TaskHandle, force: bool = True) -> None:
        with self._lock:
            e = self._entries.get(h)
            if e is None or e.cancelled:
                return
            e.cancelled = True
            if e.ar.ready() or not force:
                return
            # 실행 중일 수 있는 작업을 확실히 멈추기 위해 풀을 교체
            old = self._pool
            self._pool = None
            self._gen += 1
            if old is not None:
                old.terminate()
            for other in self._entries.values():
                if not other.cancelled and not other.ar.ready():
                    other.ar = self._get_pool().apply_async(other.fn, other.args)
                    other.gen = self._gen

    def shutdown(self) -> None:
        with self._lock:
            if self._pool is not None:
                self._pool.terminate()
                self._pool.join()
                self._pool = None
            self._entries.clear()
