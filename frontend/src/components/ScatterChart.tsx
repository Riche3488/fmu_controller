import ReactECharts from 'echarts-for-react';
import { useEchartsTheme } from '../theme';

export type ScatterPoint = { x: number; y: number; id: string; highlight?: boolean };

/** 산점도. highlight 점은 별도 시리즈("Pareto front" 등 highlightName)로 그린다. */
export function ScatterChart({ points, xLabel, yLabel, onPointClick, highlightName = '강조', testId = 'scatter-chart', selectedIds = [] }: {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  onPointClick?: (id: string) => void;
  highlightName?: string;
  testId?: string;
  selectedIds?: string[];
}) {
  const toData = (ps: ScatterPoint[]) => ps.map(p => ({ value: [p.x, p.y], id: p.id }));
  const selected = new Set(selectedIds);
  const option = {
    animation: false,
    tooltip: { trigger: 'item' },
    legend: { top: 0 },
    grid: { left: 60, right: 20, top: 30, bottom: 50 },
    xAxis: { type: 'value', name: xLabel, nameLocation: 'middle', nameGap: 30, scale: true },
    yAxis: { type: 'value', name: yLabel, scale: true },
    series: [
      { name: '전체', type: 'scatter', symbolSize: 7, data: toData(points.filter(p => !p.highlight)), itemStyle: { opacity: 0.6 } },
      { name: highlightName, type: 'scatter', symbolSize: 10, data: toData(points.filter(p => p.highlight)) },
      { name: '선택', type: 'scatter', symbolSize: 14, data: toData(points.filter(p => selected.has(p.id))),
        itemStyle: { color: 'transparent', borderColor: '#e8590c', borderWidth: 2 } },
    ],
  };
  const echartsTheme = useEchartsTheme();
  return (
    <ReactECharts theme={echartsTheme} data-testid={testId} option={option} notMerge style={{ height: 360 }}
      onEvents={{ click: (e: { data?: { id?: string } }) => e.data?.id && onPointClick?.(e.data.id) }} />
  );
}
