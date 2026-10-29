import { describe, expect, test, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/render';
import { createMockClient, MOCK_FMU_ID, MOCK_NEDC_PATH } from '../api/mock/mockClient';
import type { OptPresetConfig, PresetInputOf } from '../api/types';

const ROUTE = `/fmus/${MOCK_FMU_ID}/optimize`;
const SIM = { startTime: 0, stopTime: 100, tolerance: 1e-4, outputInterval: 1 };
const DV = 'road.stopTable[1,1]';
const OUT1 = 'controlBus.brakesBus.wheelSpeed_1';
const OUT2 = 'controlBus.brakesBus.wheelSpeed_2';

async function makeClient() {
  const client = createMockClient({ tickMs: 5 });
  const fuel = await client.createObjective({ name: 'fuel', code: 'def evaluate(r, p):\n    return 1.0' });
  const comfort = await client.createObjective({ name: 'comfort', code: 'def evaluate(r, p):\n    return 2.0' });
  return { client, fuel, comfort };
}

function config(over: Partial<OptPresetConfig> = {}): OptPresetConfig {
  return {
    designVars: [{ name: DV, min: 1, max: 9, kind: 'float' }], objectives: [], algorithm: 'random', nTrials: 7,
    fixedParams: { 'road.stopTable[1,2]': 5 }, sim: SIM, recordVariables: [OUT1, OUT2], plotVariables: [OUT2],
    workers: 3, runTimeoutSec: 120, resources: {}, ...over,
  };
}

async function menu(bar: string, item: RegExp | string) {
  await userEvent.click(within(await screen.findByTestId('preset-menubar')).getByRole('button', { name: bar }));
  await userEvent.click(await screen.findByRole('menuitem', { name: item }));
}

async function ready() {
  // 폼(실행 설정)이 준비될 때까지
  await screen.findByText(/기록 변수 \(/);
}

describe('optimization presets', () => {
  test('save as new preset, edit marks it modified, save overwrites', async () => {
    const { client, fuel } = await makeClient();
    const create = vi.spyOn(client, 'createPreset');
    const update = vi.spyOn(client, 'updatePreset');
    renderApp({ route: ROUTE, client });
    await ready();
    await userEvent.click(screen.getByRole('checkbox', { name: 'fuel' }));
    await userEvent.click(await screen.findByRole('radio', { name: DV }));

    await menu('프리셋', /^저장…/);
    const dialog = await screen.findByRole('dialog');
    const nameInput = within(dialog).getByLabelText('프리셋 이름');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'base');
    await userEvent.click(within(dialog).getByRole('button', { name: '저장' }));

    expect(await screen.findByTestId('current-preset')).toHaveTextContent('base');
    const saved = create.mock.calls[0][0] as PresetInputOf<'optimization'>;
    expect(saved.sourceFmuId).toBe(MOCK_FMU_ID);
    expect(saved.config.objectives).toEqual([{ objectiveId: fuel.id, direction: 'minimize' }]);
    expect(saved.config.designVars.map(v => v.name)).toEqual([DV]);
    expect(saved.config.recordVariables).toBeNull(); // 출력 전체
    expect(screen.queryByTestId('preset-dirty')).not.toBeInTheDocument();

    const trials = screen.getByLabelText('trial 수');
    await userEvent.tripleClick(trials);
    await userEvent.keyboard('12');
    expect(await screen.findByTestId('preset-dirty')).toBeInTheDocument();

    fireEvent.keyDown(document.documentElement, { key: 's', ctrlKey: true });
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect((update.mock.calls[0][1] as PresetInputOf<'optimization'>).config.nTrials).toBe(12);
    await waitFor(() => expect(screen.queryByTestId('preset-dirty')).not.toBeInTheDocument());
    expect((await client.listPresets()).map(p => p.name)).toEqual(['base']);
  });

  test('duplicate name shows an error in the dialog', async () => {
    const { client } = await makeClient();
    await client.createPreset({ name: 'dup', kind: 'optimization', sourceFmuId: MOCK_FMU_ID, config: config() });
    renderApp({ route: ROUTE, client });
    await ready();
    await menu('프리셋', '다른 이름으로 저장…');
    const dialog = await screen.findByRole('dialog');
    await userEvent.clear(within(dialog).getByLabelText('프리셋 이름'));
    await userEvent.type(within(dialog).getByLabelText('프리셋 이름'), 'dup');
    await userEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    expect(await within(dialog).findByText('같은 이름의 프리셋이 이미 있습니다')).toBeInTheDocument();
  });

  test('load restores every field, and undo puts the previous form back', async () => {
    const { client, fuel, comfort } = await makeClient();
    await client.createPreset({
      name: 'two-obj', kind: 'optimization', sourceFmuId: MOCK_FMU_ID, config: config({
        algorithm: 'tpe',
        objectives: [{ objectiveId: fuel.id, direction: 'minimize' }, { objectiveId: comfort.id, direction: 'maximize' }],
      }),
    });
    const submit = vi.spyOn(client, 'createOptimization');
    renderApp({ route: ROUTE, client });
    await ready();
    await menu('불러오기', /two-obj/);

    expect(await screen.findByTestId('load-notice')).toHaveTextContent("프리셋 'two-obj'을(를) 불러왔습니다");
    expect(screen.getByTestId('current-preset')).toHaveTextContent('two-obj');
    expect(screen.getByLabelText(`${DV} 최솟값`)).toHaveValue('1');
    expect(screen.getByLabelText('trial 수')).toHaveValue('7');
    expect(screen.getByRole('checkbox', { name: 'comfort' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'comfort 최대화' })).toBeChecked();
    // 다목적이지만 저장한 TPE를 NSGA-II로 바꾸지 않는다
    expect(screen.getByRole('radio', { name: 'TPE' })).toBeChecked();
    expect(screen.getByText('기록 변수 (2개)')).toBeInTheDocument();
    expect(screen.getByText('고정 파라미터 (1개)')).toBeInTheDocument();
    expect(screen.queryByTestId('preset-dirty')).not.toBeInTheDocument();
    expect((screen.getByLabelText('잡 이름') as HTMLInputElement).value).toMatch(/^two-obj /);

    await userEvent.click(screen.getByRole('button', { name: '최적화 실행' }));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    const req = submit.mock.calls[0][0];
    expect(req).toMatchObject({
      algorithm: 'tpe', nTrials: 7, workers: 3, runTimeoutSec: 120, sim: SIM,
      recordVariables: [OUT1, OUT2], plotVariables: [OUT2], fixedParams: { 'road.stopTable[1,2]': 5 },
    });
  });

  test('undo after loading', async () => {
    const { client } = await makeClient();
    await client.createPreset({ name: 'p', kind: 'optimization', sourceFmuId: MOCK_FMU_ID, config: config() });
    renderApp({ route: ROUTE, client });
    await ready();
    await menu('불러오기', /^p/);
    await screen.findByLabelText(`${DV} 최솟값`);
    await userEvent.click(screen.getByRole('button', { name: '되돌리기' }));
    expect(screen.queryByLabelText(`${DV} 최솟값`)).not.toBeInTheDocument();
    expect(screen.queryByTestId('current-preset')).not.toBeInTheDocument();
    expect(screen.getByText('기록 변수 (140개)')).toBeInTheDocument();
  });

  test('preset from another FMU lists what could not be carried over', async () => {
    const { client } = await makeClient();
    await client.createPreset({
      name: 'foreign', kind: 'optimization', sourceFmuId: 'otherfmu00000000', config: config({
        designVars: [{ name: DV, min: 1, max: 9, kind: 'float' }, { name: 'not.here', min: 0, max: 1, kind: 'float' }],
        resources: { [MOCK_NEDC_PATH]: { mode: 'fixed', sha256: 'unknown-sha' } },
      }),
    });
    renderApp({ route: ROUTE, client });
    await ready();
    await userEvent.click(within(screen.getByTestId('preset-menubar')).getByRole('button', { name: '불러오기' }));
    expect(await screen.findByText(/다른 FMU의 프리셋/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: /foreign/ }));
    const notice = await screen.findByTestId('load-notice');
    expect(notice).toHaveTextContent('설계 변수 1개를 이 FMU에서 찾을 수 없어 뺐습니다: not.here');
    expect(notice).toHaveTextContent(`${MOCK_NEDC_PATH}: 저장한 후보가 이 FMU에 없어 원본을 씁니다`);
    expect(screen.getByLabelText(`${DV} 최솟값`)).toBeInTheDocument();
  });

  test('a past job can be reused from the job monitor', async () => {
    const { client, fuel } = await makeClient();
    const job = await client.createOptimization({
      name: 'old-run', fmuId: MOCK_FMU_ID, designVars: [{ name: DV, min: 2, max: 4, kind: 'int' }],
      objectives: [{ objectiveId: fuel.id, direction: 'maximize' }], algorithm: 'random', nTrials: 3,
      fixedParams: {}, sim: SIM, recordVariables: [OUT1, OUT2], plotVariables: [OUT2], workers: 1, runTimeoutSec: 30,
    });
    renderApp({ route: `/jobs/${job.id}`, client });
    // 모니터는 저장한 표시 변수를 기본으로 보여 준다
    await screen.findByRole('heading', { name: /잡 모니터/ });
    await waitFor(() => expect([...document.querySelectorAll('.mantine-Pill-label')].map(e => e.textContent)).toEqual([OUT2]));
    await userEvent.click(await screen.findByRole('link', { name: '이 설정으로 새 최적화' }));

    expect(await screen.findByTestId('load-notice')).toHaveTextContent("잡 'old-run'의 설정을 불러왔습니다");
    expect(screen.getByLabelText(`${DV} 최솟값`)).toHaveValue('2');
    expect(screen.getByRole('radio', { name: 'fuel 최대화' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Random' })).toBeChecked();
  });

  test('job monitor saves the job settings as a preset', async () => {
    const { client, fuel } = await makeClient();
    const job = await client.createOptimization({
      name: 'keep-me', fmuId: MOCK_FMU_ID, designVars: [{ name: DV, min: 2, max: 4, kind: 'float' }],
      objectives: [{ objectiveId: fuel.id, direction: 'minimize' }], algorithm: 'tpe', nTrials: 3,
      fixedParams: {}, sim: SIM, recordVariables: [OUT1], workers: 1, runTimeoutSec: 30,
    });
    renderApp({ route: `/jobs/${job.id}`, client });
    await userEvent.click(await screen.findByRole('button', { name: '프리셋으로 저장' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('프리셋 이름')).toHaveValue('keep-me');
    await userEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    await waitFor(async () => expect((await client.listPresets()).map(p => p.name)).toEqual(['keep-me']));
    const [p] = await client.listPresets();
    expect(p.config).toMatchObject({ nTrials: 3, recordVariables: [OUT1], designVars: [{ name: DV, min: 2, max: 4 }] });
  });

  test('preset page opens, renames and deletes presets', async () => {
    const { client } = await makeClient();
    await client.createPreset({ name: 'alpha', kind: 'optimization', sourceFmuId: MOCK_FMU_ID, config: config() });
    renderApp({ route: '/presets', client });
    const row = await screen.findByTestId('preset-row-alpha');
    expect(row).toHaveTextContent('설계 변수 1 · 목적 0 · Random · 7 trials');

    await userEvent.click(within(row).getByRole('button', { name: '이름 바꾸기' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.clear(within(dialog).getByLabelText('프리셋 이름'));
    await userEvent.type(within(dialog).getByLabelText('프리셋 이름'), 'beta');
    await userEvent.click(within(dialog).getByRole('button', { name: '바꾸기' }));
    const renamed = await screen.findByTestId('preset-row-beta');

    await userEvent.click(within(renamed).getByRole('button', { name: '열기' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /저장한 FMU/ }));
    expect(await screen.findByTestId('load-notice')).toHaveTextContent("프리셋 'beta'을(를) 불러왔습니다");

    await userEvent.click(screen.getByRole('link', { name: '프리셋' }));
    await userEvent.click(within(await screen.findByTestId('preset-row-beta')).getByRole('button', { name: '삭제' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '삭제' }));
    expect(await screen.findByText('저장된 프리셋이 없습니다')).toBeInTheDocument();
  });
});

