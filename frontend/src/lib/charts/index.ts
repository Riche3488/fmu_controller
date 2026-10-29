// 차트 빌더 레지스트리. 차트 종류별 빌더는 Task 16–19에서 등록한다.
//
// run id 계약: 선택 연동(클릭·브러시)이 되는 차트는 series.data의 각 항목을 객체로 두고
// `id`(권장) 또는 `name`에 run id를 넣는다. Panel이 click/brushselected 이벤트를 이 계약으로 run id에 되돌리고,
// 지금 데이터의 run id가 아닌 값(막대·박스·히트맵의 범주 이름 등)은 버린다. 그러니 범주 항목은 선택에 들어가지 않는다.
// 선택된 run 강조는 빌더가 `itemOpacity(runId, selected)`로 itemStyle.opacity를 정한다.
import type { EChartsOption } from 'echarts';
import type { Timeseries } from '../../api/types';
import type { ChartKind, PanelSpec, WorkbenchData } from '../workbench';
import { SCALAR_BUILDERS } from './scalar';
import { SURFACE_BUILDERS } from './surface';

export type { WorkbenchData } from '../workbench';

export type ChartResult = EChartsOption | { empty: string };
/** ts: 시계열 차트(needsTimeseries)일 때 run id → 시계열 */
export type ChartBuilder = (spec: PanelSpec, data: WorkbenchData, selected: string[], ts?: Record<string, Timeseries>) => ChartResult;

export { DIM_OPACITY, itemOpacity } from './common';

export const CHART_BUILDERS: Partial<Record<ChartKind, ChartBuilder>> = {
  ...SCALAR_BUILDERS,
  ...SURFACE_BUILDERS,
};

export function buildChart(spec: PanelSpec, data: WorkbenchData, selected: string[], ts?: Record<string, Timeseries>): ChartResult {
  const builder = Object.hasOwn(CHART_BUILDERS, spec.chart) ? CHART_BUILDERS[spec.chart] : undefined;
  return builder ? builder(spec, data, selected, ts) : { empty: '준비 중' };
}

export function isEmptyChart(r: ChartResult): r is { empty: string } {
  return typeof (r as { empty?: unknown }).empty === 'string';
}

function itemRunId(item: unknown): string | undefined {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) return undefined;
  const { id, name } = item as { id?: unknown; name?: unknown };
  return typeof id === 'string' ? id : typeof name === 'string' ? name : undefined;
}

/** click 이벤트 → run id */
export function runIdFromClick(e: { data?: unknown }): string | undefined {
  return itemRunId(e.data);
}

type BrushEvent = { batch?: { areas?: unknown[]; selected?: { seriesIndex: number; dataIndex: number[] }[] }[] };

/** brushselected 이벤트 → run id 목록. 브러시 영역이 없으면(지움·옵션 갱신) undefined. */
export function runIdsFromBrush(option: { series?: unknown }, e: BrushEvent): string[] | undefined {
  const b = e.batch?.[0];
  if (!b?.areas?.length) return undefined;
  const series = (Array.isArray(option.series) ? option.series : option.series ? [option.series] : []) as { data?: unknown[] }[];
  const ids = new Set<string>();
  for (const s of b.selected ?? []) {
    const data = series[s.seriesIndex]?.data ?? [];
    for (const i of s.dataIndex) {
      const id = itemRunId(data[i]);
      if (id) ids.add(id);
    }
  }
  return [...ids];
}
