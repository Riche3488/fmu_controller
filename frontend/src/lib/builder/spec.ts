// 목적함수 빌더 스펙: 파생 신호 → 트리거 → 구간 → 계산 → 후처리.
// TS 평가기(evaluate.ts, 미리보기)와 Python 코드 생성이 같은 의미를 가져야 한다.
import { exprColumns, exprParams, parseExpr, type Expr } from '../expr';

export type Num = number | { param: string };
export type CmpOp = '>=' | '>' | '<=' | '<';
export type Trigger =
  | { kind: 'cross'; signal: string; dir: 'up' | 'down'; threshold: Num; occurrence: 'first' | 'last' }
  | { kind: 'reach'; signal: string; op: CmpOp; threshold: Num; occurrence: 'first' | 'last' }
  | { kind: 'time'; t: Num }
  | { kind: 'extremum'; signal: string; which: 'max' | 'min' }
  | { kind: 'hold'; signal: string; op: CmpOp; threshold: Num; durationSec: Num };
export type Window =
  | { kind: 'all' } | { kind: 'fromTrigger' } | { kind: 'untilTrigger' }
  | { kind: 'between' }                                  // triggers[0] ~ triggers[1]
  | { kind: 'around'; beforeSec: Num; afterSec: Num }    // triggers[0] ± N초 (데이터 범위로 자름)
  | { kind: 'mask'; signal: string; op: CmpOp; threshold: Num };
export type Calc =
  | { kind: 'delta' | 'integral' | 'mean' | 'rms' | 'max' | 'min' | 'std' | 'duration'; signal: string }
  | { kind: 'overshoot'; signal: string } | { kind: 'settling'; signal: string; tolPct: Num }
  | { kind: 'rmse'; signal: string; ref: string };
export type BuilderSpec = {
  version: 1;
  derived: { name: string; expr: string }[];
  triggers: Trigger[];            // window가 요구하는 개수: fromTrigger/untilTrigger/around=1, between=2, 나머지 0
  window: Window;
  calc: Calc;
  post: { abs: boolean; negate: boolean; scale: Num };
};

export const DEFAULT_SPEC: BuilderSpec = {
  version: 1,
  derived: [],
  triggers: [],
  window: { kind: 'all' },
  calc: { kind: 'duration', signal: 'time' },
  post: { abs: false, negate: false, scale: 1 },
};

export function windowTriggerCount(w: Window): number {
  switch (w.kind) {
    case 'fromTrigger': case 'untilTrigger': case 'around': return 1;
    case 'between': return 2;
    default: return 0;
  }
}

function triggerSignal(t: Trigger): string | null {
  return t.kind === 'time' ? null : t.signal;
}

function triggerNums(t: Trigger): Num[] {
  switch (t.kind) {
    case 'cross': case 'reach': return [t.threshold];
    case 'time': return [t.t];
    case 'extremum': return [];
    case 'hold': return [t.threshold, t.durationSec];
  }
}

function windowNums(w: Window): Num[] {
  if (w.kind === 'around') return [w.beforeSec, w.afterSec];
  if (w.kind === 'mask') return [w.threshold];
  return [];
}

// 파싱 실패한 파생식은 건너뛴다 (오류는 평가 시점에 보고)
function parsedDerived(s: BuilderSpec): Expr[] {
  const out: Expr[] = [];
  for (const dv of s.derived) {
    try { out.push(parseExpr(dv.expr)); } catch { /* 무시 */ }
  }
  return out;
}

const pushUnique = (out: string[], v: string) => { if (!out.includes(v)) out.push(v); };

export function specColumns(s: BuilderSpec): string[] {
  const derivedNames = new Set(s.derived.map((dv) => dv.name));
  const out = ['time'];
  const add = (name: string | null) => {
    if (name !== null && !derivedNames.has(name)) pushUnique(out, name);
  };
  s.triggers.forEach((t) => add(triggerSignal(t)));
  if (s.window.kind === 'mask') add(s.window.signal);
  add(s.calc.signal);
  if (s.calc.kind === 'rmse') add(s.calc.ref);
  parsedDerived(s).forEach((e) => exprColumns(e).forEach(add));
  return out;
}

export function specParams(s: BuilderSpec): string[] {
  const out: string[] = [];
  const nums: Num[] = [
    ...s.triggers.flatMap(triggerNums),
    ...windowNums(s.window),
    ...(s.calc.kind === 'settling' ? [s.calc.tolPct] : []),
    s.post.scale,
  ];
  for (const n of nums) if (typeof n !== 'number') pushUnique(out, n.param);
  parsedDerived(s).forEach((e) => exprParams(e).forEach((p) => pushUnique(out, p)));
  return out;
}
