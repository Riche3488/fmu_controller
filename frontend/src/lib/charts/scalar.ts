// run 단위 차트 8종: 산점도·산점도 행렬·평행좌표·히스토그램·박스/바이올린·상관 히트맵·레이더·막대
import type { EChartsOption } from 'echarts';
import type { RunRow } from '../../api/types';
import { boxStats } from '../stats';
import { corrMatrix, histogram, kde } from '../vizStats';
import type { FieldRef, GroupRef, PanelSpec, WorkbenchData } from '../workbench';
import { completeRows, itemOpacity, maxOf, minOf, num } from './common';
import { fieldValue } from './fields';
import type { ChartBuilder, ChartResult } from './index';

const NO_VALUE: ChartResult = { empty: '값 없음' };
const MAX_MATRIX = 6;
const MAX_RADAR = 8;
const PALETTE = ['#5470c6', '#ee6666', '#91cc75', '#fac858', '#73c0de', '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc'];
const RAMP: [string, string] = ['#3b82f6', '#f97316'];

type Opt = Record<string, unknown>;
type CustomApi = {
  value: (i: number) => unknown; coord: (p: number[]) => number[]; size: (p: number[]) => number[]; style: (o: Opt) => Opt;
};
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function hexToRgb(h: string): number[] {
  return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
}
/** t(0..1)에 해당하는 색 (파랑→주황 선형 보간) */
function ramp(t: number): string {
  const [a, b] = [hexToRgb(RAMP[0]), hexToRgb(RAMP[1])];
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * Math.min(1, Math.max(0, t))));
  return `rgb(${c.join(',')})`;
}

const isGroupRef = (c: FieldRef | GroupRef | undefined): c is GroupRef => c?.kind === 'job' || c?.kind === 'variant';
const isFieldRef = (c: FieldRef | GroupRef | undefined): c is FieldRef => c?.kind === 'param' || c?.kind === 'objective';

function groupKey(row: RunRow, by: 'job' | 'variant'): string {
  return by === 'job' ? row.jobId : row.variantId;
}
function groupLabel(key: string, by: 'job' | 'variant', data: WorkbenchData): string {
  return (by === 'job' ? data.jobs.find(j => j.id === key)?.name : data.variants.find(v => v.id === key)?.label) ?? key;
}

/** 색 필드(값 → 램프) 또는 그룹(→ 팔레트)에 따른 행 색. 색 지정이 없으면 undefined. */
function colorFn(spec: PanelSpec, data: WorkbenchData): ((row: RunRow) => string | undefined) | undefined {
  const c = spec.color;
  if (isGroupRef(c)) {
    const keys = [...new Set(data.rows.map(r => groupKey(r, c.kind)))];
    return row => PALETTE[keys.indexOf(groupKey(row, c.kind)) % PALETTE.length];
  }
  if (isFieldRef(c)) {
    const vals = data.rows.map(r => fieldValue(r, c, data.objectives)).filter((x): x is number => x !== null);
    if (!vals.length) return undefined;
    const [lo, hi] = [minOf(vals), maxOf(vals)];
    return row => {
      const v = fieldValue(row, c, data.objectives);
      return v === null ? undefined : ramp(hi === lo ? 0.5 : (v - lo) / (hi - lo));
    };
  }
  return undefined;
}

// ---- scatter ----

export const scatter: ChartBuilder = (spec, data, selected) => {
  const { x, y } = spec;
  if (!x || !y) return NO_VALUE;
  const size = spec.size;
  const pts = data.rows.flatMap(row => {
    const xv = fieldValue(row, x, data.objectives), yv = fieldValue(row, y, data.objectives);
    if (xv === null || yv === null) return [];
    return [{
      row, xv, yv,
      c: isFieldRef(spec.color) ? fieldValue(row, spec.color, data.objectives) : null,
      s: size ? fieldValue(row, size, data.objectives) : null,
    }];
  });
  if (!pts.length) return NO_VALUE;

  const sizes = pts.map(p => p.s).filter((s): s is number => s !== null);
  const [sLo, sHi] = [minOf(sizes), maxOf(sizes)];
  const symbolSize = (s: number | null) => (s === null || !sizes.length ? 8 : sHi === sLo ? 12 : 6 + ((s - sLo) / (sHi - sLo)) * 16);
  const item = (p: (typeof pts)[number], color?: string) => ({
    id: p.row.id, name: `#${p.row.index}`, value: [p.xv, p.yv, p.c, p.s],
    symbolSize: symbolSize(p.s), itemStyle: { opacity: itemOpacity(p.row.id, selected), ...(color ? { color } : {}) },
  });

  const option: Opt = {
    tooltip: { trigger: 'item' },
    brush: { toolbox: ['rect', 'clear'], xAxisIndex: 0, yAxisIndex: 0 },
    xAxis: { type: 'value', name: x.name, scale: true },
    yAxis: { type: 'value', name: y.name, scale: true },
  };
  const group = isGroupRef(spec.color) ? spec.color.kind : undefined;
  if (group) {
    const keys = [...new Set(pts.map(p => groupKey(p.row, group)))];
    option.legend = {};
    option.series = keys.map((k, i) => ({
      type: 'scatter', name: groupLabel(k, group, data),
      data: pts.filter(p => groupKey(p.row, group) === k).map(p => item(p, PALETTE[i % PALETTE.length])),
    }));
  } else {
    option.series = [{ type: 'scatter', data: pts.map(p => item(p)) }];
    const cs = pts.map(p => p.c).filter((c): c is number => c !== null);
    if (isFieldRef(spec.color) && cs.length) {
      option.visualMap = {
        type: 'continuous', dimension: 2, min: minOf(cs), max: maxOf(cs), inRange: { color: RAMP },
        text: [spec.color.name, ''], right: 0, top: 'middle', calculable: false,
      };
    }
  }
  return option as EChartsOption;
};

// ---- scatterMatrix ----

export const scatterMatrix: ChartBuilder = (spec, data, selected) => {
  const fields = (spec.fields ?? []).slice(0, MAX_MATRIX);
  if (!fields.length) return NO_VALUE;
  const rows = completeRows(data, fields);
  if (!rows.length) return NO_VALUE;
  const n = fields.length;
  const colorOf = colorFn(spec, data);
  const left = 8, top = 4, right = 2, bottom = 8, gap = 1.5;   // 퍼센트
  const cw = (100 - left - right - gap * (n - 1)) / n, ch = (100 - top - bottom - gap * (n - 1)) / n;

  const grid: Opt[] = [], xAxis: Opt[] = [], yAxis: Opt[] = [], series: Opt[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const k = i * n + j;   // 행 i = y 필드, 열 j = x 필드
      grid.push({ left: `${left + j * (cw + gap)}%`, top: `${top + i * (ch + gap)}%`, width: `${cw}%`, height: `${ch}%` });
      const edgeX = i === n - 1, edgeY = j === 0;
      xAxis.push({
        type: 'value', gridIndex: k, scale: true, name: edgeX ? fields[j].name : '', nameLocation: 'middle', nameGap: 22,
        axisLabel: { show: edgeX }, splitLine: { show: false },
      });
      yAxis.push({
        type: 'value', gridIndex: k, scale: true, name: edgeY ? fields[i].name : '', nameLocation: 'middle', nameGap: 34,
        axisLabel: { show: edgeY }, splitLine: { show: false },
      });
      series.push({
        type: 'scatter', xAxisIndex: k, yAxisIndex: k, symbolSize: 4,
        data: rows.map(({ row, v }) => {
          const color = colorOf?.(row);
          return {
            id: row.id, name: `#${row.index}`, value: [v[j], v[i]],
            itemStyle: { opacity: itemOpacity(row.id, selected), ...(color ? { color } : {}) },
          };
        }),
      });
    }
  }
  return { tooltip: { trigger: 'item' }, grid, xAxis, yAxis, series } as EChartsOption;
};

// ---- parallel ----

export const parallel: ChartBuilder = (spec, data, selected) => {
  const fields = spec.fields ?? [];
  if (!fields.length) return NO_VALUE;
  const rows = completeRows(data, fields);
  if (!rows.length) return NO_VALUE;
  const colorOf = colorFn(spec, data);
  return {
    tooltip: {},
    parallelAxis: fields.map((f, dim) => ({ dim, name: f.name })),
    parallel: { left: 50, right: 50 },
    series: [{
      type: 'parallel', lineStyle: { width: 1.5 },
      data: rows.map(({ row, v }) => {
        const color = colorOf?.(row);
        return {
          id: row.id, name: `#${row.index}`, value: v,
          lineStyle: { opacity: itemOpacity(row.id, selected), ...(color ? { color } : {}) },
        };
      }),
    }],
  } as EChartsOption;
};

// ---- histogram ----

export const histogramChart: ChartBuilder = (spec, data, selected) => {
  const { x } = spec;
  if (!x) return NO_VALUE;
  const all = data.rows.flatMap(r => {
    const v = fieldValue(r, x, data.objectives);
    return v === null ? [] : [{ id: r.id, v }];
  });
  if (!all.length) return NO_VALUE;
  const { edges, counts } = histogram(all.map(a => a.v));
  const k = counts.length;
  const w = edges[1] - edges[0];
  const binOf = (v: number) => Math.min(k - 1, Math.max(0, Math.floor((v - edges[0]) / w)));
  const series: Opt[] = [{ type: 'bar', name: '전체', data: counts, barCategoryGap: '5%' }];
  if (selected.length) {
    const sel = new Array<number>(k).fill(0);
    for (const a of all) if (selected.includes(a.id)) sel[binOf(a.v)] += 1;
    series.push({ type: 'bar', name: '선택', data: sel, barGap: '-100%', z: 3, itemStyle: { color: '#ee6666' } });
  }
  return {
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category', name: x.name, axisLabel: { hideOverlap: true },
      data: counts.map((_, i) => `${num(edges[i])}~${num(edges[i + 1])}`),
    },
    yAxis: { type: 'value', name: '개수', minInterval: 1 },
    series,
  } as EChartsOption;
};

// ---- boxViolin / bar 공용: 그룹별 값 ----

function groupValues(spec: PanelSpec, data: WorkbenchData, ref: FieldRef): { label: string; values: number[] }[] {
  const by = spec.groupBy;
  const map = new Map<string, number[]>();
  for (const r of data.rows) {
    const v = fieldValue(r, ref, data.objectives);
    if (v === null) continue;
    const key = by ? groupKey(r, by) : '';
    map.set(key, [...(map.get(key) ?? []), v]);
  }
  return [...map.entries()]
    .map(([k, values]) => ({ label: by ? groupLabel(k, by, data) : '전체', values }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

const VIOLIN_POINTS = 40;

export const boxViolin: ChartBuilder = (spec, data) => {
  const { y } = spec;
  if (!y) return NO_VALUE;
  const groups = groupValues(spec, data, y);
  if (!groups.length) return NO_VALUE;
  const series: Opt[] = [];
  if (spec.violin) {
    // ECharts는 data 차원을 숫자로만 다루므로 data에는 [범주 인덱스, 최소, 최대]만 두고 곡선은 클로저에 보관한다
    const curves: number[][][] = [];
    const extents = groups.map((g, i) => {
      const [lo, hi] = [minOf(g.values), maxOf(g.values)];
      const at = Array.from({ length: VIOLIN_POINTS }, (_, t) => (hi === lo ? lo : lo + ((hi - lo) * t) / (VIOLIN_POINTS - 1)));
      const d = kde(g.values, at);
      const dmax = maxOf(d) || 1;
      curves.push(at.map((yy, t) => [yy, d[t] / dmax]));
      return [i, lo, hi];
    });
    series.push({
      type: 'custom', name: '분포', data: extents, encode: { x: 0, y: [1, 2] }, z: 1, silent: true,
      renderItem: (params: { dataIndex: number }, api: CustomApi) => {
        const i = api.value(0) as number;
        const pts = curves[params.dataIndex];
        const half = api.size([1, 0])[0] * 0.4;
        const c = api.coord([i, 0])[0];
        const left = pts.map(([yy, d]) => [c - d * half, api.coord([i, yy])[1]]);
        const right = pts.map(([yy, d]) => [c + d * half, api.coord([i, yy])[1]]).reverse();
        return { type: 'polygon', shape: { points: [...left, ...right] }, style: api.style({ opacity: 0.35 }) };
      },
    });
  }
  series.push({ type: 'boxplot', name: '박스', z: 2, data: groups.map(g => boxStats(g.values)) });
  return {
    tooltip: { trigger: 'item' },
    xAxis: { type: 'category', data: groups.map(g => g.label) },
    yAxis: { type: 'value', name: y.name, scale: true },
    series,
  } as EChartsOption;
};

// ---- corrHeatmap ----

export const corrHeatmap: ChartBuilder = (spec, data) => {
  const fields = spec.fields ?? [];
  if (!fields.length) return NO_VALUE;
  // 같은 이름의 파라미터·목적함수가 섞여도 겹치지 않게 인덱스를 키로 쓴다
  const cols: Record<string, (number | null)[]> = {};
  fields.forEach((f, i) => { cols[String(i)] = data.rows.map(r => fieldValue(r, f, data.objectives)); });
  const { m } = corrMatrix(cols, spec.method ?? 'pearson');
  if (m.every(r => r.every(c => c === null))) return NO_VALUE;
  const labels = fields.map(f => f.name);
  const cells = m.flatMap((r, i) => r.map((v, j) => ({ value: [j, i, v === null ? '-' : num(v)] })));
  return {
    tooltip: { position: 'top' },
    grid: { left: 90, right: 60, top: 20, bottom: 60 },
    xAxis: { type: 'category', data: labels, splitArea: { show: true } },
    yAxis: { type: 'category', data: labels, inverse: true, splitArea: { show: true } },
    visualMap: {
      min: -1, max: 1, calculable: true, orient: 'horizontal', left: 'center', bottom: 0,
      inRange: { color: ['#3b82f6', '#f5f5f5', '#ef4444'] },
    },
    series: [{
      type: 'heatmap', data: cells,
      label: { show: true, formatter: (p: { value: unknown[] }) => (typeof p.value[2] === 'number' ? p.value[2].toFixed(2) : '') },
    }],
  } as EChartsOption;
};

// ---- radar ----

export const radar: ChartBuilder = (spec, data, selected) => {
  const ids = selected.filter(id => data.rows.some(r => r.id === id)).slice(0, MAX_RADAR);
  if (!ids.length) return { empty: '비교할 run을 선택하세요' };
  const fields = spec.fields ?? [];
  if (!fields.length) return NO_VALUE;
  // 정규화 범위는 전체 run 기준 (선택이 바뀌어도 축 눈금이 같게)
  const range = fields.map(f => {
    const vs = data.rows.map(r => fieldValue(r, f, data.objectives)).filter((v): v is number => v !== null);
    return [minOf(vs), maxOf(vs)] as const;
  });
  const items = ids.flatMap(id => {
    const row = data.rows.find(r => r.id === id)!;
    const v = fields.map(f => fieldValue(row, f, data.objectives));
    if (!v.every((x): x is number => x !== null)) return [];
    const value = v.map((x, i) => (range[i][1] === range[i][0] ? 0.5 : (x - range[i][0]) / (range[i][1] - range[i][0])));
    return [{ id, name: `#${row.index}`, value }];
  });
  if (!items.length) return NO_VALUE;
  return {
    tooltip: {},
    legend: { data: items.map(i => i.name) },
    radar: { indicator: fields.map(f => ({ name: f.name, min: 0, max: 1 })) },
    series: [{ type: 'radar', data: items }],
  } as EChartsOption;
};

// ---- bar ----

export const bar: ChartBuilder = (spec, data) => {
  const { y } = spec;
  if (!y) return NO_VALUE;
  const groups = groupValues(spec, data, y);
  if (!groups.length) return NO_VALUE;
  const stats = groups.map(g => {
    const mean = sum(g.values) / g.values.length;
    const std = g.values.length > 1 ? Math.sqrt(sum(g.values.map(v => (v - mean) ** 2)) / (g.values.length - 1)) : 0;
    return { mean, std };
  });
  return {
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: groups.map(g => g.label) },
    yAxis: { type: 'value', name: y.name, scale: true },
    series: [
      { type: 'bar', name: '평균', data: stats.map(s => s.mean) },
      {
        // 항목 = [범주 인덱스, 평균-표준편차, 평균+표준편차]: 세로선+캡으로 그리고 y 범위에 반영한다
        type: 'custom', name: '±표준편차', z: 3, silent: true, encode: { x: 0, y: [1, 2] },
        data: stats.map((s, i) => [i, s.mean - s.std, s.mean + s.std]),
        renderItem: (_: unknown, api: CustomApi) => {
          const i = api.value(0) as number, lo = api.value(1) as number, hi = api.value(2) as number;
          const [x, top] = api.coord([i, hi]);
          const bottom = api.coord([i, lo])[1];
          const cap = Math.min(api.size([1, 0])[0] * 0.15, 12);
          const style = { stroke: '#333', lineWidth: 1.5 };
          return {
            type: 'group',
            children: [
              { type: 'line', shape: { x1: x, y1: top, x2: x, y2: bottom }, style },
              { type: 'line', shape: { x1: x - cap, y1: top, x2: x + cap, y2: top }, style },
              { type: 'line', shape: { x1: x - cap, y1: bottom, x2: x + cap, y2: bottom }, style },
            ],
          };
        },
      },
    ],
  } as EChartsOption;
};

export const SCALAR_BUILDERS = {
  scatter, scatterMatrix, parallel, histogram: histogramChart, boxViolin, corrHeatmap, radar, bar,
} satisfies Record<string, ChartBuilder>;
