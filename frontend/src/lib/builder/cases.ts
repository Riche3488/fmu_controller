// TS ↔ Python 패리티 케이스. parity.test.ts가 fixture(backend/tests/fixtures/builder_parity.json)를 만든다.
// JSON으로 옮겨야 하므로 데이터에 NaN/Infinity를 쓰지 않는다.
import { DEFAULT_SPEC, type BuilderSpec } from './spec';

export type ParityData = { time: number[]; cols: Record<string, number[]>; params: Record<string, number> };
export type ParityCase = { name: string; spec: BuilderSpec; data: ParityData };

const D: ParityData = {
  time: [0, 1, 2, 3, 4],
  cols: { pedal: [0, 0.5, 0.95, 1, 1], x: [0, 1, 3, 6, 10], v: [1, 2, 3, 4, 4] },
  params: { th: 0.9, k: 2, tol: 10, t0: 1 },
};
const STEP: ParityData = {
  time: [0, 1, 2, 3, 4, 5, 6],
  cols: { y: [0, 0.5, 1.2, 1.05, 0.99, 1, 1] },
  params: { tol: 10 },
};
const MASKED: ParityData = {
  ...D,
  cols: { ...D.cols, m: [1, 1, 0, 1, 1], v: [1, 3, 100, 2, 4] },
};
const UNEVEN: ParityData = {
  time: [0, 0.5, 1.5, 2, 4, 4.5],
  cols: { s: [3, 1, 4, 1, 5, 9], r: [2, 2, 2, 2, 2, 2], a: [1, 2, 2, 0, 0, 1] },
  params: { w: 1 },
};

const sp = (o: Partial<BuilderSpec>): BuilderSpec => ({ ...DEFAULT_SPEC, ...o });
const calc = (c: BuilderSpec['calc']) => sp({ calc: c });
const tAt = (t: number | { param: string }) => ({ kind: 'time', t }) as const;
const pedalUp = { kind: 'cross', signal: 'pedal', dir: 'up', threshold: { param: 'th' }, occurrence: 'first' } as const;
const from = (triggers: BuilderSpec['triggers'], c: BuilderSpec['calc']) =>
  sp({ window: { kind: 'fromTrigger' }, triggers, calc: c });
const maskW = (signal: string, op: '>=' | '>' | '<=' | '<', threshold: number | { param: string }) =>
  ({ kind: 'mask', signal, op, threshold }) as const;
const SQ = { ...STEP, cols: { y: [1, 2, 1, 1, 1, 1, 1] } };
const SHOLD = { ...D, cols: { ...D.cols, s: [1, 0, 1, 1, 1] } };
const dx = { kind: 'delta', signal: 'x' } as const;
const MASK_CALCS = ['duration', 'integral', 'mean', 'delta', 'max', 'min', 'std', 'rms'] as const;

export const PARITY_CASES: ParityCase[] = [
  // 사용자 예시 / evaluate.test.ts
  { name: 'example-delta-after-pedal', spec: from([pedalUp], dx), data: D },
  { name: 'example-integral-after-pedal', spec: from([pedalUp], { kind: 'integral', signal: 'v' }), data: D },
  { name: 'mask-duration', spec: sp({ window: maskW('pedal', '>=', 0.9) }), data: D },
  {
    name: 'derived-kmh-max',
    spec: sp({ derived: [{ name: 'kmh', expr: 'v*3.6' }], calc: { kind: 'max', signal: 'kmh' } }),
    data: D,
  },
  {
    name: 'post-abs-negate-scale',
    spec: sp({ calc: dx, post: { abs: true, negate: true, scale: 2 } }),
    data: D,
  },
  { name: 'overshoot-step', spec: calc({ kind: 'overshoot', signal: 'y' }), data: STEP },
  { name: 'settling-2pct', spec: calc({ kind: 'settling', signal: 'y', tolPct: 2 }), data: STEP },
  { name: 'settling-param-tol', spec: calc({ kind: 'settling', signal: 'y', tolPct: { param: 'tol' } }), data: STEP },

  // 트리거 5종
  {
    name: 'trigger-cross-down-last',
    spec: from([{ kind: 'cross', signal: 's', dir: 'down', threshold: 1, occurrence: 'last' }], dx),
    data: { ...D, cols: { ...D.cols, s: [2, 0, 2, 0, 0] } },
  },
  {
    name: 'trigger-cross-ignores-index0',
    spec: from([{ kind: 'cross', signal: 's', dir: 'up', threshold: 1, occurrence: 'first' }], dx),
    data: { ...D, cols: { ...D.cols, s: [5, 5, 5, 5, 5] } },
  },
  {
    name: 'trigger-reach-first',
    spec: from([{ kind: 'reach', signal: 'pedal', op: '>', threshold: 0.4, occurrence: 'first' }], dx),
    data: D,
  },
  {
    name: 'trigger-reach-last',
    spec: from([{ kind: 'reach', signal: 'pedal', op: '<', threshold: 0.6, occurrence: 'last' }], dx),
    data: D,
  },
  { name: 'trigger-time', spec: from([tAt(2.5)], dx), data: D },
  { name: 'trigger-time-param', spec: from([tAt({ param: 't0' })], dx), data: D },
  { name: 'trigger-time-beyond-error', spec: from([tAt(9)], dx), data: D },
  { name: 'trigger-extremum-max-first', spec: from([{ kind: 'extremum', signal: 'v', which: 'max' }], dx), data: D },
  {
    name: 'trigger-extremum-min',
    spec: sp({
      window: { kind: 'untilTrigger' },
      triggers: [{ kind: 'extremum', signal: 'v', which: 'min' }],
      calc: { kind: 'mean', signal: 'v' },
    }),
    data: D,
  },
  {
    name: 'trigger-hold',
    spec: from([{ kind: 'hold', signal: 's', op: '>=', threshold: 1, durationSec: 1 }], dx),
    data: SHOLD,
  },
  {
    name: 'trigger-hold-duration-zero',
    spec: from([{ kind: 'hold', signal: 's', op: '>=', threshold: 1, durationSec: 0 }], dx),
    data: SHOLD,
  },
  {
    name: 'trigger-hold-too-long-error',
    spec: from([{ kind: 'hold', signal: 's', op: '>=', threshold: 1, durationSec: 3 }], dx),
    data: SHOLD,
  },
  {
    name: 'trigger-hold-params',
    spec: from(
      [{ kind: 'hold', signal: 's', op: '>=', threshold: { param: 'th' }, durationSec: { param: 'w' } }],
      { kind: 'duration', signal: 'time' },
    ),
    data: { ...UNEVEN, params: { th: 1.5, w: 0.4 } },
  },

  // 구간 6종
  { name: 'window-all', spec: calc(dx), data: D },
  {
    name: 'window-until-trigger',
    spec: sp({ window: { kind: 'untilTrigger' }, triggers: [tAt(1)], calc: dx }),
    data: D,
  },
  {
    name: 'window-between',
    spec: sp({ window: { kind: 'between' }, triggers: [tAt(1), tAt(3)], calc: dx }),
    data: D,
  },
  {
    name: 'window-between-order-error',
    spec: sp({ window: { kind: 'between' }, triggers: [tAt(3), tAt(1)] }),
    data: D,
  },
  {
    name: 'window-around-clipped',
    spec: sp({ window: { kind: 'around', beforeSec: 5, afterSec: 1 }, triggers: [tAt(2)] }),
    data: D,
  },
  {
    name: 'window-around-params-uneven',
    spec: sp({
      window: { kind: 'around', beforeSec: { param: 'w' }, afterSec: 0.5 },
      triggers: [tAt(2)],
      calc: { kind: 'integral', signal: 's' },
    }),
    data: UNEVEN,
  },
  {
    name: 'window-mask-param-threshold',
    spec: sp({ window: maskW('s', '>=', { param: 'w' }), calc: { kind: 'integral', signal: 's' } }),
    data: UNEVEN,
  },
  { name: 'window-mask-empty-error', spec: sp({ window: maskW('pedal', '>', 5) }), data: D },

  // 계산 12종: 8종은 mask 두 구간 위에서, 나머지는 아래 개별 케이스
  ...MASK_CALCS.map(
    (kind): ParityCase => ({
      name: `calc-${kind}-mask-two-segments`,
      spec: sp({ window: maskW('m', '>', 0.5), calc: { kind, signal: kind === 'duration' ? 'time' : 'v' } }),
      data: MASKED,
    }),
  ),
  { name: 'calc-rmse-uneven', spec: calc({ kind: 'rmse', signal: 's', ref: 'r' }), data: UNEVEN },
  { name: 'calc-rms-uneven', spec: calc({ kind: 'rms', signal: 's' }), data: UNEVEN },
  { name: 'calc-std-uneven', spec: calc({ kind: 'std', signal: 's' }), data: UNEVEN },
  { name: 'calc-mean-uneven', spec: calc({ kind: 'mean', signal: 's' }), data: UNEVEN },
  {
    name: 'calc-mean-zero-duration',
    spec: sp({ window: { kind: 'untilTrigger' }, triggers: [tAt(0)], calc: { kind: 'mean', signal: 'v' } }),
    data: D,
  },
  { name: 'calc-overshoot-flat-error', spec: calc({ kind: 'overshoot', signal: 'y' }), data: SQ },
  { name: 'calc-settling-flat-start-peak', spec: calc({ kind: 'settling', signal: 'y', tolPct: 2 }), data: SQ },
  {
    name: 'calc-overshoot-mask-error',
    spec: sp({ window: maskW('m', '>', 0.5), calc: { kind: 'overshoot', signal: 'v' } }),
    data: MASKED,
  },
  {
    name: 'calc-settling-after-trigger',
    spec: from([tAt(1)], { kind: 'settling', signal: 'y', tolPct: 5 }),
    data: STEP,
  },

  // 파생 신호
  {
    name: 'derived-diff-cumsum-params',
    spec: sp({
      derived: [
        { name: 'dx', expr: 'diff(x)' },
        { name: 'cs', expr: 'cumsum(dx) * params.k' },
      ],
      calc: { kind: 'max', signal: 'cs' },
    }),
    data: D,
  },
  {
    name: 'derived-chain-and-time',
    spec: sp({
      derived: [
        { name: 'a1', expr: 'time*2 + v' },
        { name: 'a2', expr: 'sqrt(a1) - params["k"]' },
      ],
      window: { kind: 'fromTrigger' },
      triggers: [{ kind: 'reach', signal: 'a2', op: '>=', threshold: 0, occurrence: 'first' }],
      calc: { kind: 'integral', signal: 'a2' },
    }),
    data: D,
  },
  {
    name: 'derived-backtick-modelica-name',
    spec: sp({ derived: [{ name: 'q', expr: '`a[1]` * 2 + min(`a[1]`, 1)' }], calc: { kind: 'integral', signal: 'q' } }),
    data: { ...D, cols: { 'a[1]': [1, 2, 3, 4, 5] } },
  },
  {
    name: 'derived-power-and-funcs',
    spec: sp({ derived: [{ name: 'q', expr: '-v**2 + abs(x - 5) + max(v, 2)' }], calc: { kind: 'mean', signal: 'q' } }),
    data: D,
  },
  {
    name: 'derived-used-in-mask',
    spec: sp({ derived: [{ name: 'kmh', expr: 'v*3.6' }], window: maskW('kmh', '>', 8), calc: dx }),
    data: D,
  },
  {
    name: 'derived-trig-exp-log',
    spec: sp({
      derived: [{ name: 'q', expr: 'exp(v/10) + log(v+1) + log10(v+1) + sin(v) + cos(v) + tan(v/10)' }],
      calc: { kind: 'max', signal: 'q' },
    }),
    data: D,
  },

  // 후처리 / 오류
  {
    name: 'post-scale-param',
    spec: sp({ calc: { kind: 'max', signal: 'v' }, post: { abs: false, negate: true, scale: { param: 'k' } } }),
    data: D,
  },
  { name: 'time-signal-calc', spec: calc({ kind: 'max', signal: 'time' }), data: D },
  { name: 'error-no-trigger', spec: from([{ ...pedalUp, threshold: 2 }], dx), data: D },
  { name: 'error-too-few-triggers', spec: sp({ window: { kind: 'between' }, triggers: [tAt(1)] }), data: D },
  { name: 'error-missing-column', spec: calc({ kind: 'max', signal: 'nope' }), data: D },
  {
    name: 'error-missing-column-in-derived',
    spec: sp({ derived: [{ name: 'q', expr: 'zz+1' }], calc: { kind: 'max', signal: 'q' } }),
    data: D,
  },
  {
    name: 'error-missing-param',
    spec: sp({ post: { abs: false, negate: false, scale: { param: 'nope' } } }),
    data: D,
  },
  {
    name: 'error-missing-param-in-derived',
    spec: sp({ derived: [{ name: 'q', expr: 'v*params.nope' }], calc: { kind: 'max', signal: 'q' } }),
    data: D,
  },
  { name: 'error-derived-collides-column', spec: sp({ derived: [{ name: 'x', expr: 'v*2' }] }), data: D },
  { name: 'error-derived-collides-time', spec: sp({ derived: [{ name: 'time', expr: 'v*2' }] }), data: D },
  { name: 'error-derived-parse', spec: sp({ derived: [{ name: 'q', expr: '(x+1' }] }), data: D },
  {
    name: 'error-non-finite',
    spec: sp({ derived: [{ name: 'q', expr: 'x/0' }], calc: { kind: 'max', signal: 'q' } }),
    data: D,
  },
];
