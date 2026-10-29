import { afterEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockClient, MOCK_FMU_ID } from '../../api/mock/mockClient';
import { CHART_BUILDERS } from '../../lib/charts';
import { finishedBatch } from '../../test/fixtures';
import { renderWith } from '../../test/render';
import { Workbench } from './Workbench';

const panels = () => screen.getAllByTestId('workbench-panel');
const titles = () => screen.getAllByTestId('panel-title').map(t => t.textContent);

// 테스트가 바꾼 빌더를 원래 등록된 것으로 되돌린다
const ORIGINAL = { ...CHART_BUILDERS };
afterEach(() => {
  for (const k of ['scatter', 'histogram'] as const) {
    if (ORIGINAL[k]) CHART_BUILDERS[k] = ORIGINAL[k]; else delete CHART_BUILDERS[k];
  }
});

describe('Workbench', () => {
  test('기본 2x2 네 패널, 시계열 subplot은 변수 선택 안내', async () => {
    renderWith(<Workbench fmuId={MOCK_FMU_ID} filter={{}} />);
    await waitFor(() => expect(titles()).toEqual(['산점도', '평행좌표', '시계열 subplot', '상관 히트맵']));
    await waitFor(() => expect(screen.getAllByTestId('panel-empty')).toHaveLength(4));
    expect(screen.getAllByTestId('panel-empty')[2]).toHaveTextContent('변수를 선택하세요');
  });

  test('패널 추가 메뉴로 히스토그램 추가, 삭제', async () => {
    renderWith(<Workbench fmuId={MOCK_FMU_ID} filter={{}} />);
    await waitFor(() => expect(panels()).toHaveLength(4));
    await userEvent.click(screen.getByRole('button', { name: '패널 추가' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '히스토그램' }));
    expect(panels()).toHaveLength(5);
    expect(titles()[4]).toBe('히스토그램');

    await userEvent.click(screen.getByRole('button', { name: '산점도 패널 메뉴' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '삭제' }));
    expect(titles()).toEqual(['평행좌표', '시계열 subplot', '상관 히트맵', '히스토그램']);
  });

  test('레이아웃 선택이 격자 열 수를 바꾼다', async () => {
    renderWith(<Workbench fmuId={MOCK_FMU_ID} filter={{}} />);
    await waitFor(() => expect(panels()).toHaveLength(4));
    await userEvent.click(screen.getByText('2x3'));
    expect(screen.getByTestId('workbench-grid')).toHaveAttribute('data-cols', '3');
  });

  test('다른 FMU의 변수를 참조하는 프리셋 → 그 패널만 찾을 수 없음', async () => {
    const client = createMockClient({ tickMs: 5 });
    await client.createPreset({
      name: '남의 대시보드', kind: 'dashboard', sourceFmuId: 'other-fmu', config: {
        layout: '1x2', syncTimeZoom: false, panels: [
          { id: 'a', title: '남의 시계열', chart: 'tsSubplots', vars: ['other.speed', 'other.torque'] },
          { id: 'b', title: '멀쩡한 패널', chart: 'fft' },
          { id: 'c', title: 'broken', chart: 'nope' },
        ],
      },
    });
    renderWith(<Workbench fmuId={MOCK_FMU_ID} filter={{}} />, { client });
    await waitFor(() => expect(panels()).toHaveLength(4));
    await userEvent.click(screen.getByRole('button', { name: '불러오기' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /남의 대시보드/ }));

    await waitFor(() => expect(titles()).toEqual(['남의 시계열', '멀쩡한 패널']));
    const [bad, good] = panels();
    expect(within(bad).getByTestId('panel-missing')).toHaveTextContent('찾을 수 없음: other.speed, other.torque');
    expect(within(good).queryByTestId('panel-missing')).toBeNull();
    expect(within(good).getByTestId('panel-empty')).toHaveTextContent('변수를 선택하세요');
    expect(screen.getByTestId('load-notice')).toHaveTextContent('형식이 맞지 않는 패널 1개');
  });

  test('한 패널에서 run 클릭 → 다른 패널 빌더가 선택을 받는다', async () => {
    const client = createMockClient({ tickMs: 5 });
    const job = await finishedBatch(client);
    const runIds = (await client.listRuns({ jobIds: [job.id] })).items.map(r => r.id);
    const seen: string[][] = [];
    CHART_BUILDERS.scatter = (_s, data) => ({ series: [{ type: 'scatter', data: data.rows.map(r => ({ id: r.id, value: [r.index, 0] })) }] });
    CHART_BUILDERS.histogram = (_s, _d, selected) => {
      seen.push(selected);
      return { series: [] };
    };
    renderWith(<Workbench fmuId={MOCK_FMU_ID} filter={{}} />, { client });
    await userEvent.click(await screen.findByRole('button', { name: '패널 추가' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '히스토그램' }));

    const chart = await within(panels()[0]).findByTestId('panel-chart');
    // run id가 아닌 이름(범주 항목)은 선택에 들어가지 않는다
    chart.dataset.pointId = '잡 A';
    fireEvent.click(chart);
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(screen.queryByText(/^선택 \d+개$/)).toBeNull();
    expect(seen.at(-1)).toEqual([]);

    chart.dataset.pointId = runIds[1];
    fireEvent.click(chart);
    await waitFor(() => expect(seen.at(-1)).toEqual([runIds[1]]));
    expect(screen.getByText('선택 1개')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: '선택 해제' }));
    await waitFor(() => expect(seen.at(-1)).toEqual([]));
  });

  test('패널 편집 드로어: 제목 변경, 차트별 매핑 칸', async () => {
    renderWith(<Workbench fmuId={MOCK_FMU_ID} filter={{}} />);
    await waitFor(() => expect(panels()).toHaveLength(4));
    await userEvent.click(screen.getByRole('button', { name: '산점도 패널 메뉴' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '편집…' }));
    const title = await screen.findByLabelText('제목');
    await userEvent.clear(title);
    await userEvent.type(title, '내 차트');
    expect(titles()[0]).toBe('내 차트');
    expect(screen.getAllByLabelText('X축').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('색').length).toBeGreaterThan(0);
  });

  test('결과 조회가 실패하면 오류를 보여 주고 패널은 로딩을 멈춘다', async () => {
    const client = createMockClient({ tickMs: 5 });
    client.listRuns = () => Promise.reject(new Error('서버 오류 500'));
    renderWith(<Workbench fmuId={MOCK_FMU_ID} filter={{}} />, { client });
    expect(await screen.findByTestId('workbench-error')).toHaveTextContent('서버 오류 500');
    await waitFor(() => expect(screen.getAllByTestId('panel-empty')).toHaveLength(4));
  });

  test('시계열 패널은 선택 없이도 처음 run의 시계열을 받아 차트를 그린다', async () => {
    const client = createMockClient({ tickMs: 5 });
    const job = await finishedBatch(client);
    const rows = (await client.listRuns({ jobIds: [job.id] })).items;
    const V = 'controlBus.chassisBus.longitudinalVelocity';
    const spy = vi.spyOn(client, 'getTimeseries');
    await client.createPreset({
      name: '시계열 대시보드', kind: 'dashboard', sourceFmuId: MOCK_FMU_ID,
      config: { layout: '1x1', syncTimeZoom: true, panels: [{ id: 'a', title: '속도', chart: 'tsOverlay', vars: [V] }] },
    });
    renderWith(<Workbench fmuId={MOCK_FMU_ID} filter={{}} />, { client });
    await waitFor(() => expect(panels()).toHaveLength(4));
    await userEvent.click(screen.getByRole('button', { name: '불러오기' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /시계열 대시보드/ }));
    await waitFor(() => expect(titles()).toEqual(['속도']));
    expect(await within(panels()[0]).findByTestId('panel-chart')).toBeTruthy();
    const ids = rows.map(r => r.id);
    expect(spy).toHaveBeenCalledWith(ids[0], [V], 2000);
    expect(spy.mock.calls.every(([id, vars]) => ids.includes(id) && vars.join() === V)).toBe(true);
  });

  test('찾을 수 없는 변수를 쓰는 시계열 패널은 시계열을 받지 않는다', async () => {
    const client = createMockClient({ tickMs: 5 });
    await finishedBatch(client);
    const spy = vi.spyOn(client, 'getTimeseries');
    await client.createPreset({
      name: '남의 시계열', kind: 'dashboard', sourceFmuId: 'other-fmu',
      config: { layout: '1x1', syncTimeZoom: true, panels: [{ id: 'a', title: 'T', chart: 'tsOverlay', vars: ['other.x'] }] },
    });
    renderWith(<Workbench fmuId={MOCK_FMU_ID} filter={{}} />, { client });
    await waitFor(() => expect(panels()).toHaveLength(4));
    await userEvent.click(screen.getByRole('button', { name: '불러오기' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /남의 시계열/ }));
    expect(await screen.findByTestId('panel-missing')).toHaveTextContent('찾을 수 없음: other.x');
    expect(spy).not.toHaveBeenCalled();
  });
});
