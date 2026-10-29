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
const V = 'controlBus.chassisBus.longitudinalVelocity';

/** 시계열 패널 하나짜리 프리셋을 불러온다 */
async function loadTsPreset(client: ReturnType<typeof createMockClient>) {
  await client.createPreset({
    name: '시계열 하나', kind: 'dashboard', sourceFmuId: MOCK_FMU_ID,
    config: { layout: '1x1', syncTimeZoom: true, panels: [{ id: 'a', title: '속도', chart: 'tsOverlay', vars: [V] }] },
  });
  renderWith(<Workbench fmuId={MOCK_FMU_ID} filter={{}} />, { client });
  await waitFor(() => expect(panels()).toHaveLength(4));
  await userEvent.click(screen.getByRole('button', { name: '불러오기' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: /시계열 하나/ }));
  await waitFor(() => expect(titles()).toEqual(['속도']));
}

// 테스트가 바꾼 빌더를 원래 등록된 것으로 되돌린다
const ORIGINAL = { ...CHART_BUILDERS };
afterEach(() => {
  for (const k of ['scatter', 'histogram', 'parallel'] as const) {
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

  test('처음 다섯 run 중 실패 run이 있어도 성공 run으로 시계열을 그린다', async () => {
    const client = createMockClient({ tickMs: 5 });
    const job = await finishedBatch(client);
    const ids = (await client.listRuns({ jobIds: [job.id] })).items.map(r => r.id);
    const listRuns = client.listRuns.bind(client);
    // 첫 run을 실패로 바꿔 돌려준다 (실패 run은 시계열이 없다)
    client.listRuns = async q => {
      const page = await listRuns(q);
      return { ...page, items: page.items.map(r => (r.id === ids[0] ? { ...r, status: 'failed' as const, error: 'boom' } : r)) };
    };
    const spy = vi.spyOn(client, 'getTimeseries');
    await loadTsPreset(client);
    const chart = await within(panels()[0]).findByTestId('panel-chart');
    const option = JSON.parse(chart.dataset.option!);
    expect(option.series.map((x: { id: string }) => x.id.split('::')[0])).not.toContain(ids[0]);
    expect(spy.mock.calls.some(([id]) => id === ids[0])).toBe(false);
    expect(spy).toHaveBeenCalledWith(ids[1], [V], 2000);
  });

  test('한 run의 시계열만 실패하면 경고 한 줄 + 나머지 run 차트', async () => {
    const client = createMockClient({ tickMs: 5 });
    const job = await finishedBatch(client);
    const rows = (await client.listRuns({ jobIds: [job.id] })).items;
    const getTs = client.getTimeseries.bind(client);
    client.getTimeseries = (id, vars, n) => (id === rows[1].id ? Promise.reject(new Error('파일 없음')) : getTs(id, vars, n));
    await loadTsPreset(client);
    const panel = panels()[0];
    expect(await within(panel).findByTestId('panel-ts-warning'))
      .toHaveTextContent(`일부 run을 불러오지 못했습니다: #${rows[1].index} — 파일 없음`);
    expect(within(panel).getByTestId('panel-chart')).toBeTruthy();
  });

  test('빌더가 예외를 던지면 그 패널만 차트 오류, 다른 패널은 그대로', async () => {
    CHART_BUILDERS.scatter = () => { throw new Error('망가진 빌더'); };
    renderWith(<Workbench fmuId={MOCK_FMU_ID} filter={{}} />);
    await waitFor(() => expect(panels()).toHaveLength(4));
    await waitFor(() => expect(within(panels()[0]).getByTestId('panel-empty')).toHaveTextContent('차트 오류: 망가진 빌더'));
    expect(within(panels()[3]).getByTestId('panel-empty')).not.toHaveTextContent('차트 오류');
  });

  test('ECharts 렌더 오류는 경계가 잡아 그 패널만 차트 오류', async () => {
    const client = createMockClient({ tickMs: 5 });
    await finishedBatch(client);
    // 테스트용 ECharts stub은 option을 JSON으로 만든다 → BigInt면 렌더 중에 던진다
    CHART_BUILDERS.scatter = () => ({ series: [{ type: 'scatter', data: [BigInt(1)] }] }) as never;
    CHART_BUILDERS.parallel = () => ({ series: [{ type: 'scatter', data: [] }] });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderWith(<Workbench fmuId={MOCK_FMU_ID} filter={{}} />, { client });
    expect(await within(await screen.findAllByTestId('workbench-panel').then(p => p[0])).findByTestId('panel-error'))
      .toHaveTextContent('차트 오류:');
    expect(within(panels()[1]).getByTestId('panel-chart')).toBeTruthy();
    err.mockRestore();
  });

  test('CSV 내보내기는 object URL을 클릭 뒤 비동기로 해제한다', async () => {
    const create = vi.fn(() => 'blob:x');
    const revoke = vi.fn();
    const orig = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      renderWith(<Workbench fmuId={MOCK_FMU_ID} filter={{}} />);
      await waitFor(() => expect(panels()).toHaveLength(4));
      await userEvent.click(screen.getByRole('button', { name: '산점도 패널 메뉴' }));
      const item = await screen.findByRole('menuitem', { name: 'CSV 내보내기' });
      fireEvent.click(item);
      expect(click).toHaveBeenCalled();
      expect(revoke).not.toHaveBeenCalled();
      await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:x'));
    } finally {
      Object.assign(URL, { createObjectURL: orig.create, revokeObjectURL: orig.revoke });
      click.mockRestore();
    }
  });

  test('패널이 참조하는 목적함수만 요청하고, 참조가 바뀌면 다시 받는다', async () => {
    const client = createMockClient({ tickMs: 5 });
    await finishedBatch(client);
    const code = 'def evaluate(result, params):\n    return 1.0\n';
    const a = await client.createObjective({ name: 'A', code });
    const b = await client.createObjective({ name: 'B', code });
    const spy = vi.spyOn(client, 'listRuns');
    const scatterOn = (name: string) => ({
      layout: '1x1' as const, syncTimeZoom: true,
      panels: [{ id: 'a', title: name, chart: 'scatter', x: { kind: 'param', name: 'p' }, y: { kind: 'objective', name } }],
    });
    await client.createPreset({ name: 'A 대시보드', kind: 'dashboard', sourceFmuId: MOCK_FMU_ID, config: scatterOn('A') });
    await client.createPreset({ name: 'B 대시보드', kind: 'dashboard', sourceFmuId: MOCK_FMU_ID, config: scatterOn('B') });
    renderWith(<Workbench fmuId={MOCK_FMU_ID} filter={{}} />, { client });
    await waitFor(() => expect(panels()).toHaveLength(4));
    // 기본 패널은 목적함수를 쓰지 않는다
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls.every(([q]) => q.objectiveIds?.length === 0)).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: '불러오기' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /A 대시보드/ }));
    await waitFor(() => expect(spy.mock.calls.at(-1)![0].objectiveIds).toEqual([a.id]));
    // 목적함수 목록은 이름 전체를 유지한다 (편집기용)
    expect(within(panels()[0]).queryByTestId('panel-missing')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: '불러오기' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /B 대시보드/ }));
    await waitFor(() => expect(spy.mock.calls.at(-1)![0].objectiveIds).toEqual([b.id]));
  });

  test('기록 변수를 비운 잡이 있으면 FMU 출력 변수도 변수 목록에 들어간다', async () => {
    const client = createMockClient({ tickMs: 5 });
    await finishedBatch(client);                          // V만 기록
    await finishedBatch(client, { recordVariables: [] }); // 출력 전체 기록
    const PEDAL = 'controlBus.driverBus.acceleratorPedalPosition';
    await client.createPreset({
      name: '페달', kind: 'dashboard', sourceFmuId: MOCK_FMU_ID,
      config: { layout: '1x1', syncTimeZoom: true, panels: [{ id: 'a', title: '페달', chart: 'tsOverlay', vars: [PEDAL] }] },
    });
    renderWith(<Workbench fmuId={MOCK_FMU_ID} filter={{}} />, { client });
    await waitFor(() => expect(panels()).toHaveLength(4));
    await userEvent.click(screen.getByRole('button', { name: '불러오기' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /페달/ }));
    await waitFor(() => expect(titles()).toEqual(['페달']));
    expect(await within(panels()[0]).findByTestId('panel-chart')).toBeTruthy();
    expect(within(panels()[0]).queryByTestId('panel-missing')).toBeNull();
  });
});
