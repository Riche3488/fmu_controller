// 응답면·민감도 차트 5종: 2D 등고선·토네이도·1D 슬라이스·3D 산점도·3D 표면
// 3D 차트는 echarts-gl이 필요하다. 부수효과 import로 3D 시리즈를 등록한다 (vitest/jsdom에는 WebGL이 없어 테스트에서 mock).
import 'echarts-gl';
import type { EChartsOption } from 'echarts';
import { idwGrid, spearman } from '../vizStats';
import type { FieldRef, PanelSpec, WorkbenchData } from '../workbench';
import { completeRows, itemOpacity, maxOf, minOf, num } from './common';
import { fieldValue } from './fields';
import type { ChartBuilder, ChartResult } from './index';

const NO_VALUE: ChartResult = { empty: '값 없음' };
const GRID_N = 40;
const SLICE_BINS = 10;
const POS_COLOR = '#ee6666';
const NEG_COLOR = '#5470c6';
const RAMP = ['#3b82f6', '#f5f5f5', '#f97316'];

type Opt = Record<string, unknown>;
type CellApi = { value: (i: number) => unknown; coord: (p: number[]) => number[]; visual: (k: string) => unknown };

/** x·y·z 필드가 모두 있는 행 → 점 목록 */
function xyzPoints(spec: PanelSpec, data: WorkbenchData) {
  const { x, y, z } = spec;
  if (!x || !y || !z) return [];
  return completeRows(data, [x, y, z]).map(({ row, v }) => ({ row, x: v[0], y: v[1], z: v[2] }));
}

const axes3d = (spec: PanelSpec): Opt => ({
  grid3D: {},
  xAxis3D: { type: 'value', name: spec.x?.name },
  yAxis3D: { type: 'value', name: spec.y?.name },
  zAxis3D: { type: 'value', name: spec.z?.name },
});

// ---- contour ----

export const contour: ChartBuilder = (spec, data, selected) => {
  const pts = xyzPoints(spec, data);
  if (!pts.length) return NO_VALUE;
  const g = idwGrid(pts, GRID_N, GRID_N);
  // 셀 항목에는 run id가 없다 (run id 계약: 격자 셀은 선택에 들어가지 않음)
  const cells = g.z.flatMap((r, j) => r.map((zv, i) => [g.xs[i], g.ys[j], zv]));
  const zs = pts.map(p => p.z);
  // heatmap 시리즈는 category 축 둘이 필요해, 값 축 격자 위에 셀을 custom 사각형으로 그린다 (산점도 겹침·브러시 유지)
  const dx = (g.xs[g.xs.length - 1] - g.xs[0]) / (GRID_N - 1) || 1;
  const dy = (g.ys[g.ys.length - 1] - g.ys[0]) / (GRID_N - 1) || 1;
  return {
    tooltip: { trigger: 'item' },
    brush: { toolbox: ['rect', 'clear'], xAxisIndex: 0, yAxisIndex: 0 },
    xAxis: { type: 'value', name: spec.x!.name, min: g.xs[0] - dx / 2, max: g.xs[g.xs.length - 1] + dx / 2 },
    yAxis: { type: 'value', name: spec.y!.name, min: g.ys[0] - dy / 2, max: g.ys[g.ys.length - 1] + dy / 2 },
    visualMap: {
      type: 'continuous', dimension: 2, seriesIndex: [0, 1], min: minOf(zs), max: maxOf(zs),
      inRange: { color: RAMP }, text: [spec.z!.name, ''], right: 0, top: 'middle', calculable: false,
    },
    series: [
      {
        type: 'custom', name: '보간', data: cells, silent: true, encode: { x: 0, y: 1 },
        renderItem: (_: unknown, api: CellApi) => {
          const cx = api.value(0) as number, cy = api.value(1) as number;
          const [x0, y0] = api.coord([cx - dx / 2, cy - dy / 2]);
          const [x1, y1] = api.coord([cx + dx / 2, cy + dy / 2]);
          return {
            type: 'rect', shape: { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0) + 0.5, height: Math.abs(y1 - y0) + 0.5 },
            style: { fill: api.visual('color') as string },
          };
        },
      },
      {
        type: 'scatter', name: 'run', symbolSize: 8, z: 3,
        data: pts.map(p => ({
          id: p.row.id, name: `#${p.row.index}`, value: [p.x, p.y, p.z],
          itemStyle: { opacity: itemOpacity(p.row.id, selected), borderColor: '#333', borderWidth: 1 },
        })),
      },
    ],
  } as EChartsOption;
};

// ---- tornado ----

export const tornado: ChartBuilder = (spec, data) => {
  const { y } = spec;
  const fields = spec.fields ?? [];
  if (!y || !fields.length) return NO_VALUE;
  const yv = data.rows.map(r => fieldValue(r, y, data.objectives));
  const items = fields.flatMap((f: FieldRef) => {
    const rho = spearman(data.rows.map(r => fieldValue(r, f, data.objectives)), yv);
    return rho === null ? [] : [{ name: f.name, rho }];
  }).sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho));
  if (!items.length) return NO_VALUE;
  return {
    tooltip: { trigger: 'item' },
    grid: { left: 100, right: 30, top: 20, bottom: 40 },
    xAxis: { type: 'value', name: `Spearman ρ (${y.name})`, nameLocation: 'middle', nameGap: 26, min: -1, max: 1 },
    // inverse: 첫 항목(|ρ| 최대)이 맨 위
    yAxis: { type: 'category', inverse: true, data: items.map(i => i.name) },
    series: [{
      type: 'bar',
      data: items.map(i => ({ value: num(i.rho), itemStyle: { color: i.rho >= 0 ? POS_COLOR : NEG_COLOR } })),
    }],
  } as EChartsOption;
};

// ---- slice1d ----

export const slice1d: ChartBuilder = (spec, data) => {
  const { x, y } = spec;
  if (!x || !y) return NO_VALUE;
  const pts = completeRows(data, [x, y]).map(({ v }) => ({ x: v[0], y: v[1] }));
  if (!pts.length) return NO_VALUE;
  const lo = minOf(pts.map(p => p.x)), hi = maxOf(pts.map(p => p.x));
  const w = (hi - lo) / SLICE_BINS;
  const bins: number[][] = Array.from({ length: SLICE_BINS }, () => []);
  for (const p of pts) bins[w === 0 ? 0 : Math.min(SLICE_BINS - 1, Math.floor((p.x - lo) / w))].push(p.y);
  const used = bins.map((ys, i) => ({ ys, i })).filter(b => b.ys.length);
  return {
    tooltip: { trigger: 'axis' },
    legend: {},
    xAxis: {
      type: 'category', name: x.name, axisLabel: { hideOverlap: true },
      data: used.map(b => num(lo + w * (b.i + 0.5))),
    },
    yAxis: { type: 'value', name: y.name, scale: true },
    series: [
      { type: 'line', name: '평균', data: used.map(b => num(b.ys.reduce((a, c) => a + c, 0) / b.ys.length)), z: 3 },
      { type: 'line', name: '최소', data: used.map(b => minOf(b.ys)), lineStyle: { type: 'dashed', opacity: 0.6 }, symbol: 'none' },
      { type: 'line', name: '최대', data: used.map(b => maxOf(b.ys)), lineStyle: { type: 'dashed', opacity: 0.6 }, symbol: 'none' },
    ],
  } as EChartsOption;
};

// ---- scatter3d ----

export const scatter3d: ChartBuilder = (spec, data, selected) => {
  const pts = xyzPoints(spec, data);
  if (!pts.length) return NO_VALUE;
  const { color } = spec;
  const field = color && 'name' in color ? color : undefined;
  const cv = (row: (typeof pts)[number]['row']) => (field ? fieldValue(row, field, data.objectives) : null);
  const cs = field ? pts.map(p => cv(p.row)).filter((c): c is number => c !== null) : [];
  const option: Opt = {
    tooltip: {},
    ...axes3d(spec),
    series: [{
      type: 'scatter3D', symbolSize: 6,
      data: pts.map(p => ({
        id: p.row.id, name: `#${p.row.index}`, value: [p.x, p.y, p.z, cv(p.row)],
        itemStyle: { opacity: itemOpacity(p.row.id, selected) },
      })),
    }],
  };
  if (field && cs.length) {
    option.visualMap = {
      type: 'continuous', dimension: 3, min: minOf(cs), max: maxOf(cs), inRange: { color: RAMP },
      text: [field.name, ''], right: 0, top: 'middle', calculable: false,
    };
  }
  return option as EChartsOption;
};

// ---- surface3d ----

export const surface3d: ChartBuilder = (spec, data) => {
  const pts = xyzPoints(spec, data);
  if (!pts.length) return NO_VALUE;
  const g = idwGrid(pts, GRID_N, GRID_N);
  const zs = pts.map(p => p.z);
  return {
    tooltip: {},
    ...axes3d(spec),
    visualMap: {
      type: 'continuous', dimension: 2, min: minOf(zs), max: maxOf(zs), inRange: { color: RAMP },
      text: [spec.z!.name, ''], right: 0, top: 'middle', calculable: false,
    },
    series: [{
      type: 'surface', data: g.z.flatMap((r, j) => r.map((zv, i) => [g.xs[i], g.ys[j], zv])),
      shading: 'color', wireframe: { show: false },
    }],
  } as EChartsOption;
};

export const SURFACE_BUILDERS = { contour, tornado, slice1d, scatter3d, surface3d } satisfies Record<string, ChartBuilder>;
