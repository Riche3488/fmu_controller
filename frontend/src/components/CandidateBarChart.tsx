import ReactECharts from 'echarts-for-react';
import { useEchartsTheme } from '../theme';
import type { Direction, ResourceFile, RunRow, Variant } from '../api/types';
import { candidateLabel } from './ResourceGroupSection';

/** 탐색 모드 resource 파일 하나에 대해, 탐색한 후보(candidateIds)별 성공 run의 평균·최적 목적값 */
export function CandidateBarChart({ rows, variants, file, candidateIds, objectiveId, direction }: {
  rows: RunRow[]; variants: Variant[]; file: ResourceFile; candidateIds: string[]; objectiveId: string;
  direction: Direction;
}) {
  const originalId = file.candidates[0].id;
  const byVariant = new Map(variants.map(v => [v.id, v.assignment[file.path] ?? originalId]));
  const searched = new Set(candidateIds);
  const used = file.candidates.filter(c => searched.has(c.id));
  const values = new Map<string, number[]>(used.map(c => [c.id, []]));
  for (const r of rows) {
    const v = r.objectives[objectiveId]?.value;
    const cid = byVariant.get(r.variantId);
    if (r.status !== 'ok' || v === null || v === undefined || !cid) continue;
    values.get(cid)?.push(v);
  }
  const stat = (f: (xs: number[]) => number) => used.map(c => {
    const xs = values.get(c.id)!;
    return xs.length ? f(xs) : null;
  });
  const option = {
    animation: false,
    tooltip: { trigger: 'axis' },
    legend: { top: 0 },
    grid: { left: 60, right: 20, top: 30, bottom: 40 },
    xAxis: { type: 'category', data: used.map(candidateLabel) },
    yAxis: { type: 'value', scale: true },
    series: [
      { name: '평균', type: 'bar', data: stat(xs => xs.reduce((a, b) => a + b, 0) / xs.length) },
      { name: '최적', type: 'bar', data: stat(xs => (direction === 'minimize' ? Math.min(...xs) : Math.max(...xs))) },
    ],
  };
  const echartsTheme = useEchartsTheme();
  return <ReactECharts theme={echartsTheme} data-testid={`candidate-bar-${file.path}`} option={option} notMerge style={{ height: 260 }} />;
}
