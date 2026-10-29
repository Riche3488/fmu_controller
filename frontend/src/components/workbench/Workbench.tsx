// 차트 작업대: 패널 격자 + 툴바(레이아웃·줌 동기화·패널 추가·레이아웃 프리셋) + 선택 연동
import { Alert, Badge, Button, Group, Menu, Modal, SegmentedControl, SimpleGrid, Stack, Switch } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import * as echarts from 'echarts';
import { useContext, useEffect, useId, useMemo, useState } from 'react';
import { useApi } from '../../api/client';
import type { DashboardLayout } from '../../api/types';
import {
  CHART_GROUPS, CHART_LABELS, dashboardFromConfig, defaultDashboard, LAYOUTS, layoutDims, newPanel, parsePanels,
  type DashboardState, type PanelSpec,
} from '../../lib/workbench';
import { usePresetEditor } from '../usePresetEditor';
import { Panel } from './Panel';
import { PanelEditor } from './PanelEditor';
import { SelectionContext, SelectionProvider, useSelection } from './SelectionContext';
import { useWorkbenchData, type WorkbenchFilter } from './useWorkbenchData';

const NO_TRANSITION = { transitionProps: { duration: 0 } };
const noop = () => {};

function initialState(): DashboardState {
  const d = defaultDashboard();
  return { ...d, panels: parsePanels(d.panels) };
}

function panelHeight(rows: number): number {
  return rows === 1 ? 420 : rows === 2 ? 300 : 240;
}

/** 결과 표와 선택을 공유하려면 바깥에서 SelectionProvider로 감싼다. 없으면 자체 선택을 쓴다. */
export function Workbench(props: { fmuId: string; filter: WorkbenchFilter }) {
  const outer = useContext(SelectionContext);
  return outer ? <WorkbenchInner {...props} /> : <SelectionProvider><WorkbenchInner {...props} /></SelectionProvider>;
}

function WorkbenchInner({ fmuId, filter }: { fmuId: string; filter: WorkbenchFilter }) {
  const api = useApi();
  const fmu = useQuery({ queryKey: ['fmu', fmuId], queryFn: () => api.getFmu(fmuId) });
  const { isLoading: dataLoading, error, ...data } = useWorkbenchData(fmuId, filter);
  // 조회가 실패하면 패널이 끝없이 돌지 않게 로딩을 끝낸다 (오류는 위에 따로 보여 준다)
  const isLoading = dataLoading && !error;
  // 패널 useMemo가 매 렌더 다시 계산하지 않게 데이터 객체를 고정한다
  const stableData = useMemo(() => data, [data.rows, data.objectives, data.params, data.vars, data.jobs, data.variants]); // eslint-disable-line react-hooks/exhaustive-deps
  const { selected, set } = useSelection();
  const [dash, setDash] = useState<DashboardState>(initialState);
  const [editing, setEditing] = useState<string | null>(null);
  const [maximized, setMaximized] = useState<string | null>(null);

  const syncGroup = `fmuc-ts-${useId()}`;
  useEffect(() => {
    echarts.connect(syncGroup);
    return () => echarts.disconnect(syncGroup);
  }, [syncGroup]);

  const ctx = { params: stableData.params, objectives: stableData.objectives.map(o => o.name), vars: stableData.vars };
  const preset = usePresetEditor({
    kind: 'dashboard', fmuId, modelName: fmu.data?.modelName ?? '', form: dash, ready: !isLoading,
    toConfig: d => ({ layout: d.layout, syncTimeZoom: d.syncTimeZoom, panels: d.panels }),
    fromConfig: cfg => {
      const { state, warnings } = dashboardFromConfig(cfg, ctx);
      return { form: state, warnings };
    },
    defaultForm: initialState, setForm: setDash, name: '', setName: noop, menuLabel: '레이아웃 저장', sticky: false,
  });

  const update = (fn: (d: DashboardState) => DashboardState) => setDash(fn);
  const updatePanel = (p: PanelSpec) => update(d => ({ ...d, panels: d.panels.map(x => (x.id === p.id ? p : x)) }));
  const removePanel = (id: string) => update(d => ({ ...d, panels: d.panels.filter(x => x.id !== id) }));
  const dims = layoutDims(dash.layout);
  const editingSpec = dash.panels.find(p => p.id === editing) ?? null;
  const maxSpec = dash.panels.find(p => p.id === maximized) ?? null;
  const group = dash.syncTimeZoom ? syncGroup : undefined;

  const panelProps = (p: PanelSpec) => ({
    spec: p, data: stableData, loading: isLoading, syncGroup: group,
    onEdit: () => setEditing(p.id), onRemove: () => removePanel(p.id),
  });

  return (
    <Stack gap="xs" data-testid="workbench">
      <Group gap="xs" wrap="wrap">
        {preset.menuBar}
        <SegmentedControl size="xs" value={dash.layout} data={LAYOUTS} transitionDuration={0}
          onChange={v => update(d => ({ ...d, layout: v as DashboardLayout }))} aria-label="레이아웃" />
        <Switch size="xs" label="시간축 줌 동기화" checked={dash.syncTimeZoom}
          onChange={e => { const on = e.currentTarget.checked; update(d => ({ ...d, syncTimeZoom: on })); }} />
        <Menu position="bottom-start" shadow="md" width={220} {...NO_TRANSITION}>
          <Menu.Target><Button size="compact-sm" variant="light">패널 추가</Button></Menu.Target>
          <Menu.Dropdown mah={480} style={{ overflowY: 'auto' }}>
            {CHART_GROUPS.map((g, i) => (
              <div key={g.label}>
                {i > 0 && <Menu.Divider />}
                <Menu.Label>{g.label}</Menu.Label>
                {g.charts.map(c => (
                  <Menu.Item key={c} onClick={() => update(d => ({ ...d, panels: [...d.panels, newPanel(c)] }))}>{CHART_LABELS[c]}</Menu.Item>
                ))}
              </div>
            ))}
          </Menu.Dropdown>
        </Menu>
        {selected.length > 0 && (
          <Group gap={4}>
            <Badge variant="light" tt="none">선택 {selected.length}개</Badge>
            <Button size="compact-xs" variant="subtle" onClick={() => set([])}>선택 해제</Button>
          </Group>
        )}
      </Group>
      {error && <Alert color="red" title="결과 데이터를 불러오지 못했습니다" data-testid="workbench-error">{error.message}</Alert>}
      {preset.notice}

      <SimpleGrid cols={dims.cols} spacing="xs" data-testid="workbench-grid" data-cols={dims.cols}>
        {dash.panels.map(p => (
          <Panel key={p.id} {...panelProps(p)} height={panelHeight(dims.rows)} onMaximize={() => setMaximized(p.id)} />
        ))}
      </SimpleGrid>

      <PanelEditor spec={editingSpec} data={stableData} onChange={updatePanel} onClose={() => setEditing(null)} />
      <Modal opened={!!maxSpec} onClose={() => setMaximized(null)} fullScreen title={maxSpec?.title} {...NO_TRANSITION}>
        {maxSpec && <Panel {...panelProps(maxSpec)} height="calc(100vh - 140px)" />}
      </Modal>
      {preset.modals}
    </Stack>
  );
}
