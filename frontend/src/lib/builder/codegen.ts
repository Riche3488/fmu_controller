// 빌더 스펙 → 독립 실행 Python 목적함수 코드. 의미·오류 문구는 evaluate.ts와 같아야 한다 (헬퍼가 단계 함수와 1:1).
import { exprToPython, parseExpr } from '../expr';
import { windowTriggerCount, type BuilderSpec } from './spec';

export const HEADER_PREFIX = '# fmuc-builder: ';

// 고정 헬퍼 블록. 바꾸면 기존 생성 코드가 모두 "수정됨"으로 보이므로 신중히.
const HELPERS = `import numpy as np

_NO_TRIGGER = "트리거 조건을 만족하는 시점이 없습니다"
_EMPTY_WINDOW = "계산 구간이 비어 있습니다"
_ORDER = "두 번째 트리거가 첫 번째보다 앞입니다"
_OVERSHOOT_FLAT = "오버슛 계산 불가: 시작값과 끝값이 같습니다"
_CONTIGUOUS = "이 계산은 연속 구간에서만 쓸 수 있습니다"
_NON_FINITE = "결과가 유한한 수가 아닙니다"


class _Params(dict):
    def __missing__(self, key):
        raise ValueError("파라미터가 없습니다: " + str(key))


def _column(result, name):
    if name not in result.columns:
        raise ValueError("컬럼이 없습니다: " + name)
    return result[name].to_numpy(dtype=float)


def _check_derived(result, name):
    if name == "time" or name in result.columns:
        raise ValueError("파생 신호 이름이 컬럼과 겹칩니다: " + name)


def _vec(v, n):
    a = np.asarray(v, dtype=float)
    return np.full(n, a) if a.ndim == 0 else a


def _diff(x):
    # np.diff(x, prepend=x[0])와 같되 첫 값은 항상 0 (x[0]이 NaN·inf여도)
    x = np.asarray(x, dtype=float)
    r = np.zeros(len(x))
    r[1:] = x[1:] - x[:-1]
    return r


def _num(v, params):
    if isinstance(v, dict):
        return np.float64(params[v["param"]])
    return np.float64(v)


def _cmp(a, op, b):
    if op == ">=":
        return a >= b
    if op == ">":
        return a > b
    if op == "<=":
        return a <= b
    return a < b


def _runs(m):
    # 조건이 참인 연속 구간들 (start, end), 양끝 포함
    m = np.asarray(m, dtype=bool)
    if m.size == 0:
        return []
    d = np.diff(m.astype(np.int8))
    starts = [int(i) + 1 for i in np.flatnonzero(d == 1)]
    ends = [int(i) for i in np.flatnonzero(d == -1)]
    if m[0]:
        starts.insert(0, 0)
    if m[-1]:
        ends.append(m.size - 1)
    return list(zip(starts, ends))


def _pick(idx, occurrence):
    if len(idx) == 0:
        raise ValueError(_NO_TRIGGER)
    return int(idx[0] if occurrence == "first" else idx[-1])


def _trigger_index(tr, s, t, params):
    kind = tr["kind"]
    if kind == "cross":
        th = _num(tr["threshold"], params)
        if tr["dir"] == "up":
            hit = (s[:-1] < th) & (s[1:] >= th)
        else:
            hit = (s[:-1] > th) & (s[1:] <= th)
        return _pick(np.flatnonzero(hit) + 1, tr["occurrence"])
    if kind == "reach":
        th = _num(tr["threshold"], params)
        return _pick(np.flatnonzero(_cmp(s, tr["op"], th)), tr["occurrence"])
    if kind == "time":
        return _pick(np.flatnonzero(t >= _num(tr["t"], params)), "first")
    if kind == "extremum":
        # NaN은 건너뛰고 첫 번째 극값
        valid = np.flatnonzero(~np.isnan(s))
        if len(valid) == 0:
            raise ValueError(_NO_TRIGGER)
        vals = s[valid]
        return int(valid[np.argmax(vals) if tr["which"] == "max" else np.argmin(vals)])
    if kind == "hold":
        th = _num(tr["threshold"], params)
        dur = _num(tr["durationSec"], params)
        for a, b in _runs(_cmp(s, tr["op"], th)):
            if t[b] - t[a] >= dur:
                return a
        raise ValueError(_NO_TRIGGER)
    raise ValueError("알 수 없는 트리거: " + str(kind))


def _segments(w, trig, t, s, params):
    n = len(t)
    kind = w["kind"]
    if kind == "all":
        segs = [(0, n - 1)]
    elif kind == "fromTrigger":
        segs = [(trig[0], n - 1)]
    elif kind == "untilTrigger":
        segs = [(0, trig[0])]
    elif kind == "between":
        if trig[1] < trig[0]:
            raise ValueError(_ORDER)
        segs = [(trig[0], trig[1])]
    elif kind == "around":
        lo = t[trig[0]] - _num(w["beforeSec"], params)
        hi = t[trig[0]] + _num(w["afterSec"], params)
        segs = _runs((t >= lo) & (t <= hi))
    elif kind == "mask":
        segs = _runs(_cmp(s, w["op"], _num(w["threshold"], params)))
    else:
        raise ValueError("알 수 없는 구간: " + str(kind))
    segs = [(a, b) for a, b in segs if b >= a]
    if not segs:
        raise ValueError(_EMPTY_WINDOW)
    return segs


def _seqsum(xs):
    # JS reduce처럼 0에서 시작해 앞에서부터 차례로 더한다 (np.sum의 pairwise 합과 반올림이 다르다)
    return np.cumsum(np.concatenate(([0.0], np.asarray(xs, dtype=float))))[-1]


def _trapz(y, t, a, b):
    return _seqsum((y[a:b] + y[a + 1:b + 1]) / 2 * (t[a + 1:b + 1] - t[a:b]))


def _samples(s, segs):
    return np.concatenate([s[a:b + 1] for a, b in segs])


def _calc(c, window_kind, segs, t, s, ref, params):
    kind = c["kind"]
    duration = _seqsum([t[b] - t[a] for a, b in segs])

    def integral(y):
        return _seqsum([_trapz(y, t, a, b) for a, b in segs])

    if kind == "duration":
        return duration
    if kind == "integral":
        return integral(s)
    if kind == "delta":
        return _seqsum([s[b] - s[a] for a, b in segs])
    if kind == "mean":
        return s[segs[0][0]] if duration == 0 else integral(s) / duration
    if kind == "rms":
        return np.sqrt(integral(s * s) / duration)
    if kind == "max":
        return np.max(_samples(s, segs))
    if kind == "min":
        return np.min(_samples(s, segs))
    if kind == "std":
        xs = _samples(s, segs)
        d = xs - _seqsum(xs) / len(xs)
        return np.sqrt(_seqsum(d * d) / len(xs))
    if kind == "rmse":
        d = _samples(s, segs) - _samples(ref, segs)
        return np.sqrt(_seqsum(d * d) / len(d))
    if kind in ("overshoot", "settling"):
        if window_kind == "mask":
            raise ValueError(_CONTIGUOUS)
        start = segs[0][0]
        final = s[segs[-1][1]]
        span = np.abs(final - s[start])
        if kind == "overshoot":
            if span == 0:
                raise ValueError(_OVERSHOOT_FLAT)
            return (np.max(_samples(s, segs)) - final) / span * 100
        band = _num(c["tolPct"], params) / 100 * span
        j = -1
        for a, b in segs:
            out = np.flatnonzero(np.abs(s[a:b + 1] - final) > band)
            if len(out):
                j = a + int(out[-1])
        return np.float64(0) if j < 0 else t[j] - t[start]
    raise ValueError("알 수 없는 계산: " + str(kind))


def _post(v, post, params):
    # abs → negate → ×scale
    if post["abs"]:
        v = np.abs(v)
    if post["negate"]:
        v = -v
    return v * _num(post["scale"], params)
`;

// JSON 값 → Python 리터럴 (문자열은 JSON 이스케이프 그대로 — Python 문자열 리터럴로도 유효)
function pyLit(v: unknown): string {
  if (v === null || v === undefined) return 'None';
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return 'float("nan")';
    if (!Number.isFinite(v)) return v > 0 ? 'float("inf")' : '-float("inf")';
    // String(-0)은 '0': 헤더 JSON도 -0을 0으로 적으므로 다시 생성한 본문과 같아진다
    return String(v);
  }
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(pyLit).join(', ')}]`;
  const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
  return `{${entries.map(([k, x]) => `${JSON.stringify(k)}: ${pyLit(x)}`).join(', ')}}`;
}

const colCall = (name: string) => `col(${JSON.stringify(name)})`;
const optCol = (name: string | null) => (name === null ? 'None' : colCall(name));

export function generateCode(s: BuilderSpec): string {
  const I = '        '; // with 블록 안 들여쓰기
  const body: string[] = [];
  for (const dv of s.derived) {
    body.push(`_check_derived(result, ${JSON.stringify(dv.name)})`);
    let py: string;
    try {
      py = exprToPython(parseExpr(dv.expr), colCall);
    } catch (e) {
      body.push(`raise ValueError(${JSON.stringify(e instanceof Error ? e.message : String(e))})`);
      continue;
    }
    body.push(`sig[${JSON.stringify(dv.name)}] = _vec(${py}, n)`);
  }
  const need = windowTriggerCount(s.window);
  if (s.triggers.length < need) body.push(`raise ValueError(${JSON.stringify(`트리거가 ${need}개 필요합니다`)})`);
  const used = s.triggers.slice(0, need);
  if (!used.length) body.push('trig = []');
  else {
    body.push('trig = [');
    for (const tr of used) body.push(`    _trigger_index(${pyLit(tr)}, ${optCol(tr.kind === 'time' ? null : tr.signal)}, t, params),`);
    body.push(']');
  }
  const w = s.window;
  body.push(`segs = _segments(${pyLit(w)}, trig, t, ${optCol(w.kind === 'mask' ? w.signal : null)}, params)`);
  const c = s.calc;
  body.push(
    `v = _calc(${pyLit(c)}, ${JSON.stringify(w.kind)}, segs, t, ${colCall(c.signal)}, ${optCol(c.kind === 'rmse' ? c.ref : null)}, params)`,
  );
  body.push(`v = _post(v, ${pyLit(s.post)}, params)`);
  body.push('if not np.isfinite(v):');
  body.push('    raise ValueError(_NON_FINITE)');

  return [
    HEADER_PREFIX + JSON.stringify(s),
    HELPERS,
    '',
    'def evaluate(result, params):',
    '    params = _Params(params)',
    '    with np.errstate(all="ignore"):',
    `${I}t = _column(result, "time")`,
    `${I}n = len(t)`,
    `${I}sig = {}`,
    '',
    `${I}def col(name):`,
    `${I}    if name == "time":`,
    `${I}        return t`,
    `${I}    if name in sig:`,
    `${I}        return sig[name]`,
    `${I}    return _column(result, name)`,
    '',
    ...body.map((l) => I + l),
    '    return float(v)',
    '',
  ].join('\n');
}

function normalize(code: string): string {
  const lines = code.replace(/\r\n/g, '\n').split('\n');
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.join('\n');
}

export function parseBuilderCode(code: string): { spec: BuilderSpec; intact: boolean } | null {
  const norm = normalize(code);
  const first = norm.split('\n', 1)[0];
  if (!first.startsWith(HEADER_PREFIX)) return null;
  let spec: BuilderSpec;
  try {
    spec = JSON.parse(first.slice(HEADER_PREFIX.length));
  } catch {
    return null;
  }
  if (typeof spec !== 'object' || spec === null || spec.version !== 1) return null;
  let intact: boolean;
  try {
    intact = normalize(generateCode(spec)) === norm;
  } catch {
    return null; // 헤더 JSON이 스펙 형태가 아님
  }
  return { spec, intact };
}
