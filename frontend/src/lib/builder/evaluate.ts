// 빌더 스펙 TS 평가기 (미리보기). 각 단계 함수는 Python 생성 코드의 헬퍼와 1:1로 대응한다.
import { ExprError, evalExpr, parseExpr } from '../expr';
import { windowTriggerCount, type BuilderSpec, type Calc, type CmpOp, type Num, type Trigger, type Window } from './spec';

export type BuilderData = { time: Float64Array; cols: Record<string, Float64Array>; params: Record<string, number> };
export type BuilderTrace = { triggerTimes: number[]; segments: [number, number][] /* 인덱스 구간, 양끝 포함 */ };
type Seg = [number, number];

class BuilderError extends Error {}

const MSG = {
  noTrigger: '트리거 조건을 만족하는 시점이 없습니다',
  emptyWindow: '계산 구간이 비어 있습니다',
  order: '두 번째 트리거가 첫 번째보다 앞입니다',
  overshootFlat: '오버슛 계산 불가: 시작값과 끝값이 같습니다',
  contiguous: '이 계산은 연속 구간에서만 쓸 수 있습니다',
  nonFinite: '결과가 유한한 수가 아닙니다',
};

function resolveNum(n: Num, params: Record<string, number>): number {
  if (typeof n === 'number') return n;
  const v = params[n.param];
  if (v === undefined) throw new BuilderError(`파라미터가 없습니다: ${n.param}`);
  return v;
}

function cmp(a: number, op: CmpOp, b: number): boolean {
  switch (op) {
    case '>=': return a >= b;
    case '>': return a > b;
    case '<=': return a <= b;
    case '<': return a < b;
  }
}

// 조건이 참인 연속 구간들 [start, end] (양끝 포함)
function runs(cond: (i: number) => boolean, n: number): Seg[] {
  const out: Seg[] = [];
  let start = -1;
  for (let i = 0; i < n; i++) {
    if (cond(i)) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      out.push([start, i - 1]);
      start = -1;
    }
  }
  if (start >= 0) out.push([start, n - 1]);
  return out;
}

function pick(idx: number[], occurrence: 'first' | 'last'): number {
  if (!idx.length) throw new BuilderError(MSG.noTrigger);
  return occurrence === 'first' ? idx[0] : idx[idx.length - 1];
}

/** 트리거가 가리키는 인덱스 하나. 없으면 오류. */
export function triggerIndex(
  tr: Trigger, t: Float64Array, sig: (name: string) => Float64Array, params: Record<string, number>,
): number {
  const n = t.length;
  switch (tr.kind) {
    case 'cross': {
      const s = sig(tr.signal);
      const th = resolveNum(tr.threshold, params);
      const idx: number[] = [];
      for (let i = 1; i < n; i++) {
        const hit = tr.dir === 'up' ? s[i - 1] < th && s[i] >= th : s[i - 1] > th && s[i] <= th;
        if (hit) idx.push(i);
      }
      return pick(idx, tr.occurrence);
    }
    case 'reach': {
      const s = sig(tr.signal);
      const th = resolveNum(tr.threshold, params);
      const idx: number[] = [];
      for (let i = 0; i < n; i++) if (cmp(s[i], tr.op, th)) idx.push(i);
      return pick(idx, tr.occurrence);
    }
    case 'time': {
      const T = resolveNum(tr.t, params);
      for (let i = 0; i < n; i++) if (t[i] >= T) return i;
      throw new BuilderError(MSG.noTrigger);
    }
    case 'extremum': {
      const s = sig(tr.signal);
      // NaN이 아닌 첫 값에서 시작 (Python nanargmax와 같은 첫 번째 극값)
      let best = 0;
      while (best < n && Number.isNaN(s[best])) best++;
      if (best >= n) throw new BuilderError(MSG.noTrigger);
      for (let i = best + 1; i < n; i++) {
        if (tr.which === 'max' ? s[i] > s[best] : s[i] < s[best]) best = i;
      }
      return best;
    }
    case 'hold': {
      const s = sig(tr.signal);
      const th = resolveNum(tr.threshold, params);
      const dur = resolveNum(tr.durationSec, params);
      for (const [a, b] of runs((i) => cmp(s[i], tr.op, th), n)) {
        if (t[b] - t[a] >= dur) return a;
      }
      throw new BuilderError(MSG.noTrigger);
    }
  }
}

/** 계산 구간들. 비어 있으면 오류. */
export function windowSegments(
  w: Window, trig: number[], t: Float64Array, sig: (name: string) => Float64Array, params: Record<string, number>,
): Seg[] {
  const n = t.length;
  let segs: Seg[];
  switch (w.kind) {
    case 'all': segs = [[0, n - 1]]; break;
    case 'fromTrigger': segs = [[trig[0], n - 1]]; break;
    case 'untilTrigger': segs = [[0, trig[0]]]; break;
    case 'between':
      if (trig[1] < trig[0]) throw new BuilderError(MSG.order);
      segs = [[trig[0], trig[1]]];
      break;
    case 'around': {
      const lo = t[trig[0]] - resolveNum(w.beforeSec, params);
      const hi = t[trig[0]] + resolveNum(w.afterSec, params);
      segs = runs((i) => t[i] >= lo && t[i] <= hi, n);
      break;
    }
    case 'mask': {
      const s = sig(w.signal);
      const th = resolveNum(w.threshold, params);
      segs = runs((i) => cmp(s[i], w.op, th), n);
      break;
    }
  }
  segs = segs.filter(([a, b]) => b >= a);
  if (!segs.length) throw new BuilderError(MSG.emptyWindow);
  return segs;
}

function trapz(y: (i: number) => number, t: Float64Array, [a, b]: Seg): number {
  let s = 0;
  for (let i = a + 1; i <= b; i++) s += ((y(i - 1) + y(i)) / 2) * (t[i] - t[i - 1]);
  return s;
}

function samples(s: Float64Array, segs: Seg[]): number[] {
  const out: number[] = [];
  for (const [a, b] of segs) for (let i = a; i <= b; i++) out.push(s[i]);
  return out;
}

const sum = (xs: number[]) => xs.reduce((p, q) => p + q, 0);
const maxOf = (xs: number[]) => xs.reduce((p, q) => Math.max(p, q), -Infinity);
const minOf = (xs: number[]) => xs.reduce((p, q) => Math.min(p, q), Infinity);

/** 구간 집합에 대한 계산값 (후처리 전). */
export function calcValue(
  c: Calc, w: Window, segs: Seg[], t: Float64Array, sig: (name: string) => Float64Array, params: Record<string, number>,
): number {
  const s = sig(c.signal);
  const duration = sum(segs.map(([a, b]) => t[b] - t[a]));
  const integral = (y: (i: number) => number) => sum(segs.map((g) => trapz(y, t, g)));
  switch (c.kind) {
    case 'duration': return duration;
    case 'integral': return integral((i) => s[i]);
    case 'delta': return sum(segs.map(([a, b]) => s[b] - s[a]));
    case 'mean': return duration === 0 ? s[segs[0][0]] : integral((i) => s[i]) / duration;
    case 'rms': return Math.sqrt(integral((i) => s[i] * s[i]) / duration);
    case 'max': return maxOf(samples(s, segs));
    case 'min': return minOf(samples(s, segs));
    case 'std': {
      const xs = samples(s, segs);
      const m = sum(xs) / xs.length;
      return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / xs.length);
    }
    case 'rmse': {
      const r = sig(c.ref);
      const a = samples(s, segs);
      const b = samples(r, segs);
      return Math.sqrt(sum(a.map((x, i) => (x - b[i]) ** 2)) / a.length);
    }
    case 'overshoot':
    case 'settling': {
      if (w.kind === 'mask') throw new BuilderError(MSG.contiguous);
      const start = segs[0][0];
      const end = segs[segs.length - 1][1];
      const initial = s[start];
      const final = s[end];
      const span = Math.abs(final - initial);
      if (c.kind === 'overshoot') {
        if (span === 0) throw new BuilderError(MSG.overshootFlat);
        return ((maxOf(samples(s, segs)) - final) / span) * 100;
      }
      const band = (resolveNum(c.tolPct, params) / 100) * span;
      let j = -1;
      for (const [a, b] of segs) for (let i = a; i <= b; i++) if (Math.abs(s[i] - final) > band) j = i;
      return j < 0 ? 0 : t[j] - t[start];
    }
  }
}

/** 후처리: abs → negate → ×scale */
export function postProcess(v: number, post: BuilderSpec['post'], params: Record<string, number>): number {
  let r = v;
  if (post.abs) r = Math.abs(r);
  if (post.negate) r = -r;
  return r * resolveNum(post.scale, params);
}

/** 파생 신호를 순서대로 계산한다. 앞선 파생 신호를 뒤에서 참조할 수 있다. */
function evalDerived(s: BuilderSpec, d: BuilderData): Record<string, Float64Array> {
  const n = d.time.length;
  const cols: Record<string, Float64Array> = { ...d.cols, time: d.time };
  const out: Record<string, Float64Array> = {};
  for (const dv of s.derived) {
    if (dv.name === 'time' || Object.hasOwn(d.cols, dv.name)) {
      throw new BuilderError(`파생 신호 이름이 컬럼과 겹칩니다: ${dv.name}`);
    }
    const arr = evalExpr(parseExpr(dv.expr), cols, d.params, n);
    out[dv.name] = arr;
    cols[dv.name] = arr;
    cols.time = d.time; // 'time'은 언제나 시간 배열
  }
  return out;
}

export function evaluateSpec(
  s: BuilderSpec, d: BuilderData,
): { value: number | null; error: string | null; trace: BuilderTrace | null } {
  let trace: BuilderTrace | null = null;
  try {
    const t = d.time;
    const derived = evalDerived(s, d);
    const sig = (name: string): Float64Array => {
      if (name === 'time') return t;
      const v = derived[name] ?? d.cols[name];
      if (!v) throw new BuilderError(`컬럼이 없습니다: ${name}`);
      return v;
    };
    const need = windowTriggerCount(s.window);
    if (s.triggers.length < need) throw new BuilderError(`트리거가 ${need}개 필요합니다`);
    const trig = s.triggers.slice(0, need).map((tr) => triggerIndex(tr, t, sig, d.params));
    const triggerTimes = trig.map((i) => t[i]);
    const segments = windowSegments(s.window, trig, t, sig, d.params);
    trace = { triggerTimes, segments };
    const raw = calcValue(s.calc, s.window, segments, t, sig, d.params);
    const value = postProcess(raw, s.post, d.params);
    if (!Number.isFinite(value)) throw new BuilderError(MSG.nonFinite);
    return { value, error: null, trace };
  } catch (e) {
    if (e instanceof BuilderError || e instanceof ExprError) return { value: null, error: e.message, trace };
    throw e;
  }
}
