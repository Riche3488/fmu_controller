import { describe, expect, test } from 'vitest';
import { DEFAULT_SPEC, specColumns, specParams, type BuilderSpec } from './spec';
import { evaluateSpec, type BuilderData } from './evaluate';

const f = (a: number[]) => new Float64Array(a);
const d: BuilderData = {
  time: f([0, 1, 2, 3, 4]),
  cols: { pedal: f([0, 0.5, 0.95, 1, 1]), x: f([0, 1, 3, 6, 10]), v: f([1, 2, 3, 4, 4]) },
  params: { th: 0.9 },
};
const base: BuilderSpec = { ...DEFAULT_SPEC, window: { kind: 'fromTrigger' } as const };
const pedalUp = { kind: 'cross', signal: 'pedal', dir: 'up', threshold: { param: 'th' }, occurrence: 'first' } as const;

describe('evaluateSpec 사용자 예시', () => {
  test('예시: 페달 ≥0.9 이후 이동 거리 (delta)', () => {
    const r = evaluateSpec({ ...base, triggers: [pedalUp], calc: { kind: 'delta', signal: 'x' } }, d);
    expect(r.value).toBe(7);
    expect(r.error).toBeNull();
    expect(r.trace!.triggerTimes).toEqual([2]);
    expect(r.trace!.segments).toEqual([[2, 4]]);
  });
  test('같은 거리를 속도 적분으로', () => {
    const r = evaluateSpec({ ...base, triggers: [pedalUp], calc: { kind: 'integral', signal: 'v' } }, d);
    expect(r.value).toBe(7.5);
  });
  test('트리거 없음은 오류', () =>
    expect(
      evaluateSpec(
        { ...base, triggers: [{ ...pedalUp, threshold: 2 }], calc: { kind: 'delta', signal: 'x' } },
        d,
      ),
    ).toMatchObject({ value: null, error: '트리거 조건을 만족하는 시점이 없습니다', trace: null }));
  test('mask 구간 duration', () => {
    const r = evaluateSpec(
      { ...DEFAULT_SPEC, window: { kind: 'mask', signal: 'pedal', op: '>=', threshold: 0.9 }, calc: { kind: 'duration', signal: 'time' } },
      d,
    );
    expect(r.value).toBe(2);
    expect(r.trace).toEqual({ triggerTimes: [], segments: [[2, 4]] });
  });
  test('파생 신호 사용', () => {
    const r = evaluateSpec(
      { ...DEFAULT_SPEC, derived: [{ name: 'kmh', expr: 'v*3.6' }], calc: { kind: 'max', signal: 'kmh' } },
      d,
    );
    expect(r.value).toBeCloseTo(14.4, 12);
  });
  test('후처리 abs→negate→scale', () => {
    const r = evaluateSpec(
      { ...DEFAULT_SPEC, calc: { kind: 'delta', signal: 'x' }, post: { abs: true, negate: true, scale: 2 } },
      d,
    );
    expect(r.value).toBe(-20);
  });
  test('settling, overshoot', () => {
    const step: BuilderData = {
      time: f([0, 1, 2, 3, 4, 5, 6]),
      cols: { y: f([0, 0.5, 1.2, 1.05, 0.99, 1, 1]) },
      params: { tol: 10 },
    };
    const os = evaluateSpec({ ...DEFAULT_SPEC, calc: { kind: 'overshoot', signal: 'y' } }, step);
    expect(os.value).toBeCloseTo(20, 9);
    const s2 = evaluateSpec({ ...DEFAULT_SPEC, calc: { kind: 'settling', signal: 'y', tolPct: 2 } }, step);
    expect(s2.value).toBe(3);
    const s10 = evaluateSpec({ ...DEFAULT_SPEC, calc: { kind: 'settling', signal: 'y', tolPct: { param: 'tol' } } }, step);
    expect(s10.value).toBe(2);
    const flat = { ...step, cols: { y: f([1, 2, 1, 1, 1, 1, 1]) } };
    expect(evaluateSpec({ ...DEFAULT_SPEC, calc: { kind: 'settling', signal: 'y', tolPct: 2 } }, flat).value).toBe(1);
    expect(evaluateSpec({ ...DEFAULT_SPEC, calc: { kind: 'overshoot', signal: 'y' } }, flat)).toMatchObject({
      value: null,
      error: '오버슛 계산 불가: 시작값과 끝값이 같습니다',
    });
  });
});

describe('트리거', () => {
  const all = (t: BuilderSpec['triggers'][number], calc: BuilderSpec['calc'] = { kind: 'duration', signal: 'time' }) =>
    evaluateSpec({ ...base, triggers: [t], calc }, d);
  test('cross down, last', () => {
    const dd: BuilderData = { ...d, cols: { s: f([2, 0, 2, 0, 0]) } };
    const r = evaluateSpec(
      { ...base, triggers: [{ kind: 'cross', signal: 's', dir: 'down', threshold: 1, occurrence: 'last' }] },
      dd,
    );
    expect(r.trace!.triggerTimes).toEqual([3]);
  });
  test('cross는 i=0을 보지 않는다', () => {
    const dd: BuilderData = { ...d, cols: { s: f([5, 5, 5, 5, 5]) } };
    expect(
      evaluateSpec({ ...base, triggers: [{ kind: 'cross', signal: 's', dir: 'up', threshold: 1, occurrence: 'first' }] }, dd).error,
    ).toBe('트리거 조건을 만족하는 시점이 없습니다');
  });
  test('reach first/last', () => {
    expect(all({ kind: 'reach', signal: 'pedal', op: '>', threshold: 0.4, occurrence: 'first' }).trace!.triggerTimes).toEqual([1]);
    expect(all({ kind: 'reach', signal: 'pedal', op: '<', threshold: 0.6, occurrence: 'last' }).trace!.triggerTimes).toEqual([1]);
    expect(all({ kind: 'reach', signal: 'pedal', op: '<=', threshold: 0, occurrence: 'last' }).trace!.triggerTimes).toEqual([0]);
  });
  test('time', () => {
    expect(all({ kind: 'time', t: 2.5 }).trace!.triggerTimes).toEqual([3]);
    expect(all({ kind: 'time', t: 9 }).error).toBe('트리거 조건을 만족하는 시점이 없습니다');
  });
  test('extremum은 첫 번째', () => {
    expect(all({ kind: 'extremum', signal: 'v', which: 'max' }).trace!.triggerTimes).toEqual([3]);
    expect(all({ kind: 'extremum', signal: 'v', which: 'min' }).trace!.triggerTimes).toEqual([0]);
  });
  test('hold', () => {
    const dd: BuilderData = { ...d, cols: { s: f([1, 0, 1, 1, 1]) } };
    const r = evaluateSpec(
      { ...base, triggers: [{ kind: 'hold', signal: 's', op: '>=', threshold: 1, durationSec: 1 }] },
      dd,
    );
    expect(r.trace!.triggerTimes).toEqual([2]);
    const r0 = evaluateSpec(
      { ...base, triggers: [{ kind: 'hold', signal: 's', op: '>=', threshold: 1, durationSec: 0 }] },
      dd,
    );
    expect(r0.trace!.triggerTimes).toEqual([0]);
    const r3 = evaluateSpec(
      { ...base, triggers: [{ kind: 'hold', signal: 's', op: '>=', threshold: 1, durationSec: 3 }] },
      dd,
    );
    expect(r3.error).toBe('트리거 조건을 만족하는 시점이 없습니다');
  });
});

describe('구간', () => {
  const tAt = (t: number) => ({ kind: 'time', t }) as const;
  test('untilTrigger', () => {
    const r = evaluateSpec({ ...DEFAULT_SPEC, window: { kind: 'untilTrigger' }, triggers: [tAt(1)], calc: { kind: 'delta', signal: 'x' } }, d);
    expect(r.value).toBe(1);
    expect(r.trace!.segments).toEqual([[0, 1]]);
  });
  test('between', () => {
    const r = evaluateSpec({ ...DEFAULT_SPEC, window: { kind: 'between' }, triggers: [tAt(1), tAt(3)], calc: { kind: 'delta', signal: 'x' } }, d);
    expect(r.value).toBe(5);
    expect(r.trace!.triggerTimes).toEqual([1, 3]);
  });
  test('between 순서 오류', () => {
    const r = evaluateSpec({ ...DEFAULT_SPEC, window: { kind: 'between' }, triggers: [tAt(3), tAt(1)] }, d);
    expect(r).toMatchObject({ value: null, error: '두 번째 트리거가 첫 번째보다 앞입니다' });
  });
  test('around는 데이터 범위로 자른다', () => {
    const r = evaluateSpec({ ...DEFAULT_SPEC, window: { kind: 'around', beforeSec: 5, afterSec: 1 }, triggers: [tAt(2)] }, d);
    expect(r.trace!.segments).toEqual([[0, 3]]);
    expect(r.value).toBe(3);
  });
  test('mask 여러 구간과 집계', () => {
    const dd: BuilderData = { ...d, cols: { m: f([1, 1, 0, 1, 1]), v: f([1, 3, 100, 2, 4]) } };
    const spec = (calc: BuilderSpec['calc']): BuilderSpec => ({
      ...DEFAULT_SPEC, window: { kind: 'mask', signal: 'm', op: '>', threshold: 0.5 }, calc,
    });
    expect(evaluateSpec(spec({ kind: 'duration', signal: 'time' }), dd).trace!.segments).toEqual([[0, 1], [3, 4]]);
    expect(evaluateSpec(spec({ kind: 'integral', signal: 'v' }), dd).value).toBe(5);
    expect(evaluateSpec(spec({ kind: 'mean', signal: 'v' }), dd).value).toBe(2.5);
    expect(evaluateSpec(spec({ kind: 'delta', signal: 'v' }), dd).value).toBe(4);
    expect(evaluateSpec(spec({ kind: 'max', signal: 'v' }), dd).value).toBe(4);
    expect(evaluateSpec(spec({ kind: 'min', signal: 'v' }), dd).value).toBe(1);
    expect(evaluateSpec(spec({ kind: 'std', signal: 'v' }), dd).value).toBeCloseTo(Math.sqrt(1.25), 12);
    const r = evaluateSpec(spec({ kind: 'overshoot', signal: 'v' }), dd);
    expect(r).toMatchObject({ value: null, error: '이 계산은 연속 구간에서만 쓸 수 있습니다' });
    expect(r.trace!.segments).toEqual([[0, 1], [3, 4]]);
  });
  test('트리거 개수 부족', () => {
    const r = evaluateSpec({ ...DEFAULT_SPEC, window: { kind: 'between' }, triggers: [tAt(1)] }, d);
    expect(r).toMatchObject({ value: null, error: '트리거가 2개 필요합니다', trace: null });
  });
  test('빈 mask는 빈 구간 오류', () => {
    const r = evaluateSpec({ ...DEFAULT_SPEC, window: { kind: 'mask', signal: 'pedal', op: '>', threshold: 5 } }, d);
    expect(r).toMatchObject({ value: null, error: '계산 구간이 비어 있습니다' });
  });
});

describe('집계·오류', () => {
  test('rms, rmse', () => {
    const dd: BuilderData = { time: f([0, 1, 2]), cols: { a: f([2, 2, 2]), b: f([1, 3, 2]) }, params: {} };
    expect(evaluateSpec({ ...DEFAULT_SPEC, calc: { kind: 'rms', signal: 'a' } }, dd).value).toBe(2);
    expect(evaluateSpec({ ...DEFAULT_SPEC, calc: { kind: 'rmse', signal: 'a', ref: 'b' } }, dd).value).toBeCloseTo(Math.sqrt(2 / 3), 12);
  });
  test('mean: duration 0이면 시작값', () => {
    const r = evaluateSpec({ ...DEFAULT_SPEC, window: { kind: 'untilTrigger' }, triggers: [{ kind: 'time', t: 0 }], calc: { kind: 'mean', signal: 'v' } }, d);
    expect(r.value).toBe(1);
  });
  test('time 신호는 항상 시간 배열 (파생식 안에서도)', () => {
    const r = evaluateSpec({ ...DEFAULT_SPEC, derived: [{ name: 't2', expr: 'time*2' }], calc: { kind: 'max', signal: 't2' } }, d);
    expect(r.value).toBe(8);
  });
  test('컬럼·파라미터 없음', () => {
    expect(evaluateSpec({ ...DEFAULT_SPEC, calc: { kind: 'max', signal: 'nope' } }, d)).toMatchObject({ value: null, error: '컬럼이 없습니다: nope' });
    expect(evaluateSpec({ ...DEFAULT_SPEC, post: { abs: false, negate: false, scale: { param: 'k' } } }, d)).toMatchObject({
      value: null, error: '파라미터가 없습니다: k',
    });
    expect(evaluateSpec({ ...DEFAULT_SPEC, derived: [{ name: 'q', expr: 'zz+1' }], calc: { kind: 'max', signal: 'q' } }, d)).toMatchObject({
      value: null, error: '컬럼이 없습니다: zz', trace: null,
    });
  });
  test('파생식 파싱 오류', () => {
    const r = evaluateSpec({ ...DEFAULT_SPEC, derived: [{ name: 'q', expr: '(x+1' }] }, d);
    expect(r).toMatchObject({ value: null, error: '괄호가 닫히지 않았습니다', trace: null });
  });
  test('비유한 결과', () => {
    const r = evaluateSpec({ ...DEFAULT_SPEC, derived: [{ name: 'q', expr: 'x/0' }], calc: { kind: 'max', signal: 'q' } }, d);
    expect(r).toMatchObject({ value: null, error: '결과가 유한한 수가 아닙니다' });
    expect(r.trace).toEqual({ triggerTimes: [], segments: [[0, 4]] });
  });
});

describe('specColumns / specParams', () => {
  const s: BuilderSpec = {
    version: 1,
    derived: [{ name: 'kmh', expr: 'v*3.6*params.k + time' }, { name: 'bad', expr: '(' }],
    triggers: [pedalUp, { kind: 'time', t: { param: 't0' } }],
    window: { kind: 'between' },
    calc: { kind: 'rmse', signal: 'kmh', ref: 'x' },
    post: { abs: false, negate: false, scale: { param: 'th' } },
  };
  test('컬럼: time 먼저, 파생 이름 제외, 중복 제거', () => {
    expect(specColumns(s)).toEqual(['time', 'pedal', 'x', 'v']);
    expect(specColumns(DEFAULT_SPEC)).toEqual(['time']);
  });
  test('파라미터', () => expect(specParams(s)).toEqual(['th', 't0', 'k']));
});
