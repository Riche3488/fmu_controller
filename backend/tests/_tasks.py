"""병렬 실행 테스트용 작업 함수 (워커에서 import 가능해야 하므로 최상위 모듈에 둔다)."""
import os
import time


def sleep_and_return(sec: float, value):
    time.sleep(sec)
    return value


def boom(msg: str):
    raise ValueError(msg)


def hang():
    while True:
        time.sleep(0.1)


def pid() -> int:
    return os.getpid()
