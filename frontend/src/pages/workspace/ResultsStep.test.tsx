import { describe, expect, test } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockClient, MOCK_FMU_ID } from '../../api/mock/mockClient';
import { finishedBatch } from '../../test/fixtures';
import { renderApp } from '../../test/render';

const ROUTE = `/fmus/${MOCK_FMU_ID}/results`;
const V = 'controlBus.chassisBus.longitudinalVelocity';
const panels = () => screen.getAllByTestId('workbench-panel');
const titles = () => screen.getAllByTestId('panel-title').map(t => t.textContent);

describe('ResultsStep', () => {
  test('기본 탭은 작업대, 기본 네 패널', async () => {
    renderApp({ route: ROUTE, client: createMockClient({ tickMs: 5 }) });
    expect(await screen.findByRole('tab', { name: '작업대', selected: true })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '결과 표' })).toBeInTheDocument();
    await waitFor(() => expect(titles()).toEqual(['산점도', '평행좌표', '시계열 subplot', '상관 히트맵']));
  });

  test('?dashboard=로 들어오면 그 프리셋을 불러오고, 결과 표 체크가 작업대 시계열에 반영된다', async () => {
    const client = createMockClient({ tickMs: 5 });
    const job = await finishedBatch(client, { name: 'sweep' });
    const rows = (await client.listRuns({ jobIds: [job.id] })).items;
    const preset = await client.createPreset({
      name: '속도 보기', kind: 'dashboard', sourceFmuId: MOCK_FMU_ID,
      config: { layout: '1x1', syncTimeZoom: true, panels: [{ id: 'a', title: '속도', chart: 'tsOverlay', vars: [V] }] },
    });
    renderApp({ route: `${ROUTE}?dashboard=${preset.id}`, client });
    await waitFor(() => expect(titles()).toEqual(['속도']));
    expect(await screen.findByTestId('load-notice')).toHaveTextContent("프리셋 '속도 보기'을(를) 불러왔습니다");

    await userEvent.click(screen.getByRole('tab', { name: '결과 표' }));
    const target = rows[2];
    await userEvent.click(await screen.findByRole('checkbox', { name: `run ${target.index} 선택` }));

    await userEvent.click(screen.getByRole('tab', { name: '작업대' }));
    expect(screen.getByText('선택 1개')).toBeInTheDocument();
    await waitFor(() => {
      const opt = JSON.parse(within(panels()[0]).getByTestId('panel-chart').getAttribute('data-option')!);
      expect(opt.series.map((s: { name: string }) => s.name)).toEqual([`sweep #${target.index}`]);
    });

    // 작업대에서 해제하면 결과 표 체크도 풀린다
    await userEvent.click(screen.getByRole('button', { name: '선택 해제' }));
    await userEvent.click(screen.getByRole('tab', { name: '결과 표' }));
    expect(await screen.findByRole('checkbox', { name: `run ${target.index} 선택` })).not.toBeChecked();
  });

  test('레이아웃 저장 → 대시보드 프리셋으로 저장된다', async () => {
    const client = createMockClient({ tickMs: 5 });
    renderApp({ route: ROUTE, client });
    await waitFor(() => expect(panels()).toHaveLength(4));
    await userEvent.click(screen.getByRole('button', { name: '레이아웃 저장' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /^저장/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    await waitFor(async () => {
      const list = await client.listPresets({ kind: 'dashboard' });
      expect(list).toHaveLength(1);
      expect(list[0].sourceFmuId).toBe(MOCK_FMU_ID);
      expect((list[0].config as { panels: unknown[] }).panels).toHaveLength(4);
    });
  });

  test('프리셋 관리에서 대시보드 열기 → 저장한 FMU의 결과 분석으로 간다', async () => {
    const client = createMockClient({ tickMs: 5 });
    await client.createPreset({
      name: 'wb', kind: 'dashboard', sourceFmuId: MOCK_FMU_ID,
      config: { layout: '1x2', syncTimeZoom: false, panels: [{ id: 'a', title: '내 히스토그램', chart: 'histogram' }] },
    });
    await client.createPreset({
      name: 'orphan', kind: 'dashboard', sourceFmuId: null,
      config: { layout: '1x1', syncTimeZoom: false, panels: [] },
    });
    renderApp({ route: '/presets?kind=dashboard', client });
    const orphan = await screen.findByTestId('preset-row-orphan');
    expect(within(orphan).queryByRole('button', { name: '열기' })).toBeNull();
    await userEvent.click(within(screen.getByTestId('preset-row-wb')).getByRole('button', { name: '열기' }));
    expect(await screen.findByRole('tab', { name: '작업대', selected: true })).toBeInTheDocument();
    await waitFor(() => expect(titles()).toEqual(['내 히스토그램']));
  });
});
