import { describe, expect, it } from 'vitest';
import type { RunRow } from '../../api/types';
import type { PanelSpec, WorkbenchData } from '../workbench';
import { buildChart, isEmptyChart } from './index';
import { SCALAR_BUILDERS } from './scalar';

function row(i: number, p: number | null, q: number | null, o: number | null, over: Partial<RunRow> = {}): RunRow {
  return {
    id: `r${i}`, jobId: i % 2 ? 'j1' : 'j2', fmuId: 'f', index: i, params: { p: p as number, q: q as number },
    status: 'ok', error: null, elapsedSec: 1, variantId: 'v1',
    objectives: { o1: { value: o, error: null } }, ...over,
  };
}
function mk(rows: RunRow[]): WorkbenchData {
  return {
    rows, objectives: [{ id: 'o1', name: 'cost' }], params: ['p', 'q'], vars: [],
    jobs: [{ id: 'j1', name: 'A' }, { id: 'j2', name: 'B' }] as WorkbenchData['jobs'],
    variants: [{ id: 'v1', label: '원본' }] as WorkbenchData['variants'],
  };
}
const P = { kind: 'param', name: 'p' } as const;
const Q = { kind: 'param', name: 'q' } as const;
const O = { kind: 'objective', name: 'cost' } as const;
const rows = [row(1, 1, 2, 10), row(2, 2, 4, 8), row(3, 3, 5, 9), row(4, 4, 9, 3), row(5, null, 1, 1)];
const data = mk(rows);
const spec = (chart: PanelSpec['chart'], over: Partial<PanelSpec> = {}): PanelSpec => ({ id: 's', title: 't', chart, ...over });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type O = any;
const opt = (r: unknown): O => { expect(isEmptyChart(r as never)).toBe(false); return r; };
const arr = (x: unknown) => (Array.isArray(x) ? x : [x]);

describe('scalar charts', () => {
  it('8종이 레지스트리에 등록된다', () => {
    for (const k of ['scatter', 'scatterMatrix', 'parallel', 'histogram', 'boxViolin', 'corrHeatmap', 'radar', 'bar'] as const) {
      expect(SCALAR_BUILDERS[k]).toBeTypeOf('function');
      expect(buildChart(spec(k), data, [])).not.toEqual({ empty: '준비 중' });
    }
  });

  it('scatter: null 행 제외, 점에 run id, 선택 외 흐림', () => {
    const o = opt(buildChart(spec('scatter', { x: P, y: O }), data, ['r2']));
    const pts = arr(o.series).flatMap((s: O) => s.data);
    expect(pts.map((d: O) => d.id)).toEqual(['r1', 'r2', 'r3', 'r4']);
    expect(pts.find((d: O) => d.id === 'r2').itemStyle.opacity).toBe(1);
    expect(pts.find((d: O) => d.id === 'r1').itemStyle.opacity).toBe(0.15);
    expect(o.xAxis.name).toBe('p');
    expect(o.yAxis.name).toBe('cost');
  });
  it('scatter: 그룹 색이면 그룹별 시리즈', () => {
    const o = opt(buildChart(spec('scatter', { x: P, y: O, color: { kind: 'job' } }), data, []));
    expect(arr(o.series)).toHaveLength(2);
  });
  it('scatter: 전부 null / 필드 미지정 → 값 없음', () => {
    const allNull = mk([row(1, null, 1, 1)]);
    expect(buildChart(spec('scatter', { x: P, y: O }), allNull, [])).toEqual({ empty: '값 없음' });
    expect(buildChart(spec('scatter'), data, [])).toEqual({ empty: '값 없음' });
  });

  it('scatterMatrix: 3필드 → grid 9개', () => {
    const o = opt(buildChart(spec('scatterMatrix', { fields: [P, Q, O] }), data, []));
    expect(o.grid).toHaveLength(9);
    expect(o.series).toHaveLength(9);
    expect(o.series[0].data).toHaveLength(4);
  });
  it('scatterMatrix: 6개까지만, 전부 null → 값 없음', () => {
    const f = [P, Q, O, P, Q, O, P];
    expect(opt(buildChart(spec('scatterMatrix', { fields: f }), data, [])).grid).toHaveLength(36);
    expect(buildChart(spec('scatterMatrix', { fields: [P, Q] }), mk([row(1, null, null, 1)]), [])).toEqual({ empty: '값 없음' });
  });

  it('parallel: 축 수와 null 행 제외', () => {
    const o = opt(buildChart(spec('parallel', { fields: [P, Q, O] }), data, ['r1']));
    expect(o.parallelAxis.map((a: O) => a.name)).toEqual(['p', 'q', 'cost']);
    expect(o.series[0].data).toHaveLength(4);
    expect(o.series[0].data[0].id).toBe('r1');
    expect(o.series[0].data[1].lineStyle.opacity).toBe(0.15);
    expect(buildChart(spec('parallel', { fields: [P, Q] }), mk([row(1, null, 1, 1)]), [])).toEqual({ empty: '값 없음' });
  });

  it('histogram: 개수 합이 유효 값 수, 선택 오버레이', () => {
    const o = opt(buildChart(spec('histogram', { x: P }), data, []));
    expect(o.series).toHaveLength(1);
    expect(o.series[0].data.reduce((a: number, b: number) => a + b, 0)).toBe(4);
    const o2 = opt(buildChart(spec('histogram', { x: P }), data, ['r1', 'r5']));
    expect(o2.series).toHaveLength(2);
    expect(o2.series[1].data.reduce((a: number, b: number) => a + b, 0)).toBe(1);
    expect(buildChart(spec('histogram', { x: P }), mk([row(1, null, 1, 1)]), [])).toEqual({ empty: '값 없음' });
  });

  it('boxViolin: 그룹별 박스, violin이면 custom 시리즈 추가', () => {
    const o = opt(buildChart(spec('boxViolin', { y: O, groupBy: 'job' }), data, []));
    expect(o.xAxis.data).toEqual(['A', 'B']);
    expect(o.series).toHaveLength(1);
    expect(o.series[0].type).toBe('boxplot');
    expect(o.series[0].data).toHaveLength(2);
    const v = opt(buildChart(spec('boxViolin', { y: O, groupBy: 'job', violin: true }), data, []));
    expect(v.series.map((s: O) => s.type)).toEqual(['custom', 'boxplot']);
    expect(buildChart(spec('boxViolin', { y: O }), mk([row(1, 1, 1, null)]), [])).toEqual({ empty: '값 없음' });
  });

  it('corrHeatmap: n×n 셀, visualMap -1..1', () => {
    const o = opt(buildChart(spec('corrHeatmap', { fields: [P, Q, O] }), data, []));
    expect(o.series[0].data).toHaveLength(9);
    expect(o.visualMap.min).toBe(-1);
    expect(o.visualMap.max).toBe(1);
    const diag = o.series[0].data.find((d: O) => d.value[0] === 0 && d.value[1] === 0);
    expect(diag.value[2]).toBe(1);
    expect(buildChart(spec('corrHeatmap', { fields: [P, Q] }), mk([row(1, null, null, 1)]), [])).toEqual({ empty: '값 없음' });
  });

  it('radar: 선택 없으면 안내, 선택 run 최대 8개, 0..1 정규화', () => {
    expect(buildChart(spec('radar', { fields: [P, Q, O] }), data, [])).toEqual({ empty: '비교할 run을 선택하세요' });
    const o = opt(buildChart(spec('radar', { fields: [P, Q, O] }), data, ['r1', 'r4', 'r5']));
    expect(o.radar.indicator).toHaveLength(3);
    const items = o.series[0].data;
    expect(items.map((d: O) => d.id)).toEqual(['r1', 'r4']);   // r5는 null이라 제외
    expect(items[0].value[0]).toBe(0);
    expect(items[1].value[0]).toBe(1);
    const many = mk(Array.from({ length: 10 }, (_, i) => row(i, i, i, i)));
    const o2 = opt(buildChart(spec('radar', { fields: [P, Q] }), many, many.rows.map(r => r.id)));
    expect(o2.series[0].data).toHaveLength(8);
  });

  it('bar: 그룹 평균과 표준편차', () => {
    const o = opt(buildChart(spec('bar', { y: P, groupBy: 'job' }), data, []));
    expect(o.xAxis.data).toEqual(['A', 'B']);
    // j1: r1,r3,(r5 null) → 1,3 / j2: r2,r4 → 2,4
    expect(o.series[0].data).toEqual([2, 3]);
    expect(o.series[1].data[0][1]).toBeCloseTo(Math.SQRT2);
    expect(buildChart(spec('bar', { y: O }), mk([row(1, 1, 1, null)]), [])).toEqual({ empty: '값 없음' });
  });
});
