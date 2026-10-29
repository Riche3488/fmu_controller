"""병렬 실행 계층. 잡 러너/최적화/목적함수 평가는 이 인터페이스만 사용한다 (ray/multiprocessing 직접 import 금지)."""
import itertools
import logging
from collections.abc import Callable
from typing import Any, Literal, Protocol

log = logging.getLogger("app.parallel")

_ids = itertools.count(1)


class TaskHandle:
    """불투명 작업 핸들"""

    __slots__ = ("id",)

    def __init__(self):
        self.id = next(_ids)

    def __repr__(self):
        return f"TaskHandle({self.id})"


class TaskCancelled(Exception):
    pass


class ParallelExecutor(Protocol):
    name: Literal["ray", "pool"]
    max_workers: int
    # 실행 중 작업이 재시작될 때마다 증가 (Pool 폴백의 force cancel). 호출자는 바뀌면 타임아웃 시계를 다시 잰다
    generation: int

    def submit(self, fn: Callable[..., Any], *args: Any) -> TaskHandle: ...

    def wait_any(self, handles: list[TaskHandle], timeout: float | None) -> list[TaskHandle]:
        """완료(성공/실패/취소)된 핸들들을 반환. 하나도 없으면 timeout 후 빈 리스트."""
        ...

    def result(self, h: TaskHandle) -> Any:
        """결과 반환. 작업 예외는 그대로 다시 raise, 취소된 작업은 TaskCancelled."""
        ...

    def cancel(self, h: TaskHandle, force: bool = True) -> None: ...

    def shutdown(self) -> None: ...


def create_executors(mode: Literal["auto", "ray", "pool"], sim_workers: int,
                     eval_workers: int) -> tuple[ParallelExecutor, ParallelExecutor]:
    """(시뮬레이션용, 목적함수 평가용) 실행기. 서로의 작업을 기다리거나 재시작시키지 않도록 자원을 분리한다."""
    if mode in ("auto", "ray"):
        try:
            from .ray_backend import create_ray_executors

            return create_ray_executors(sim_workers, eval_workers)
        except Exception as e:  # ImportError, ray.init 실패 등
            if mode == "ray":
                raise RuntimeError(f"Ray를 사용할 수 없습니다: {e}") from e
            log.warning("Ray를 사용할 수 없어 multiprocessing.Pool로 대체합니다: %s", e)
    from .pool_backend import PoolExecutor

    return PoolExecutor(sim_workers), PoolExecutor(eval_workers)


def create_executor(mode: Literal["auto", "ray", "pool"], max_workers: int) -> ParallelExecutor:
    """단일 실행기 (테스트/도구용)."""
    if mode in ("auto", "ray"):
        try:
            from .ray_backend import RayExecutor

            return RayExecutor(max_workers)
        except Exception as e:
            if mode == "ray":
                raise RuntimeError(f"Ray를 사용할 수 없습니다: {e}") from e
            log.warning("Ray를 사용할 수 없어 multiprocessing.Pool로 대체합니다: %s", e)
    from .pool_backend import PoolExecutor

    return PoolExecutor(max_workers)
