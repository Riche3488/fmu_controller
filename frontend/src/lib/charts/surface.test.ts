import { describe, expect, it, vi } from 'vitest';
import type { RunRow } from '../../api/types';
import type { PanelSpec, WorkbenchData } from '../workbench';
import { buildChart, isEmptyChart } from './index';
import { smokeRender } from '../../test/echartsSmoke';
import { SCALAR_BUILDERS } from './scalar';
import { SURFACE_BUILDERS } from './surface';

vi.mock('echarts-gl', () => ({}));

function row(i: number, p: number | null, q: number | null, r: number | null, o: number | null): RunRow {
  return {
    id: `r${i}`, jobId: 'j1', fmuId: 'f', index: i, params: { p: p as number, q: q as number, r: r as number },
    status: 'ok', error: null, elapsedSec: 1, variantId: 'v1',
    objectives: { o1: { value: o, error: null } },
  };
}
const data: WorkbenchData = {
  // cost = p 증가 시 증가(p), q 증가 시 감소(큰 폭), r은 거의 무관
  rows: [
    row(1, 1, 5, 3, 10), row(2, 2, 4, 1, 12), row(3, 3, 3, 2, 14), row(4, 4, 2, 5, 16),
    row(5, 5, 1, 4, 18), row(6, 6, 0, 3, 20), row(7, null, 1, 1, null),
  ],
  objectives: [{ id: 'o1', name: 'cost' }], params: ['p', 'q', 'r'], vars: [],
  jobs: [], variants: [],
};
const P = { kind: 'param', name: 'p' } as const;
const Q = { kind: 'param', name: 'q' } as const;
const R = { kind: 'param', name: 'r' } as const;
const O = { kind: 'objective', name: 'cost' } as const;
const spec = (chart: PanelSpec['chart'], over: Partial<PanelSpec> = {}): PanelSpec => ({ id: 's', title: 't', chart, ...over });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const opt = (r: unknown): Any => { expect(isEmptyChart(r as never)).toBe(false); return r; };

describe('surface charts', () => {
  it('5종이 레지스트리에 등록된다', () => {
    for (const k of ['contour', 'tornado', 'slice1d', 'scatter3d', 'surface3d'] as const) {
      expect(SURFACE_BUILDERS[k]).toBeTypeOf('function');
      expect(buildChart(spec(k), data, [])).not.toEqual({ empty: '준비 중' });
    }
  });

  it('필드가 없으면 값 없음', () => {
    for (const k of ['contour', 'tornado', 'slice1d', 'scatter3d', 'surface3d'] as const) {
      expect(buildChart(spec(k), data, [])).toEqual({ empty: '값 없음' });
    }
  });

  it('contour: 40x40 heatmap(1600점)과 원 데이터 scatter', () => {
    const o = opt(buildChart(spec('contour', { x: P, y: Q, z: O }), data, ['r2']));
    const heat = o.series.find((s: Any) => s.type === 'custom');
    expect(heat.data).toHaveLength(1600);
    const pts = o.series.find((s: Any) => s.type === 'scatter');
    expect(pts.data).toHaveLength(6);   // p가 없는 행 제외
    expect(pts.data[0]).toMatchObject({ id: 'r1', value: [1, 5, 10] });
    expect(pts.data[1].itemStyle.opacity).toBe(1);
    expect(pts.data[0].itemStyle.opacity).toBeLessThan(1);
    expect(heat.data[0].id).toBeUndefined();
  });

  it('tornado: |ρ| 내림차순, 양/음 색이 다르다', () => {
    const o = opt(buildChart(spec('tornado', { y: O, fields: [R, P, Q] }), data, []));
    const s = o.series[0];
    expect(s.type).toBe('bar');
    // 가로 막대: 카테고리 y축, 가장 큰 |ρ|가 위(inverse)
    expect(o.yAxis.type).toBe('category');
    expect(o.yAxis.inverse).toBe(true);
    expect(o.yAxis.data.slice(0, 2).sort()).toEqual(['p', 'q']);
    const vals = s.data.map((d: Any) => d.value as number);
    const abs = vals.map(Math.abs);
    expect(abs).toEqual([...abs].sort((a, b) => b - a));
    const byName = Object.fromEntries(o.yAxis.data.map((n: string, i: number) => [n, s.data[i]]));
    expect(byName.p.value).toBeCloseTo(1);
    expect(byName.q.value).toBeCloseTo(-1);
    expect(byName.p.itemStyle.color).not.toBe(byName.q.itemStyle.color);
    expect(o.yAxis.data[2]).toBe('r');
  });

  it('tornado: y가 없거나 계산 불가면 값 없음', () => {
    expect(buildChart(spec('tornado', { fields: [P] }), data, [])).toEqual({ empty: '값 없음' });
    const few = { ...data, rows: data.rows.slice(0, 2) };
    expect(buildChart(spec('tornado', { y: O, fields: [P] }), few, [])).toEqual({ empty: '값 없음' });
  });

  it('slice1d: x를 10구간으로 나눠 y 평균·최소·최대', () => {
    const o = opt(buildChart(spec('slice1d', { x: P, y: O }), data, []));
    const names = o.series.map((s: Any) => s.name);
    expect(names).toEqual(['평균', '최소', '최대']);
    expect(o.xAxis.data.length).toBeLessThanOrEqual(10);
    const mean = o.series[0].data as number[];
    expect(mean).toHaveLength(o.xAxis.data.length);
    // 값이 6개(p=1..6)라 구간 하나에 많아야 하나씩 들어가고 평균 = 그 y
    expect(mean[0]).toBe(10);
    expect(mean[mean.length - 1]).toBe(20);
    expect(o.series[1].data[0]).toBe(10);
    expect(o.series[2].data[0]).toBe(10);
  });

  it('slice1d: 한 구간에 여럿이면 평균·범위', () => {
    const d = { ...data, rows: [row(1, 0, 0, 0, 2), row(2, 0.01, 0, 0, 6), row(3, 10, 0, 0, 5)] };
    const o = opt(buildChart(spec('slice1d', { x: P, y: O }), d, []));
    expect(o.series[0].data[0]).toBe(4);
    expect(o.series[1].data[0]).toBe(2);
    expect(o.series[2].data[0]).toBe(6);
  });

  it('scatter3d: scatter3D series, 3D 축, run id', () => {
    const o = opt(buildChart(spec('scatter3d', { x: P, y: Q, z: O, color: R }), data, ['r1']));
    expect(o.series[0].type).toBe('scatter3D');
    for (const k of ['grid3D', 'xAxis3D', 'yAxis3D', 'zAxis3D']) expect(o[k]).toBeDefined();
    expect(o.series[0].data).toHaveLength(6);
    expect(o.series[0].data[0]).toMatchObject({ id: 'r1', value: [1, 5, 10, 3] });
    expect(o.visualMap).toBeDefined();
    expect(o.series[0].data[1].itemStyle.opacity).toBeLessThan(1);
  });

  it('surface3d: surface series, 40x40 격자', () => {
    const o = opt(buildChart(spec('surface3d', { x: P, y: Q, z: O }), data, []));
    expect(o.series[0].type).toBe('surface');
    expect(o.series[0].data).toHaveLength(1600);
    expect(o.series[0].data[0]).toHaveLength(3);
    for (const k of ['grid3D', 'xAxis3D', 'yAxis3D', 'zAxis3D']) expect(o[k]).toBeDefined();
  });

  it('contour: 셀은 custom 사각형, visualMap이 그 시리즈에 걸린다', () => {
    const o = opt(buildChart(spec('contour', { x: P, y: Q, z: O }), data, []));
    expect(o.series.some((s: Any) => s.type === 'heatmap')).toBe(false);
    expect(o.visualMap.seriesIndex).toContain(o.series.findIndex((s: Any) => s.type === 'custom'));
    expect(o.visualMap.dimension).toBe(2);
  });

  it('2D 빌더 전부 실제 ECharts에서 setOption·렌더된다 (헤드리스 스모크)', () => {
    const specs: PanelSpec[] = [
      spec('scatter', { x: P, y: Q, color: O }), spec('scatterMatrix', { fields: [P, Q, O] }), spec('parallel', { fields: [P, Q, O] }),
      spec('histogram', { x: P }), spec('boxViolin', { y: O, violin: true }), spec('corrHeatmap', { fields: [P, Q, O] }),
      spec('radar', { fields: [P, Q, O] }), spec('bar', { y: O }),
      spec('contour', { x: P, y: Q, z: O }), spec('tornado', { y: O, fields: [P, Q, R] }), spec('slice1d', { x: P, y: O }),
    ];
    for (const sp of specs) {
      expect(sp.chart in SCALAR_BUILDERS || sp.chart in SURFACE_BUILDERS).toBe(true);
      const r = opt(buildChart(sp, data, ['r1']));
      expect(() => smokeRender(r), sp.chart).not.toThrow();
    }
  });
});
