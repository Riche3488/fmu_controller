// 미리보기 run 시계열로 빌더 스펙을 평가하고 그릴 신호를 고른다 (순수 함수)
import type { ParamValue, Timeseries } from '../../api/types';
import { evaluateSpec, type BuilderTrace } from '../../lib/builder/evaluate';
import { windowTriggerCount, type BuilderSpec } from '../../lib/builder/spec';
import { evalExpr, parseExpr } from '../../lib/expr';
import type { PreviewSignal } from './previewOption';

export type PreviewResult = {
  value: number | null;
  error: string | null;
  trace: BuilderTrace | null;
  signals: PreviewSignal[];
};

export function numericParams(p: Record<string, ParamValue>): Record<string, number> {
  return Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === 'boolean' ? Number(v) : v]));
}

/** 스펙이 직접 다루는 신호 (그래프 subplot 순서). */
function relevantSignals(s: BuilderSpec): string[] {
  const out: string[] = [];
  const add = (n: string | undefined) => { if (n && n !== 'time' && !out.includes(n)) out.push(n); };
  s.triggers.slice(0, windowTriggerCount(s.window)).forEach(t => add(t.kind === 'time' ? undefined : t.signal));
  if (s.window.kind === 'mask') add(s.window.signal);
  add(s.calc.signal);
  if (s.calc.kind === 'rmse') add(s.calc.ref);
  return out;
}

/**
 * recorded = 미리보기 run에 기록된 전체 컬럼. 시계열은 스펙에 필요한 것만 받아 오므로
 * 파생 신호 이름 충돌은 기록 컬럼 전체를 기준으로 따로 검사한다.
 */
export function evaluatePreview(
  spec: BuilderSpec, ts: Timeseries, recorded: string[], runParams: Record<string, ParamValue>,
): PreviewResult {
  const time = Float64Array.from(ts.time);
  const cols: Record<string, Float64Array> = {};
  for (const [k, v] of Object.entries(ts.series)) cols[k] = Float64Array.from(v, x => (x === null ? NaN : x));
  const params = numericParams(runParams);

  const all: Record<string, Float64Array> = { ...cols, time };
  for (const d of spec.derived ?? []) {
    try {
      all[d.name] = evalExpr(parseExpr(d.expr), all, params, time.length);
      all.time = time;
    } catch { /* 오류는 evaluateSpec이 보고한다 */ }
  }
  let signals: PreviewSignal[] = [];
  try {
    signals = relevantSignals(spec).filter(n => all[n]).map(n => ({ name: n, values: all[n] }));
  } catch { /* 형태가 이상한 스펙 */ }

  const recordedSet = new Set(recorded);
  const clash = (spec.derived ?? []).find(d => d.name === 'time' || recordedSet.has(d.name));
  if (clash) return { value: null, error: `파생 신호 이름이 컬럼과 겹칩니다: ${clash.name}`, trace: null, signals };
  try {
    return { ...evaluateSpec(spec, { time, cols, params }), signals };
  } catch (e) {
    // 헤더는 읽혔지만 스펙 형태가 어긋난 경우 등
    return { value: null, error: `평가 중 오류: ${(e as Error).message}`, trace: null, signals };
  }
}
