"""후보 파일 미리보기: .mat은 변수 목록(+선택 변수 표), 텍스트는 앞부분, 그 외는 안내 문구."""
import math
from pathlib import Path

import numpy as np

TEXT_LIMIT = 256 * 1024
SNIFF = 8192
MAX_ROWS = 2000
BINARY_NOTE = "미리보기를 지원하지 않는 바이너리 파일입니다"
MAT_NOTE = "MATLAB v7.3(HDF5) 등 미리보기를 지원하지 않는 형식입니다"
NOT_NUMERIC = "숫자 2차원 배열만 그래프로 볼 수 있습니다"

# whosmat의 MATLAB 클래스 이름 → numpy dtype 이름
_MAT_CLASS = {"double": "float64", "single": "float32", "logical": "bool"}


class PreviewError(ValueError):
    pass


def _clean(v: float) -> float | None:
    return float(v) if math.isfinite(v) else None


def _mat(path: Path, var: str | None) -> dict:
    import scipy.io as sio

    try:
        info = sio.whosmat(str(path))
    except Exception:  # v7.3(HDF5), 손상된 파일 등
        return {"kind": "binary", "note": MAT_NOTE}
    variables = [{"name": n, "shape": [int(x) for x in shape], "dtype": _MAT_CLASS.get(cls, cls)} for n, shape, cls in info]
    out = {"kind": "mat", "variables": variables, "plot": None}
    if var:
        if var not in {v["name"] for v in variables}:
            raise PreviewError(f"변수가 없습니다: {var}")
        arr = np.asarray(sio.loadmat(str(path), variable_names=[var])[var])
        if arr.dtype.kind not in "fiub" or arr.ndim > 2 or arr.size == 0:
            raise PreviewError(NOT_NUMERIC)
        arr = arr.astype(float)
        if arr.ndim == 1 or arr.shape[0] == 1:  # MATLAB은 벡터를 1xN 행으로 저장한다 → 열 하나로
            arr = arr.reshape(-1, 1)
        if len(arr) > MAX_ROWS:
            arr = arr[np.unique(np.linspace(0, len(arr) - 1, MAX_ROWS).round().astype(int))]
        out["plot"] = {"name": var, "rows": [[_clean(v) for v in row] for row in arr]}
    return out


def _decode(data: bytes, truncated: bool) -> str:
    # 잘린 데이터는 끝이 멀티바이트 문자 중간일 수 있어, 인코딩마다 끝 1~3바이트를 버려 가며 시도한다
    for enc in ("utf-8", "cp949"):
        for cut in range(4 if truncated else 1):
            try:
                return data[:len(data) - cut].decode(enc)
            except UnicodeDecodeError:
                continue
    return data.decode("latin-1")


def preview(path: Path, var: str | None = None, ext: str | None = None) -> dict:
    """ext: 형식 판단용 확장자 (업로드 후보는 sha 이름으로 저장되어 path에 확장자가 없다)"""
    if (ext if ext is not None else path.suffix).lower() == ".mat":
        return _mat(path, var)
    with open(path, "rb") as f:
        data = f.read(TEXT_LIMIT + 1)
    if b"\0" in data[:SNIFF]:
        return {"kind": "binary", "note": BINARY_NOTE}
    truncated = len(data) > TEXT_LIMIT
    return {"kind": "text", "text": _decode(data[:TEXT_LIMIT], truncated), "truncated": truncated}
