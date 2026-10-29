// 시계열 차트 6종: subplot·겹쳐 그리기·평균±범위 밴드·기준 run 대비 차이·XY 위상도·FFT
//
// 선 series의 id는 `<runId>` 또는 `<runId>::<접미사>` (같은 run이 series를 여럿 가질 때). index.ts의 runIdFromClick이 이 앞부분을 run id로 읽는다.
import type { EChartsOption } from 'echarts';
import type { Timeseries } from '../../api/types';
import { band, fft, resampleTo } from '../vizStats';
import type { PanelSpec, WorkbenchData } from '../workbench';
import { itemOpacity, maxOf, minOf, num } from './common';
import { fieldValue } from './fields';
import type { ChartBuilder, ChartResult } from './index';
import { colorFn } from './scalar';

const NO_VALUE: ChartResult = { empty: '값 없음' };
const NO_VARS: ChartResult = { empty: '변수를 선택하세요' };
const NEED_TWO: ChartResult = { empty: '변수 2개를 선택하세요' };
const PALETTE = ['#5470c6', '#ee6666', '#91cc75', '#fac858', '#73c0de', '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc'];
const RAMP_COLORS = ['#3b82f6', '#f97316'];
/** 균일 간격으로 보는 상대 오차 */
const UNIFORM_TOL = 0.01;
const MIN_FFT_POINTS = 4;

type Run = { id: string; label: string; color: string; ts: Timeseries };
type Opt = Record<string, unknown>;

/** 그릴 run: data.rows 순서대로, 시계열이 도착한 것만 */
function runsOf(spec: PanelSpec, data: WorkbenchData, ts: Record<string, Timeseries>): Run[] {
  const colorOf = spec.chart === 'tsOverlay' ? colorFn(spec, data) : undefined;
  const jobName = (id: string) => data.jobs.find(j => j.id === id)?.name ?? id;
  const out: Run[] = [];
  for (const row of data.rows) {
    const t = ts[row.id];
    if (!t) continue;
    out.push({
      id: row.id, label: `${jobName(row.jobId)} #${row.index}`, ts: t,
      color: colorOf?.(row) ?? PALETTE[out.length % PALETTE.length],
    });
  }
  return out;
}

const line = (run: Run, selected: string[], extra: Opt = {}): Opt => ({
  type: 'line', id: run.id, name: run.label, showSymbol: false, sampling: 'lttb',
  lineStyle: { width: 1.2, color: run.color, opacity: itemOpacity(run.id, selected) },
  itemStyle: { color: run.color }, ...extra,
});
const finiteOrNull = (x: number) => (Number.isFinite(x) ? num(x) : null);
const pairs = (xs: number[], ys: number[]) => xs.map((x, i) => [x, finiteOrNull(ys[i])]);

const TOOLTIP = { trigger: 'axis', axisPointer: { type: 'cross' } };
/** x축(시간) 줌: 같은 echarts group의 차트와 연결되어 동기화된다 */
const timeZoom = (axes: number[]) => [
  { type: 'inside', xAxisIndex: axes },
  { type: 'slider', xAxisIndex: axes, height: 18, bottom: 4 },
];

type Single = { v: string; runs: Run[] };
function singleAxis(runs: Run[], vars: string[]): Single | ChartResult {
  const v = vars[0];
  if (!v) return NO_VARS;
  const have = runs.filter(r => r.ts.series[v]);
  return have.length ? { v, runs: have } : NO_VALUE;
}
const isSingle = (x: Single | ChartResult): x is Single => 'runs' in x;

const tsSubplots: ChartBuilder = (spec, data, selected, ts = {}) => {
  const vars = spec.vars ?? [];
  if (!vars.length) return NO_VARS;
  const runs = runsOf(spec, data, ts);
  if (!runs.some(r => vars.some(v => r.ts.series[v]))) return NO_VALUE;
  const n = vars.length;
  const slot = 84 / n; // 위 4%, 아래 12%는 줌 슬라이더 몫
  const series: Opt[] = [];
  vars.forEach((v, i) => {
    for (const r of runs) {
      const y = r.ts.series[v];
      if (y) series.push(line(r, selected, { id: `${r.id}::${v}`, xAxisIndex: i, yAxisIndex: i, data: pairs(r.ts.time, y) }));
    }
  });
  const idx = vars.map((_, i) => i);
  return {
    animation: false,
    tooltip: TOOLTIP,
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    grid: vars.map((_, i) => ({ left: 56, right: 16, top: `${4 + i * slot}%`, height: `${slot - 5}%` })),
    xAxis: vars.map((_, i) => ({ type: 'value', gridIndex: i, scale: true, name: i === n - 1 ? 's' : '', axisLabel: { show: i === n - 1 } })),
    yAxis: vars.map((v, i) => ({ type: 'value', gridIndex: i, scale: true, name: v, nameGap: 36, nameLocation: 'middle', nameTextStyle: { fontSize: 10 } })),
    dataZoom: timeZoom(idx),
    series,
  } as EChartsOption;
};

const tsOverlay: ChartBuilder = (spec, data, selected, ts = {}) => {
  const s = singleAxis(runsOf(spec, data, ts), spec.vars ?? []);
  if (!isSingle(s)) return s;
  const opt: Opt = {
    animation: false,
    tooltip: TOOLTIP,
    grid: { left: 56, right: 16, top: 16, bottom: 56 },
    xAxis: { type: 'value', scale: true, name: 's' },
    yAxis: { type: 'value', scale: true, name: s.v },
    dataZoom: timeZoom([0]),
    series: s.runs.map(r => line(r, selected, { data: pairs(r.ts.time, r.ts.series[s.v]) })),
  };
  // 색 필드가 있으면 값 범위를 그라데이션 범례로 보여 준다 (선 색은 run별로 직접 지정, visualMap은 범례 전용)
  const c = spec.color;
  if (c && (c.kind === 'param' || c.kind === 'objective')) {
    const vals = data.rows.filter(r => ts[r.id]).map(r => fieldValue(r, c, data.objectives)).filter((x): x is number => x !== null);
    if (vals.length) {
      const [lo, hi] = [minOf(vals), maxOf(vals)];
      opt.visualMap = {
        type: 'continuous', min: lo, max: hi === lo ? lo + 1 : hi, seriesIndex: [], calculable: false,
        orient: 'horizontal', left: 'center', bottom: 28, itemWidth: 10, itemHeight: 120, text: [`${c.name} ${num(hi)}`, `${num(lo)}`],
        inRange: { color: RAMP_COLORS },
      };
      opt.grid = { left: 56, right: 16, top: 16, bottom: 84 };
    }
  }
  return opt as EChartsOption;
};

const tsBand: ChartBuilder = (spec, data, _selected, ts = {}) => {
  const s = singleAxis(runsOf(spec, data, ts), spec.vars ?? []);
  if (!isSingle(s)) return s;
  const grid = s.runs[0].ts.time;
  const b = band(s.runs.map(r => resampleTo(r.ts.time, r.ts.series[s.v], grid)));
  const range = b.max.map((m, i) => m - b.min[i]);
  const colour = PALETTE[0];
  return {
    animation: false,
    tooltip: TOOLTIP,
    grid: { left: 56, right: 16, top: 16, bottom: 56 },
    xAxis: { type: 'value', scale: true, name: 's' },
    yAxis: { type: 'value', scale: true, name: s.v },
    dataZoom: timeZoom([0]),
    series: [
      { type: 'line', name: '최소', stack: 'band', showSymbol: false, silent: true, lineStyle: { opacity: 0 }, data: pairs(grid, b.min) },
      { type: 'line', name: '범위', stack: 'band', showSymbol: false, silent: true, lineStyle: { opacity: 0 }, areaStyle: { color: colour, opacity: 0.2 }, data: pairs(grid, range) },
      { type: 'line', name: `평균 (run ${s.runs.length}개)`, showSymbol: false, lineStyle: { width: 1.6, color: colour }, itemStyle: { color: colour }, data: pairs(grid, b.mean) },
    ],
  } as EChartsOption;
};

const tsDiff: ChartBuilder = (spec, data, selected, ts = {}) => {
  const s = singleAxis(runsOf(spec, data, ts), spec.vars ?? []);
  if (!isSingle(s)) return s;
  // 기준 run은 refRunId, 없으면 선택(없으면 화면 맨 앞)의 첫 run. refRunId가 아직 안 왔으면 기준을 몰래 바꾸지 않는다.
  const first = selected.length ? s.runs.find(r => r.id === selected[0]) : undefined;
  const ref = spec.refRunId ? s.runs.find(r => r.id === spec.refRunId) : first ?? s.runs[0];
  if (!ref) return { empty: '기준 run 데이터를 불러오는 중' };
  const grid = ref.ts.time;
  const yRef = ref.ts.series[s.v];
  return {
    animation: false,
    tooltip: TOOLTIP,
    grid: { left: 56, right: 16, top: 16, bottom: 56 },
    xAxis: { type: 'value', scale: true, name: 's' },
    yAxis: { type: 'value', scale: true, name: `Δ ${s.v}` },
    dataZoom: timeZoom([0]),
    series: s.runs.map(r => {
      const y = r.id === ref.id ? yRef : resampleTo(r.ts.time, r.ts.series[s.v], grid);
      return line(r, selected, { data: pairs(grid, y.map((v, i) => v - yRef[i])) });
    }),
  } as EChartsOption;
};

const phase: ChartBuilder = (spec, data, selected, ts = {}) => {
  const [vx, vy] = spec.vars ?? [];
  if (!vx || !vy) return NEED_TWO;
  const runs = runsOf(spec, data, ts).filter(r => r.ts.series[vx] && r.ts.series[vy]);
  if (!runs.length) return NO_VALUE;
  return {
    animation: false,
    tooltip: TOOLTIP,
    grid: { left: 56, right: 16, top: 16, bottom: 40 },
    xAxis: { type: 'value', scale: true, name: vx },
    yAxis: { type: 'value', scale: true, name: vy },
    series: runs.map(r => {
      const x = r.ts.series[vx], y = r.ts.series[vy];
      const n = Math.min(x.length, y.length);
      const d: (number | null)[][] = [];
      for (let i = 0; i < n; i++) if (Number.isFinite(x[i])) d.push([num(x[i]), finiteOrNull(y[i])]);
      return line(r, selected, { data: d });
    }),
  } as EChartsOption;
};

/** 비균일 간격이면 (끝-처음)/(n-1) 간격 격자로 보간해 신호와 dt를 돌려준다 */
function uniformSignal(t: number[], y: number[]): { signal: number[]; dt: number } | undefined {
  const n = Math.min(t.length, y.length);
  if (n < MIN_FFT_POINTS) return undefined;
  const dt = (t[n - 1] - t[0]) / (n - 1);
  if (!(dt > 0)) return undefined;
  let uniform = true;
  for (let i = 1; i < n && uniform; i++) uniform = Math.abs(t[i] - t[i - 1] - dt) <= UNIFORM_TOL * dt;
  if (uniform) return { signal: y.slice(0, n), dt };
  const grid = Array.from({ length: n }, (_, i) => t[0] + i * dt);
  return { signal: resampleTo(t.slice(0, n), y.slice(0, n), grid), dt };
}

const fftChart: ChartBuilder = (spec, data, selected, ts = {}) => {
  const s = singleAxis(runsOf(spec, data, ts), spec.vars ?? []);
  if (!isSingle(s)) return s;
  const series: Opt[] = [];
  for (const r of s.runs) {
    const u = uniformSignal(r.ts.time, r.ts.series[s.v]);
    if (!u) continue;
    const { freq, amp } = fft(u.signal, u.dt);
    // 0 Hz(평균값)는 나머지 봉우리를 눌러 버리므로 뺀다
    series.push(line(r, selected, { data: freq.slice(1).map((f, i) => [num(f), num(amp[i + 1])]) }));
  }
  if (!series.length) return NO_VALUE;
  return {
    animation: false,
    tooltip: TOOLTIP,
    grid: { left: 56, right: 16, top: 16, bottom: 40 },
    xAxis: { type: 'value', name: 'Hz' },
    yAxis: { type: 'value', name: `|${s.v}|` },
    series,
  } as EChartsOption;
};

export const TIMESERIES_BUILDERS = {
  tsSubplots, tsOverlay, tsBand, tsDiff, phase, fft: fftChart,
} satisfies Partial<Record<PanelSpec['chart'], ChartBuilder>>;
