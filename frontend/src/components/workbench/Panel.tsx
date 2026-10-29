// 작업대 패널 하나: 헤더(제목·메뉴) + 차트. 클릭/브러시로 run 선택, 시계열 차트는 선택 run을 받아 온다.
import { ActionIcon, Center, Group, Loader, Menu, Paper, Text } from '@mantine/core';
import type { EChartsType } from 'echarts';
import ReactECharts from 'echarts-for-react';
import { useEffect, useMemo, useRef } from 'react';
import { buildChart, isEmptyChart, runIdFromClick, runIdsFromBrush, type ChartResult } from '../../lib/charts';
import {
  CHART_LABELS, missingRefs, needsTimeseries, timeseriesRunIds, type PanelSpec, type WorkbenchData,
} from '../../lib/workbench';
import { panelCsv } from '../../lib/workbenchCsv';
import { useEchartsTheme } from '../../theme';
import { useSelection } from './SelectionContext';
import { useTimeseriesData } from './useTimeseriesData';

const PNG_BG = { 'fmuc-dark': '#161b22', 'fmuc-light': '#ffffff' } as const;
const NO_TRANSITION = { transitionProps: { duration: 0 } };

function download(name: string, url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
}

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|\s]+/g, '_') || 'panel';
}

export function Panel({ spec, data, loading = false, onEdit, onRemove, onMaximize, syncGroup, height = 300 }: {
  spec: PanelSpec;
  data: WorkbenchData;
  loading?: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onMaximize?: () => void;
  /** 시간축 줌 동기화 echarts group (시계열 패널만 사용) */
  syncGroup?: string;
  height?: number | string;
}) {
  const { selected, set, toggle } = useSelection();
  const echartsTheme = useEchartsTheme();
  const chartRef = useRef<ReactECharts>(null);
  const isTs = needsTimeseries(spec.chart);
  const tsRunIds = useMemo(() => timeseriesRunIds(spec, data, selected), [spec, data, selected]);
  const missing = useMemo(() => missingRefs(spec, {
    params: data.params, objectives: data.objectives.map(o => o.name), vars: data.vars,
  }), [spec, data]);
  // 찾을 수 없는 변수가 있으면 시계열을 받지 않는다 (어차피 그리지 않음)
  const ts = useTimeseriesData(tsRunIds, isTs && !missing.length ? spec.vars ?? [] : []);
  const runIdSet = useMemo(() => new Set(data.rows.map(r => r.id)), [data.rows]);
  const result: ChartResult = useMemo(
    () => buildChart(spec, data, selected, isTs ? ts.data : undefined),
    // ts.data는 매 렌더 새 객체라 실제 내용(로딩 끝난 run 수)으로 비교한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spec, data, selected, isTs, Object.keys(ts.data).join(',')],
  );

  // echarts-for-react는 onEvents 객체가 바뀌면 차트를 다시 만든다 → 한 번만 만들고 최신 값은 ref로 읽는다
  const latest = useRef({ result, set, toggle, runIdSet });
  latest.current = { result, set, toggle, runIdSet };
  const onEvents = useMemo(() => ({
    click: (e: { data?: unknown }) => {
      const id = runIdFromClick(e);
      if (id && latest.current.runIdSet.has(id)) latest.current.toggle(id);
    },
    brushselected: (e: Parameters<typeof runIdsFromBrush>[1]) => {
      const r = latest.current.result;
      const raw = isEmptyChart(r) ? undefined : runIdsFromBrush(r as { series?: unknown }, e);
      if (!raw) return;
      const ids = raw.filter(id => latest.current.runIdSet.has(id));
      // 범주 항목만 잡혔으면 선택을 건드리지 않는다
      if (ids.length || !raw.length) latest.current.set(ids);
    },
  }), []);

  const group = isTs ? syncGroup ?? '' : '';
  const applyGroup = (inst: EChartsType) => {
    // echarts.connect(group)는 Workbench가 한 번 부른다. 그룹을 비우면 연결에서 빠진다.
    inst.group = group;
  };
  useEffect(() => {
    const inst = chartRef.current?.getEchartsInstance();
    if (inst) inst.group = group;
  }, [group]);

  const exportPng = () => {
    const inst = chartRef.current?.getEchartsInstance();
    if (inst) download(`${safeName(spec.title)}.png`, inst.getDataURL({ pixelRatio: 2, backgroundColor: PNG_BG[echartsTheme] }));
  };
  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([panelCsv(spec, data, isTs ? tsRunIds : undefined)], { type: 'text/csv;charset=utf-8' }));
    download(`${safeName(spec.title)}.csv`, url);
    URL.revokeObjectURL(url);
  };

  let body;
  if (loading || (isTs && ts.isLoading)) body = <Center h="100%"><Loader size="sm" /></Center>;
  else if (missing.length) body = <Center h="100%"><Text size="sm" c="orange" data-testid="panel-missing">찾을 수 없음: {missing.join(', ')}</Text></Center>;
  else if (isTs && ts.error) body = <Center h="100%"><Text size="sm" c="red">{ts.error.message}</Text></Center>;
  else if (isEmptyChart(result)) body = <Center h="100%"><Text size="sm" c="dimmed" data-testid="panel-empty">{result.empty}</Text></Center>;
  else {
    body = (
      <ReactECharts ref={chartRef} theme={echartsTheme} option={result} notMerge onEvents={onEvents} onChartReady={applyGroup}
        data-testid="panel-chart" style={{ height: '100%', width: '100%' }} />
    );
  }

  return (
    <Paper withBorder p="xs" data-testid="workbench-panel" data-panel-id={spec.id} style={{ display: 'flex', flexDirection: 'column' }}>
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Text size="sm" fw={500} truncate title={`${spec.title} · ${CHART_LABELS[spec.chart]}`} data-testid="panel-title">{spec.title}</Text>
        <Menu position="bottom-end" shadow="md" {...NO_TRANSITION}>
          <Menu.Target>
            <ActionIcon variant="subtle" size="sm" aria-label={`${spec.title} 패널 메뉴`}>⋯</ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item onClick={onEdit}>편집…</Menu.Item>
            {onMaximize && <Menu.Item onClick={onMaximize}>최대화</Menu.Item>}
            <Menu.Divider />
            <Menu.Item onClick={exportPng} disabled={isEmptyChart(result) || missing.length > 0}>PNG 내보내기</Menu.Item>
            <Menu.Item onClick={exportCsv}>CSV 내보내기</Menu.Item>
            <Menu.Divider />
            <Menu.Item color="red" onClick={onRemove}>삭제</Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
      <div style={{ height, minHeight: 0 }}>{body}</div>
    </Paper>
  );
}
