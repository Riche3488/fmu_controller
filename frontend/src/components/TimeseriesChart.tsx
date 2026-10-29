import { Text } from '@mantine/core';
import { useQueries } from '@tanstack/react-query';
import ReactECharts from 'echarts-for-react';
import { useEchartsTheme } from '../theme';
import { useApi } from '../api/client';

const MAX_POINTS = 2000;

/** 여러 run × 변수의 시계열 오버레이 */
export function TimeseriesChart({ runs, vars }: { runs: { runId: string; label: string }[]; vars: string[] }) {
  const api = useApi();
  const results = useQueries({
    queries: runs.map(r => ({
      queryKey: ['timeseries', r.runId, vars],
      queryFn: () => api.getTimeseries(r.runId, vars, MAX_POINTS),
      enabled: vars.length > 0,
    })),
  });
  const echartsTheme = useEchartsTheme();
  if (runs.length === 0 || vars.length === 0) return <Text size="sm" c="dimmed">run과 변수를 선택하세요</Text>;
  const error = results.find(r => r.isError)?.error as Error | undefined;
  if (error) return <Text size="sm" c="red">{error.message}</Text>;

  const series = runs.flatMap((r, i) => {
    const ts = results[i].data;
    if (!ts) return [];
    return vars.map(v => ({
      name: vars.length > 1 ? `${r.label} · ${v}` : r.label,
      type: 'line', showSymbol: false, sampling: 'lttb',
      data: ts.time.map((t, k) => [t, ts.series[v]?.[k] ?? null]),
    }));
  });
  const option = {
    animation: false,
    tooltip: { trigger: 'axis' },
    legend: { type: 'scroll', top: 0 },
    grid: { left: 60, right: 20, top: 40, bottom: 60 },
    dataZoom: [{ type: 'inside' }, { type: 'slider' }],
    xAxis: { type: 'value', name: 'time [s]', nameLocation: 'middle', nameGap: 25 },
    yAxis: { type: 'value', scale: true },
    series,
  };
  return <ReactECharts theme={echartsTheme} data-testid="timeseries-chart" option={option} notMerge style={{ height: 380 }} />;
}
