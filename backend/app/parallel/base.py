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

    def submit(self, fn: Callable[..., Any], *args: Any) -> TaskHandle: ...

    def wait_any(self, handles: list[TaskHandle], timeout: float | None) -> list[TaskHandle]:
        """완료(성공/실패/취소)된 핸들들을 반환. 하나도 없으면 timeout 후 빈 리스트."""
        ...

    def result(self, h: TaskHandle) -> Any:
        """결과 반환. 작업 예외는 그대로 다시 raise, 취소된 작업은 TaskCancelled."""
        ...

    def cancel(self, h: TaskHandle, force: bool = True) -> None: ...

    def shutdown(self) -> None: ...


def create_executor(mode: Literal["auto", "ray", "pool"], max_workers: int) -> ParallelExecutor:
    if mode in ("auto", "ray"):
        try:
            from .ray_backend import RayExecutor

            return RayExecutor(max_workers)
        except Exception as e:  # ImportError, ray.init 실패 등
            if mode == "ray":
                raise RuntimeError(f"Ray를 사용할 수 없습니다: {e}") from e
            log.warning("Ray를 사용할 수 없어 multiprocessing.Pool로 대체합니다: %s", e)
    from .pool_backend import PoolExecutor

    return PoolExecutor(max_workers)
