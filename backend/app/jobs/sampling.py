"""배치 케이스 생성 — frontend/src/lib/sweep.ts 와 같은 규칙/문구."""
import itertools

import numpy as np
from scipy.stats import qmc

from ..schemas import SweepList, SweepRange

ZIP_LENGTH_ERROR = "zip 방식은 모든 파라미터의 값 개수가 같아야 합니다"
SAMPLING_RANGE_ERROR = "LHS/random 방식은 range 파라미터만 지원합니다"
N_SAMPLES_REQUIRED = "LHS/random 방식은 샘플 수(nSamples)가 필요합니다"


def expand_values(p: SweepList | SweepRange) -> list[float]:
    if isinstance(p, SweepList):
        return [float(v) for v in p.values]
    if p.steps <= 1:
        return [float(p.min)]
    return [p.min + (p.max - p.min) * i / (p.steps - 1) for i in range(p.steps)]


def generate_cases(params: list[SweepList | SweepRange], sampling: str, n_samples: int | None, seed: int = 0) -> list[dict[str, float]]:
    if not params:
        return []
    names = [p.name for p in params]
    if sampling in ("lhs", "random"):
        if any(not isinstance(p, SweepRange) for p in params):
            raise ValueError(SAMPLING_RANGE_ERROR)
        if not n_samples:
            raise ValueError(N_SAMPLES_REQUIRED)
        lo = np.array([p.min for p in params], dtype=float)
        hi = np.array([p.max for p in params], dtype=float)
        if sampling == "lhs":
            unit = qmc.LatinHypercube(d=len(params), rng=np.random.default_rng(seed)).random(n_samples)
        else:
            unit = np.random.default_rng(seed).random((n_samples, len(params)))
        samples = lo + unit * (hi - lo)
        return [dict(zip(names, map(float, row))) for row in samples]
    lists = [expand_values(p) for p in params]
    if sampling == "zip":
        if len({len(v) for v in lists}) > 1:
            raise ValueError(ZIP_LENGTH_ERROR)
        return [dict(zip(names, vals)) for vals in zip(*lists)]
    return [dict(zip(names, combo)) for combo in itertools.product(*lists)]
