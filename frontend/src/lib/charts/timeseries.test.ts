import { describe, expect, it } from 'vitest';
import type { RunRow, Timeseries } from '../../api/types';
import { smokeRender } from '../../test/echartsSmoke';
import type { PanelSpec, WorkbenchData } from '../workbench';
import { buildChart, CHART_BUILDERS, isEmptyChart, runIdFromClick } from './index';
import { TIMESERIES_BUILDERS } from './timeseries';

function row(i: number, p: number): RunRow {
  return {
    id: `r${i}`, jobId: 'j1', fmuId: 'f', index: i, params: { p },
    status: 'ok', error: null, elapsedSec: 1, variantId: 'v1', objectives: {},
  };
}
const data: WorkbenchData = {
  rows: [row(1, 1), row(2, 2), row(3, 3)], objectives: [], params: ['p'], vars: ['a', 'b'],
  jobs: [{ id: 'j1', name: 'A' }] as WorkbenchData['jobs'], variants: [],
};
const time = Array.from({ length: 64 }, (_, i) => i * 0.1);
const mkTs = (k: number): Timeseries => ({
  time, series: { a: time.map(t => k * t), b: time.map(t => Math.sin(2 * Math.PI * 2 * t) * k) },
});
const ts = { r1: mkTs(1), r2: mkTs(2), r3: mkTs(3) };
const spec = (chart: PanelSpec['chart'], over: Partial<PanelSpec> = {}): PanelSpec => ({ id: 's', title: 't', chart, ...over });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const build = (s: PanelSpec, t: Record<string, Timeseries> = ts, sel: string[] = []): any => buildChart(s, data, sel, t);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const opt = (r: any) => { expect(isEmptyChart(r)).toBe(false); return r; };

describe('시계열 빌더 등록', () => {
  it('6종이 CHART_BUILDERS에 있다', () => {
    for (const k of Object.keys(TIMESERIES_BUILDERS)) expect(CHART_BUILDERS).toHaveProperty(k);
    expect(Object.keys(TIMESERIES_BUILDERS).sort()).toEqual(['fft', 'phase', 'tsBand', 'tsDiff', 'tsOverlay', 'tsSubplots']);
  });
});

describe('빈 상태', () => {
  it('변수 없음, 데이터 없음, 위상도 변수 1개', () => {
    expect(build(spec('tsOverlay'))).toEqual({ empty: '변수를 선택하세요' });
    expect(build(spec('tsOverlay', { vars: ['a'] }), {})).toEqual({ empty: '값 없음' });
    expect(build(spec('tsOverlay', { vars: ['zzz'] }))).toEqual({ empty: '값 없음' });
    expect(build(spec('phase', { vars: ['a'] }))).toEqual({ empty: '변수 2개를 선택하세요' });
    expect(build(spec('fft', { vars: ['a'] }), {})).toEqual({ empty: '값 없음' });
  });
});

describe('tsSubplots', () => {
  it('변수마다 grid 하나, run x 변수 series, 모든 x축에 줌 연결', () => {
    const o = opt(build(spec('tsSubplots', { vars: ['a', 'b'] })));
    expect(o.grid).toHaveLength(2);
    expect(o.xAxis).toHaveLength(2);
    expect(o.series).toHaveLength(6);
    expect(o.series[0]).toMatchObject({ id: 'r1::a', name: 'A #1', xAxisIndex: 0, yAxisIndex: 0 });
    expect(o.series[3]).toMatchObject({ id: 'r1::b', xAxisIndex: 1 });
    expect(o.axisPointer.link).toEqual([{ xAxisIndex: 'all' }]);
    expect(o.dataZoom.every((z: { xAxisIndex: number[] }) => z.xAxisIndex.join() === '0,1')).toBe(true);
    smokeRender(o);
  });
  it('선 클릭 시 seriesId에서 run id', () => {
    expect(runIdFromClick({ data: [0, 1], seriesId: 'r2::a' })).toBe('r2');
    expect(runIdFromClick({ data: { id: 'r3' }, seriesId: 'x' })).toBe('r3');
    expect(runIdFromClick({ data: [0, 1] })).toBeUndefined();
  });
});

describe('tsOverlay', () => {
  it('run마다 선 하나, 색 필드가 있으면 visualMap', () => {
    const plain = opt(build(spec('tsOverlay', { vars: ['a'] })));
    expect(plain.series).toHaveLength(3);
    expect(plain.series[1].id).toBe('r2');
    expect(plain.visualMap).toBeUndefined();
    const col = opt(build(spec('tsOverlay', { vars: ['a'], color: { kind: 'param', name: 'p' } })));
    expect(col.visualMap).toMatchObject({ min: 1, max: 3 });
    expect(col.series[0].lineStyle.color).not.toBe(col.series[2].lineStyle.color);
    smokeRender(col);
    smokeRender(plain);
  });
  it('선택 안 된 run은 흐리게', () => {
    const o = opt(build(spec('tsOverlay', { vars: ['a'] }), ts, ['r1']));
    expect(o.series[0].lineStyle.opacity).toBe(1);
    expect(o.series[1].lineStyle.opacity).toBeLessThan(1);
  });
});

describe('tsBand', () => {
  it('첫 run 격자 길이, 평균과 최소와 범위 값', () => {
    const o = opt(build(spec('tsBand', { vars: ['a'] })));
    expect(o.series).toHaveLength(3);
    for (const s of o.series) expect(s.data).toHaveLength(time.length);
    // a = k*t, k=1..3 이므로 index 10(t=1.0)에서 min=1, range=2, mean=2
    expect(o.series[0].data[10][1]).toBeCloseTo(1);
    expect(o.series[1].data[10][1]).toBeCloseTo(2);
    expect(o.series[2].data[10][1]).toBeCloseTo(2);
    expect(o.series[0].stack).toBe(o.series[1].stack);
    smokeRender(o);
  });
  it('다른 격자의 run은 보간해서 합친다', () => {
    const t2 = time.filter((_, i) => i % 2 === 0);
    const o = opt(build(spec('tsBand', { vars: ['a'] }), { r1: mkTs(1), r2: { time: t2, series: { a: t2.map(t => 2 * t) } } }));
    expect(o.series[2].data).toHaveLength(time.length);
    expect(o.series[0].data[1][1]).toBeCloseTo(0.1);   // r1: 0.1, r2 보간: 0.2
    expect(o.series[1].data[1][1]).toBeCloseTo(0.1);
  });
});

describe('tsDiff', () => {
  it('기준 run은 0선, 다른 run은 y - y_ref', () => {
    const o = opt(build(spec('tsDiff', { vars: ['a'], refRunId: 'r2' })));
    const byId = Object.fromEntries(o.series.map((s: { id: string }) => [s.id, s]));
    expect(byId.r2.data.every((d: number[]) => d[1] === 0)).toBe(true);
    expect(byId.r3.data[10][1]).toBeCloseTo(1);    // t=1에서 3t - 2t
    expect(byId.r1.data[10][1]).toBeCloseTo(-1);
    smokeRender(o);
  });
  it('refRunId가 없으면 첫 run 기준', () => {
    const o = opt(build(spec('tsDiff', { vars: ['a'] })));
    expect(o.series[0].data.every((d: number[]) => d[1] === 0)).toBe(true);
  });
});

describe('phase', () => {
  it('vars[0] vs vars[1] 쌍', () => {
    const o = opt(build(spec('phase', { vars: ['a', 'b'] })));
    expect(o.series).toHaveLength(3);
    const d = o.series[1].data;
    expect(d).toHaveLength(time.length);
    expect(d[10][0]).toBeCloseTo(2 * time[10]);
    expect(d[10][1]).toBeCloseTo(2 * Math.sin(2 * Math.PI * 2 * time[10]), 5);
    smokeRender(o);
  });
});

describe('fft', () => {
  const peakOf = (d: number[][]) => d.reduce((m, p) => (p[1] > m[1] ? p : m));
  it('4 Hz 사인파의 피크', () => {
    const t = Array.from({ length: 256 }, (_, i) => i * 0.01);
    const o = opt(build(spec('fft', { vars: ['b'] }), { r1: { time: t, series: { b: t.map(x => Math.sin(2 * Math.PI * 4 * x)) } } }));
    const peak = peakOf(o.series[0].data);
    expect(peak[0]).toBeCloseTo(4, 0);
    expect(peak[1]).toBeGreaterThan(0.8);   // bin 사이 누설로 1보다 작다
    smokeRender(o);
  });
  it('비균일 간격은 보간 후 같은 피크', () => {
    const t = Array.from({ length: 256 }, (_, i) => i * 0.01 + (i % 2 ? 0.002 : 0));
    const o = opt(build(spec('fft', { vars: ['b'] }), { r1: { time: t, series: { b: t.map(x => Math.sin(2 * Math.PI * 4 * x)) } } }));
    expect(peakOf(o.series[0].data)[0]).toBeCloseTo(4, 0);
  });
  it('점이 너무 적으면 값 없음', () => {
    expect(build(spec('fft', { vars: ['a'] }), { r1: { time: [0, 1], series: { a: [1, 2] } } })).toEqual({ empty: '값 없음' });
  });
});

describe('tsDiff 기준 run', () => {
  it('refRunId가 없으면 선택의 첫 run 기준', () => {
    const o = opt(build(spec('tsDiff', { vars: ['a'] }), ts, ['r3', 'r1']));
    const r3 = o.series.find((s: { id: string }) => s.id === 'r3');
    expect(r3.data.every((d: number[]) => d[1] === 0)).toBe(true);
  });
  it('refRunId 데이터가 아직 없으면 기준을 바꾸지 않고 안내', () => {
    const { r1, r3 } = ts;
    expect(build(spec('tsDiff', { vars: ['a'], refRunId: 'r2' }), { r1, r3 })).toEqual({ empty: '기준 run 데이터를 불러오는 중' });
  });
});
