"""시계열 결과 Parquet 저장/읽기."""
from pathlib import Path

import numpy as np
import pandas as pd


def write_result(path: str | Path, result: np.ndarray) -> None:
    """FMPy 결과(structured array)를 Parquet으로 저장. 임시 파일에 쓴 뒤 교체한다."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame({name: result[name] for name in result.dtype.names})
    tmp = path.with_suffix(".tmp")
    df.to_parquet(tmp, index=False)
    tmp.replace(path)


def read_result(path: str | Path, columns: list[str] | None = None) -> pd.DataFrame:
    """결과 읽기. columns를 주면 time + 해당 컬럼만 (없는 컬럼은 KeyError)."""
    if columns is None:
        return pd.read_parquet(path)
    available = result_columns(path)
    missing = [c for c in columns if c not in available]
    if missing:
        raise KeyError(missing)
    wanted = ["time", *[c for c in columns if c != "time"]]
    return pd.read_parquet(path, columns=wanted)


def result_columns(path: str | Path) -> list[str]:
    import pyarrow.parquet as pq

    return pq.read_schema(path).names


def downsample(df: pd.DataFrame, max_points: int) -> pd.DataFrame:
    """균등 간격으로 최대 max_points 행만 남긴다. 첫 행과 마지막 행은 항상 포함."""
    n = len(df)
    if n <= max_points or max_points < 2:
        return df
    idx = np.unique(np.linspace(0, n - 1, max_points).round().astype(int))
    return df.iloc[idx]
