import { describe, expect, test, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/render';
import { createMockClient, MOCK_FMU_ID, MOCK_NEDC_PATH } from '../api/mock/mockClient';
import type { BatchPresetConfig, PresetInputOf } from '../api/types';

const ROUTE = `/fmus/${MOCK_FMU_ID}/batch`;
const SIM = { startTime: 0, stopTime: 100, tolerance: 1e-4, outputInterval: 1 };
const P1 = 'road.stopTable[1,1]';
const P2 = 'road.stopTable[1,2]';
const OUT1 = 'controlBus.brakesBus.wheelSpeed_1';
const OUT2 = 'controlBus.brakesBus.wheelSpeed_2';

function config(over: Partial<BatchPresetConfig> = {}): BatchPresetConfig {
  return {
    params: [{ name: P1, mode: 'list', values: [1, 2, 3] }, { name: P2, mode: 'range', min: 0, max: 10, steps: 4 }],
    sampling: 'grid', nSamples: 20, fixedParams: { 'road.r0Cones[1,1]': 7 }, sim: SIM,
    recordVariables: [OUT1, OUT2], plotVariables: [OUT2], workers: 3, runTimeoutSec: 120, resources: {}, ...over,
  };
}

async function menu(bar: string, item: RegExp | string) {
  await userEvent.click(within(await screen.findByTestId('preset-menubar')).getByRole('button', { name: bar }));
  await userEvent.click(await screen.findByRole('menuitem', { name: item }));
}

async function ready() {
  await screen.findByText(/기록 변수 \(/);
}

describe('batch presets', () => {
  test('save, modify, overwrite with Ctrl+S', async () => {
    const client = createMockClient({ tickMs: 5 });
    const create = vi.spyOn(client, 'createPreset');
    const update = vi.spyOn(client, 'updatePreset');
    renderApp({ route: ROUTE, client });
    await ready();
    await userEvent.click(await screen.findByRole('radio', { name: P1 }));
    const values = await screen.findByLabelText(`${P1} 값`);
    await userEvent.clear(values);
    await userEvent.type(values, '1,2');

    await menu('프리셋', /^저장…/);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('프리셋 이름')).toHaveValue('my_test.DriveCycleAT 배치');
    await userEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    expect(await screen.findByTestId('current-preset')).toHaveTextContent('my_test.DriveCycleAT 배치');
    const saved = create.mock.calls[0][0] as PresetInputOf<'batch'>;
    expect(saved.kind).toBe('batch');
    expect(saved.config.params).toEqual([{ name: P1, mode: 'list', values: [1, 2] }]);

    await userEvent.click(screen.getByRole('radio', { name: 'zip' }));
    expect(await screen.findByTestId('preset-dirty')).toBeInTheDocument();
    fireEvent.keyDown(document.documentElement, { key: 's', ctrlKey: true });
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect((update.mock.calls[0][1] as PresetInputOf<'batch'>).config.sampling).toBe('zip');
    await waitFor(() => expect(screen.queryByTestId('preset-dirty')).not.toBeInTheDocument());
  });

  test('load restores rows, sampling and settings; submit sends them', async () => {
    const client = createMockClient({ tickMs: 5 });
    await client.createPreset({ name: 'sweep', kind: 'batch', sourceFmuId: MOCK_FMU_ID, config: config() });
    // 최적화 프리셋은 배치 메뉴에 나오지 않는다
    await client.createPreset({
      name: 'opt-only', kind: 'optimization', sourceFmuId: MOCK_FMU_ID, config: {
        designVars: [], objectives: [], algorithm: 'tpe', nTrials: 5, fixedParams: {}, sim: SIM, recordVariables: null,
        plotVariables: [], workers: 1, runTimeoutSec: 10, resources: {},
      },
    });
    const submit = vi.spyOn(client, 'createBatch');
    renderApp({ route: ROUTE, client });
    await ready();
    await userEvent.click(within(screen.getByTestId('preset-menubar')).getByRole('button', { name: '불러오기' }));
    expect(screen.queryByRole('menuitem', { name: /opt-only/ })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('menuitem', { name: /sweep/ }));

    expect(await screen.findByTestId('load-notice')).toHaveTextContent("프리셋 'sweep'을(를) 불러왔습니다");
    expect(screen.getByLabelText(`${P1} 값`)).toHaveValue('1, 2, 3');
    expect(screen.getByLabelText(`${P2} 단계 수`)).toHaveValue('4');
    expect(screen.getByText('총 12 케이스')).toBeInTheDocument();
    expect(screen.getByText('고정 파라미터 (1개)')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '배치 실행' }));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    expect(submit.mock.calls[0][0]).toMatchObject({
      sampling: 'grid', workers: 3, runTimeoutSec: 120, sim: SIM, recordVariables: [OUT1, OUT2], plotVariables: [OUT2],
      fixedParams: { 'road.r0Cones[1,1]': 7 },
      params: [{ name: P1, mode: 'list', values: [1, 2, 3] }, { name: P2, mode: 'range', min: 0, max: 10, steps: 4 }],
    });
  });

  test('missing candidates and params are reported, undo restores', async () => {
    const client = createMockClient({ tickMs: 5 });
    await client.createPreset({
      name: 'foreign', kind: 'batch', sourceFmuId: null, config: config({
        params: [{ name: P1, mode: 'list', values: [1] }, { name: 'not.here', mode: 'list', values: [1] }],
        resources: { [MOCK_NEDC_PATH]: ['unknown-sha'] },
      }),
    });
    renderApp({ route: ROUTE, client });
    await ready();
    await menu('불러오기', /foreign/);
    const notice = await screen.findByTestId('load-notice');
    expect(notice).toHaveTextContent('스윕 파라미터 1개를 이 FMU에서 찾을 수 없어 뺐습니다: not.here');
    expect(notice).toHaveTextContent(`${MOCK_NEDC_PATH}: 저장한 후보 1개가 이 FMU에 없습니다 (원본을 씁니다)`);
    await userEvent.click(screen.getByRole('button', { name: '되돌리기' }));
    expect(screen.queryByLabelText(`${P1} 값`)).not.toBeInTheDocument();
  });

  test('batch job is reused and saved from the job monitor', async () => {
    const client = createMockClient({ tickMs: 5 });
    const job = await client.createBatch({
      name: 'old-batch', fmuId: MOCK_FMU_ID, params: [{ name: P1, mode: 'list', values: [4, 5] }], sampling: 'grid',
      nSamples: null, fixedParams: {}, sim: SIM, recordVariables: [OUT1, OUT2], plotVariables: [OUT2], workers: 1,
      runTimeoutSec: 30,
    });
    renderApp({ route: `/jobs/${job.id}`, client });
    await screen.findByRole('heading', { name: /잡 모니터/ });
    await waitFor(() => expect([...document.querySelectorAll('.mantine-Pill-label')].map(e => e.textContent)).toEqual([OUT2]));

    await userEvent.click(screen.getByRole('button', { name: '프리셋으로 저장' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '저장' }));
    await waitFor(async () => expect((await client.listPresets({ kind: 'batch' })).map(p => p.name)).toEqual(['old-batch']));

    await userEvent.click(screen.getByRole('link', { name: '이 설정으로 새 배치' }));
    expect(await screen.findByTestId('load-notice')).toHaveTextContent("잡 'old-batch'의 설정을 불러왔습니다");
    expect(screen.getByLabelText(`${P1} 값`)).toHaveValue('4, 5');
  });

  test('preset page shows batch presets on their own tab and opens the batch screen', async () => {
    const client = createMockClient({ tickMs: 5 });
    await client.createPreset({ name: 'b1', kind: 'batch', sourceFmuId: MOCK_FMU_ID, config: config() });
    renderApp({ route: '/presets', client });
    expect(await screen.findByText('저장된 프리셋이 없습니다')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: '배치 해석' }));
    const row = await screen.findByTestId('preset-row-b1');
    expect(row).toHaveTextContent('파라미터 2 · grid');
    expect(row).toHaveTextContent(`파라미터: ${P1}, ${P2}`);
    await userEvent.click(within(row).getByRole('button', { name: '열기' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /저장한 FMU/ }));
    expect(await screen.findByRole('heading', { name: '배치 해석 설정' })).toBeInTheDocument();
    expect(await screen.findByTestId('load-notice')).toHaveTextContent("프리셋 'b1'을(를) 불러왔습니다");
  });
});
