// 최적화 차트 4종: 수렴·Pareto·중요도·시도 개요. 배치 잡에도 그대로 쓸 수 있다.
// pareto 3D는 echarts-gl이 필요하다 (surface.ts와 같이 부수효과 import, 테스트에서는 mock).
import 'echarts-gl';
import type { EChartsOption } from 'echarts';
import type { Direction, OptimizationRequest } from '../../api/types';
import { paretoFront } from '../pareto';
import { bestSoFar, spearman } from '../vizStats';
import type { FieldRef, PanelSpec, WorkbenchData } from '../workbench';
import { itemOpacity, num } from './common';
import { fieldValue } from './fields';
import type { ChartBuilder, ChartResult } from './index';

const NO_VALUE: ChartResult = { empty: '값 없음' };
const BASE_COLOR = '#5470c6';
const BEST_COLOR = '#ee6666';
const FAIL_COLOR = '#e03131';
const OK_COLOR = '#5470c6';
const MUTED_COLOR = '#adb5bd';

// ---- convergence ----

export const convergence: ChartBuilder = (spec, data, selected) => {
  const { y } = spec;
  if (!y) return NO_VALUE;
  const dir: Direction = spec.objectiveDir ?? 'minimize';
  const rows = [...data.rows].sort((a, b) => a.index - b.index);
  const values = rows.map(r => fieldValue(r, y, data.objectives));
  if (values.every(v => v === null)) return NO_VALUE;
  const best = bestSoFar(values, dir);
  return {
    tooltip: { trigger: 'item' },
    legend: {},
    brush: { toolbox: ['rect', 'clear'], xAxisIndex: 0, yAxisIndex: 0 },
    xAxis: { type: 'value', name: 'run index', minInterval: 1 },
    yAxis: { type: 'value', name: y.name, scale: true },
    series: [
      {
        type: 'scatter', name: 'run', symbolSize: 7,
        data: rows.flatMap((r, i) => values[i] === null ? [] : [{
          id: r.id, name: `#${r.index}`, value: [r.index, values[i]],
          itemStyle: { color: BASE_COLOR, opacity: itemOpacity(r.id, selected) },
        }]),
      },
      {
        type: 'line', name: dir === 'minimize' ? '최소 누적' : '최대 누적', step: 'end', symbol: 'none', z: 3,
        lineStyle: { color: BEST_COLOR, width: 2 }, itemStyle: { color: BEST_COLOR },
        data: rows.flatMap((r, i) => best[i] === null ? [] : [[r.index, best[i]]]),
      },
    ],
  } as EChartsOption;
};

// ---- pareto ----

/** 최적화 잡 하나만 보고 있고 모든 축이 그 잡의 목적함수면 잡 설정의 축별 방향. 아니면 null. */
function jobDirections(refs: FieldRef[], data: WorkbenchData): Direction[] | null {
  if (data.jobs.length !== 1 || data.jobs[0].kind !== 'optimization') return null;
  const objs = (data.jobs[0].config as OptimizationRequest).objectives ?? [];
  const dirs: Direction[] = [];
  for (const r of refs) {
    if (r.kind !== 'objective') return null;
    const id = data.objectives.find(o => o.name === r.name)?.id;
    const o = objs.find(x => x.objectiveId === id);
    if (!o) return null;
    dirs.push(o.direction);
  }
  return dirs;
}

export const pareto: ChartBuilder = (spec, data, selected) => {
  const { x, y, z } = spec;
  if (!x || !y) return NO_VALUE;
  const refs: FieldRef[] = z ? [x, y, z] : [x, y];
  const dir: Direction = spec.objectiveDir ?? 'minimize';
  const fromJob = jobDirections(refs, data);
  const dirs = fromJob ?? refs.map(() => dir);
  // 축마다 방향이 다를 수 있는데 하나로 적용하고 있음을 차트에 밝힌다
  const note = fromJob ? undefined : {
    text: '', subtext: `모든 축에 같은 방향(${dir === 'minimize' ? '최소화' : '최대화'}) 적용`,
    right: 8, top: 0, subtextStyle: { fontSize: 11 },
  };
  const rows = data.rows.filter(r => refs.every(f => fieldValue(r, f, data.objectives) !== null));
  if (!rows.length) return NO_VALUE;
  const pts = rows.map(r => refs.map(f => fieldValue(r, f, data.objectives) as number));
  const front = paretoFront(pts, dirs);
  const item = (i: number) => ({
    id: rows[i].id, name: `#${rows[i].index}`, value: pts[i],
    itemStyle: { color: front[i] ? BEST_COLOR : MUTED_COLOR, opacity: itemOpacity(rows[i].id, selected) },
  });
  if (z) {
    return {
      title: note,
      tooltip: {},
      grid3D: {},
      xAxis3D: { type: 'value', name: x.name },
      yAxis3D: { type: 'value', name: y.name },
      zAxis3D: { type: 'value', name: z.name },
      series: [{ type: 'scatter3D', symbolSize: 6, data: rows.map((_, i) => item(i)) }],
    } as EChartsOption;
  }
  // 앞쪽 점을 x 순으로 이어 front 선을 그린다
  const line = pts.filter((_, i) => front[i]).map(p => [p[0], p[1]]).sort((a, b) => a[0] - b[0]);
  return {
    title: note,
    tooltip: { trigger: 'item' },
    legend: {},
    brush: { toolbox: ['rect', 'clear'], xAxisIndex: 0, yAxisIndex: 0 },
    xAxis: { type: 'value', name: x.name, scale: true },
    yAxis: { type: 'value', name: y.name, scale: true },
    series: [
      { type: 'scatter', name: 'run', symbolSize: 8, data: rows.map((_, i) => item(i)) },
      {
        type: 'line', name: 'Pareto front', data: line, symbol: 'none', silent: true, z: 1,
        lineStyle: { color: BEST_COLOR, type: 'dashed', width: 1.5 }, itemStyle: { color: BEST_COLOR },
      },
    ],
  } as EChartsOption;
};

// ---- importance ----

export const importance: ChartBuilder = (spec, data) => {
  const { y } = spec;
  const fields = spec.fields ?? [];
  if (!y || !fields.length) return NO_VALUE;
  const yv = data.rows.map(r => fieldValue(r, y, data.objectives));
  const items = fields.flatMap(f => {
    const rho = spearman(data.rows.map(r => fieldValue(r, f, data.objectives)), yv);
    return rho === null ? [] : [{ name: f.name, abs: Math.abs(rho) }];
  });
  if (!items.length) return NO_VALUE;
  const total = items.reduce((s, i) => s + i.abs, 0);
  const norm = items.map(i => ({ name: i.name, value: total === 0 ? 0 : i.abs / total })).sort((a, b) => b.value - a.value);
  return {
    tooltip: { trigger: 'item' },
    grid: { left: 100, right: 30, top: 20, bottom: 40 },
    xAxis: { type: 'value', name: `중요도 (|Spearman ρ| 정규화, ${y.name})`, nameLocation: 'middle', nameGap: 26, min: 0 },
    // inverse: 첫 항목(중요도 최대)이 맨 위
    yAxis: { type: 'category', inverse: true, data: norm.map(i => i.name) },
    series: [{ type: 'bar', data: norm.map(i => ({ value: num(i.value), itemStyle: { color: BASE_COLOR } })) }],
  } as EChartsOption;
};

// ---- trialOverview ----

export const trialOverview: ChartBuilder = (_spec: PanelSpec, data: WorkbenchData, selected) => {
  if (!data.rows.length) return NO_VALUE;
  const rows = [...data.rows].sort((a, b) => a.index - b.index);
  return {
    tooltip: { trigger: 'item' },
    xAxis: { type: 'category', name: 'run index', data: rows.map(r => r.index) },
    yAxis: { type: 'value', name: '소요 시간 (s)' },
    series: [{
      type: 'bar',
      data: rows.map(r => ({
        id: r.id, name: `#${r.index}`, value: r.elapsedSec,
        itemStyle: { color: r.status === 'failed' ? FAIL_COLOR : OK_COLOR, opacity: itemOpacity(r.id, selected) },
      })),
    }],
  } as EChartsOption;
};

export const OPTIMIZATION_BUILDERS = { convergence, pareto, importance, trialOverview } satisfies Record<string, ChartBuilder>;
