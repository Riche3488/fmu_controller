"""Ray 기반 실행기."""
import os
import threading
from pathlib import Path
from typing import Any

import ray

from .base import TaskCancelled, TaskHandle

BACKEND_DIR = str(Path(__file__).resolve().parents[2])


def _init_ray(num_cpus: int, resources: dict[str, float] | None = None) -> bool:
    """Ray를 시작한다. 이미 떠 있으면 False (그 경우 소유하지 않으므로 shutdown하지 않는다)."""
    if ray.is_initialized():
        return False
    pythonpath = os.pathsep.join(p for p in (BACKEND_DIR, os.environ.get("PYTHONPATH")) if p)
    ray.init(
        num_cpus=num_cpus,
        resources=resources,
        include_dashboard=False,
        logging_level="ERROR",
        log_to_driver=False,
        runtime_env={"env_vars": {"PYTHONPATH": pythonpath}},
    )
    return True


def create_ray_executors(sim_workers: int, eval_workers: int) -> tuple["RayExecutor", "RayExecutor"]:
    """하나의 Ray 런타임에서 사용자 정의 자원(fmuc_sim / fmuc_eval)으로 슬롯을 분리한 두 실행기."""
    sim_workers, eval_workers = max(1, sim_workers), max(1, eval_workers)
    owns = _init_ray(sim_workers + eval_workers, {"fmuc_sim": sim_workers, "fmuc_eval": eval_workers})
    sim = RayExecutor(sim_workers, resource="fmuc_sim", owns_runtime=False)
    ev = RayExecutor(eval_workers, resource="fmuc_eval", owns_runtime=owns)  # 마지막에 내려가는 쪽이 런타임 종료
    return sim, ev


class RayExecutor:
    name = "ray"
    generation = 0  # Ray는 작업 하나만 취소하므로 다른 작업이 재시작되지 않는다

    def __init__(self, max_workers: int, resource: str | None = None, owns_runtime: bool | None = None):
        self.max_workers = max(1, max_workers)
        self._resource = resource
        started = _init_ray(self.max_workers) if resource is None else False
        self._owns = started if owns_runtime is None else owns_runtime
        self._remote_fns: dict[Any, Any] = {}
        self._refs: dict[TaskHandle, Any] = {}
        self._cancelled: set[TaskHandle] = set()
        self._lock = threading.Lock()

    def _remote(self, fn):
        r = self._remote_fns.get(fn)
        if r is None:
            opts = {"num_cpus": 0, "resources": {self._resource: 1}} if self._resource else {"num_cpus": 1}
            r = self._remote_fns[fn] = ray.remote(max_retries=0, **opts)(fn)
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
        if self._owns:
            ray.shutdown()
