"""Ray 기반 실행기."""
import os
import threading
from pathlib import Path
from typing import Any

import ray

from .base import TaskCancelled, TaskHandle

BACKEND_DIR = str(Path(__file__).resolve().parents[2])


class RayExecutor:
    name = "ray"

    def __init__(self, max_workers: int):
        self.max_workers = max(1, max_workers)
        if not ray.is_initialized():
            pythonpath = os.pathsep.join(p for p in (BACKEND_DIR, os.environ.get("PYTHONPATH")) if p)
            ray.init(
                num_cpus=self.max_workers,
                include_dashboard=False,
                logging_level="ERROR",
                log_to_driver=False,
                runtime_env={"env_vars": {"PYTHONPATH": pythonpath}},
            )
        self._remote_fns: dict[Any, Any] = {}
        self._refs: dict[TaskHandle, Any] = {}
        self._cancelled: set[TaskHandle] = set()
        self._lock = threading.Lock()

    def _remote(self, fn):
        r = self._remote_fns.get(fn)
        if r is None:
            r = self._remote_fns[fn] = ray.remote(num_cpus=1, max_retries=0)(fn)
        return r

    def submit(self, fn, *args) -> TaskHandle:
        with self._lock:
            h = TaskHandle()
            self._refs[h] = self._remote(fn).remote(*args)
            return h

    def wait_any(self, handles: list[TaskHandle], timeout: float | None) -> list[TaskHandle]:
        with self._lock:
            cancelled = [h for h in handles if h in self._cancelled]
            live = {self._refs[h]: h for h in handles if h not in self._cancelled}
        if cancelled or not live:
            ready, _ = ray.wait(list(live), num_returns=len(live), timeout=0) if live else ([], [])
            return cancelled + [live[r] for r in ready]
        ready, rest = ray.wait(list(live), num_returns=1, timeout=timeout)
        if ready and rest:
            more, _ = ray.wait(rest, num_returns=len(rest), timeout=0)
            ready += more
        return [live[r] for r in ready]

    def result(self, h: TaskHandle) -> Any:
        with self._lock:
            ref = self._refs.pop(h, None)
            was_cancelled = h in self._cancelled
            self._cancelled.discard(h)
        if was_cancelled:
            raise TaskCancelled()
        try:
            return ray.get(ref)
        except ray.exceptions.RayTaskError as e:
            cause = getattr(e, "cause", None)
            raise (cause if isinstance(cause, BaseException) else e) from None
        except ray.exceptions.TaskCancelledError as e:
            raise TaskCancelled() from e

    def cancel(self, h: TaskHandle, force: bool = True) -> None:
        with self._lock:
            ref = self._refs.get(h)
            if ref is None or h in self._cancelled:
                return
            self._cancelled.add(h)
        ray.cancel(ref, force=force)

    def shutdown(self) -> None:
        with self._lock:
            self._refs.clear()
            self._cancelled.clear()
        ray.shutdown()
