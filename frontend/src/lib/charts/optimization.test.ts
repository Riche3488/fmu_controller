import { describe, expect, it, vi } from 'vitest';
import type { RunRow } from '../../api/types';
import type { PanelSpec, WorkbenchData } from '../workbench';
import { buildChart, isEmptyChart } from './index';
import { smokeRender } from '../../test/echartsSmoke';
import { OPTIMIZATION_BUILDERS } from './optimization';

vi.mock('echarts-gl', () => ({}));

function row(i: number, p: number, q: number, f1: number | null, f2: number | null, status: 'ok' | 'failed' = 'ok'): RunRow {
  return {
    id: `r${i}`, jobId: 'j1', fmuId: 'f', index: i, params: { p, q }, status, error: null, elapsedSec: i * 0.5, variantId: 'v1',
    objectives: { o1: { value: f1, error: null }, o2: { value: f2, error: null }, o3: { value: f1, error: null } },
  };
}
const data: WorkbenchData = {
  rows: [
    row(1, 1, 5, 10, 1), row(2, 2, 4, 8, 3), row(3, 3, 3, 9, 2), row(4, 4, 2, 5, 6),
    row(5, 5, 1, 6, 5), row(6, 6, 0, null, null, 'failed'),
  ],
  objectives: [{ id: 'o1', name: 'cost' }, { id: 'o2', name: 'time' }, { id: 'o3', name: 'third' }],
  params: ['p', 'q'], vars: [], jobs: [], variants: [],
};
const P = { kind: 'param', name: 'p' } as const;
const Q = { kind: 'param', name: 'q' } as const;
const C = { kind: 'objective', name: 'cost' } as const;
const T = { kind: 'objective', name: 'time' } as const;
const H = { kind: 'objective', name: 'third' } as const;
const spec = (chart: PanelSpec['chart'], over: Partial<PanelSpec> = {}): PanelSpec => ({ id: 's', title: 't', chart, ...over });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const opt = (r: unknown): Any => { expect(isEmptyChart(r as never)).toBe(false); return r; };

describe('optimization charts', () => {
  it('4종이 레지스트리에 등록된다', () => {
    for (const k of ['convergence', 'pareto', 'importance', 'trialOverview'] as const) {
      expect(OPTIMIZATION_BUILDERS[k]).toBeTypeOf('function');
      expect(buildChart(spec(k), data, [])).not.toEqual({ empty: '준비 중' });
    }
  });

  it('필드가 없으면 값 없음', () => {
    for (const k of ['convergence', 'pareto', 'importance'] as const) {
      expect(buildChart(spec(k), data, [])).toEqual({ empty: '값 없음' });
    }
    expect(buildChart(spec('trialOverview'), { ...data, rows: [] }, [])).toEqual({ empty: '값 없음' });
  });

  it('convergence: 산점 + bestSoFar 계단선(minimize 기본)', () => {
    const o = opt(buildChart(spec('convergence', { y: C }), data, ['r2']));
    const pts = o.series[0];
    expect(pts.data).toHaveLength(5);   // 값 없는 run 제외
    expect(pts.data[0]).toMatchObject({ id: 'r1', value: [1, 10] });
    expect(pts.data[1].itemStyle.opacity).toBe(1);
    expect(pts.data[0].itemStyle.opacity).toBeLessThan(1);
    const line = o.series[1];
    expect(line.step).toBe('end');
    expect(line.data.map((d: number[]) => d[1])).toEqual([10, 8, 8, 5, 5, 5]);
  });

  it('convergence: maximize', () => {
    const o = opt(buildChart(spec('convergence', { y: C, objectiveDir: 'maximize' }), data, []));
    expect(o.series[1].data.map((d: number[]) => d[1])).toEqual([10, 10, 10, 10, 10, 10]);
  });

  it('pareto 2D: front 점 강조와 연결선', () => {
    const o = opt(buildChart(spec('pareto', { x: C, y: T }), data, []));
    const pts = o.series[0];
    expect(pts.data).toHaveLength(5);
    const front = pts.data.filter((d: Any) => d.itemStyle.color === '#ee6666').map((d: Any) => d.id);
    expect(front.sort()).toEqual(['r1', 'r2', 'r3', 'r4', 'r5']);   // 모두 서로 지배하지 않는다
    expect(o.series[1].type).toBe('line');
  });

  it('pareto: 최적화 잡 하나면 잡 설정의 축별 방향 (cost 최소, time 최대)', () => {
    const job = {
      id: 'j1', kind: 'optimization',
      config: { objectives: [{ objectiveId: 'o1', direction: 'minimize' }, { objectiveId: 'o2', direction: 'maximize' }] },
    } as Any;
    const o = opt(buildChart(spec('pareto', { x: C, y: T }), { ...data, jobs: [job] }, []));
    const front = o.series[0].data.filter((d: Any) => d.itemStyle.color === '#ee6666').map((d: Any) => d.id);
    expect(front).toEqual(['r4']);   // (5, 6)이 나머지를 모두 지배한다
    expect(o.title).toBeUndefined();
    // 축이 잡 목적함수가 아니면(파라미터) 한 방향 + 안내
    const f = opt(buildChart(spec('pareto', { x: C, y: P }), { ...data, jobs: [job] }, []));
    expect(f.title.subtext).toBe('모든 축에 같은 방향(최소화) 적용');
  });

  it('pareto: 잡을 특정할 수 없으면 한 방향 + 안내 문구', () => {
    const o = opt(buildChart(spec('pareto', { x: C, y: T, objectiveDir: 'maximize' }), data, []));
    expect(o.title.subtext).toBe('모든 축에 같은 방향(최대화) 적용');
  });

  it('pareto 3D: scatter3D', () => {
    const o = opt(buildChart(spec('pareto', { x: C, y: T, z: H }), data, []));
    expect(o.series[0].type).toBe('scatter3D');
    expect(o.series[0].data[0]).toMatchObject({ id: 'r1', value: [10, 1, 10] });
  });

  it('importance: |spearman| 합 1로 정규화, 큰 순', () => {
    const o = opt(buildChart(spec('importance', { y: C, fields: [P, Q] }), data, []));
    const v = o.series[0].data.map((d: Any) => d.value);
    expect(v.reduce((a: number, b: number) => a + b, 0)).toBeCloseTo(1, 5);
    expect(v[0]).toBeGreaterThanOrEqual(v[1]);
    expect(o.yAxis.data).toHaveLength(2);
  });

  it('trialOverview: elapsedSec 막대, 실패는 빨강, run id', () => {
    const o = opt(buildChart(spec('trialOverview'), data, ['r1']));
    const d = o.series[0].data;
    expect(d).toHaveLength(6);
    expect(d[1]).toMatchObject({ id: 'r2', value: 1 });
    expect(d[5].itemStyle.color).toBe('#e03131');
    expect(d[1].itemStyle.color).not.toBe('#e03131');
    expect(d[1].itemStyle.opacity).toBeLessThan(1);
  });

  it('실제 ECharts가 받아들인다 (3D 제외)', () => {
    expect(() => smokeRender(opt(buildChart(spec('convergence', { y: C }), data, [])))).not.toThrow();
    expect(() => smokeRender(opt(buildChart(spec('pareto', { x: C, y: T }), data, ['r1'])))).not.toThrow();
    expect(() => smokeRender(opt(buildChart(spec('importance', { y: C, fields: [P, Q] }), data, [])))).not.toThrow();
    expect(() => smokeRender(opt(buildChart(spec('trialOverview'), data, [])))).not.toThrow();
  });
});
