import { afterEach, describe, expect, test, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/render';
import { createMockClient, MOCK_FMU_ID, MOCK_NEDC_PATH } from '../api/mock/mockClient';
import { finishedBatch } from '../test/fixtures';

const ROUTE = `/fmus/${MOCK_FMU_ID}/results`;
const CODE = 'def evaluate(r, p):\n    return 1.0';

async function setup() {
  const client = createMockClient({ tickMs: 2 });
  const obj = await client.createObjective({ name: 'fuel', code: CODE });
  const job1 = await finishedBatch(client, { name: 'sweep-A' });
  const job2 = await finishedBatch(client, { name: 'sweep-B', params: [{ name: 'p', mode: 'list', values: [5, 6] }] });
  const other = await client.uploadFmu(new File(['x'], 'other.fmu'));
  await finishedBatch(client, { name: 'other-job', fmuId: other.id });
  return { client, obj, job1, job2, other };
}

/** 결과 분석 기본 탭은 작업대라 표를 보려면 결과 표 탭으로 옮긴다 */
const openTable = async () => userEvent.click(await screen.findByRole('tab', { name: '결과 표' }));

function chartOption(testId: string) {
  return JSON.parse(screen.getByTestId(testId).getAttribute('data-option')!);
}

afterEach(() => vi.restoreAllMocks());

describe('ResultsPage', () => {
  test('lists all runs of this FMU only, paginated by the server', async () => {
    const { client, job1, job2 } = await setup();
    const spy = vi.spyOn(client, 'listRuns');
    renderApp({ route: ROUTE, client });
    await openTable();
    const expected = job1.completed + job1.failed + job2.completed + job2.failed;
    await waitFor(() => expect(screen.getAllByTestId('run-row')).toHaveLength(expected));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ fmuId: MOCK_FMU_ID, offset: 0, limit: 100 }));
    expect(screen.queryByText('other-job')).not.toBeInTheDocument();
  });

  test('objective values use current code: hash shown, notice shown, sort hits server', async () => {
    const { client, obj } = await setup();
    const spy = vi.spyOn(client, 'listRuns');
    renderApp({ route: ROUTE, client });
    await openTable();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'fuel' }));
    const header = await screen.findByRole('columnheader', { name: /fuel/ });
    expect(within(header).getByText(obj.codeHash.slice(0, 8))).toBeInTheDocument();
    expect(screen.getByText('현재 목적함수 코드 기준으로 계산된 값입니다')).toBeInTheDocument();
    await userEvent.click(within(header).getByRole('button', { name: /fuel/ }));
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ sortBy: `objective:${obj.id}`, sortDir: 'asc' })));
  });

  test('after the objective code changes the new hash is shown, old one is gone', async () => {
    const { client, obj } = await setup();
    const updated = await client.updateObjective(obj.id, { name: 'fuel', code: 'def evaluate(r, p):\n    return 3.0' });
    renderApp({ route: ROUTE, client });
    await openTable();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'fuel' }));
    const header = await screen.findByRole('columnheader', { name: /fuel/ });
    expect(within(header).getByText(updated.codeHash.slice(0, 8))).toBeInTheDocument();
    expect(within(header).queryByText(obj.codeHash.slice(0, 8))).not.toBeInTheDocument();
  });

  test('scatter plots parameter vs objective for ok runs', async () => {
    const { client, obj, job1, job2 } = await setup();
    renderApp({ route: ROUTE, client });
    await openTable();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'fuel' }));
    await userEvent.click(screen.getByRole('textbox', { name: 'X축' }));
    await userEvent.click(await screen.findByRole('option', { name: 'p' }));
    await userEvent.click(screen.getByRole('textbox', { name: 'Y축' }));
    await userEvent.click(await screen.findByRole('option', { name: 'fuel' }));
    const ok = job1.completed + job2.completed;
    await waitFor(() => {
      const opt = chartOption('results-scatter');
      expect(opt.series[0].data.length + opt.series[1].data.length).toBe(ok);
    });
    expect(obj.id).toBeTruthy();
  });

  test('FMU comparison shows a boxplot per FMU', async () => {
    const { client, other } = await setup();
    renderApp({ route: ROUTE, client });
    await userEvent.click(await screen.findByRole('tab', { name: 'FMU 비교' }));
    await userEvent.click(screen.getByRole('textbox', { name: '비교할 FMU' }));
    await userEvent.click(await screen.findByRole('option', { name: /other\.fmu/ }));
    await userEvent.click(within(screen.getByRole('tabpanel')).getByRole('checkbox', { name: 'fuel' }));
    await waitFor(() => {
      const opt = chartOption('compare-boxplot');
      expect(opt.xAxis.data).toEqual(['my_0test_DriveCycleAT.fmu', 'other.fmu']);
      expect(opt.series[0].data).toHaveLength(2);
    });
    expect(other.id).toBeTruthy();
  });

  test('CSV export includes params, objective values and code hash in header', async () => {
    const { client, obj } = await setup();
    let blob: Blob | null = null;
    URL.createObjectURL = vi.fn((b: Blob) => { blob = b; return 'blob:x'; });
    URL.revokeObjectURL = vi.fn();
    renderApp({ route: ROUTE, client });
    await openTable();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'fuel' }));
    await screen.findByRole('columnheader', { name: /fuel/ });
    await userEvent.click(screen.getByRole('button', { name: 'CSV 내보내기' }));
    await waitFor(() => expect(blob).not.toBeNull());
    const text = await new Promise<string>(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsText(blob!);
    });
    const header = text.split('\n')[0];
    expect(header).toBe(`job,index,status,variant,p,fuel[${obj.codeHash.slice(0, 8)}]`);
    expect(text.trim().split('\n').length).toBeGreaterThan(3);
  });

  test('CSV header hash comes from the same response as the exported values', async () => {
    const { client, obj } = await setup();
    const orig = client.listRuns.bind(client);
    // 페이지 조회와 전체 조회 사이에 코드가 바뀐 상황: 두 응답의 해시가 다르다
    vi.spyOn(client, 'listRuns').mockImplementation(async q => {
      const page = await orig(q);
      return (q.limit ?? 0) > 1000 ? { ...page, codeHashes: { [obj.id]: 'feedbeef'.repeat(8) } } : page;
    });
    let blob: Blob | null = null;
    URL.createObjectURL = vi.fn((b: Blob) => { blob = b; return 'blob:x'; });
    URL.revokeObjectURL = vi.fn();
    renderApp({ route: ROUTE, client });
    await openTable();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'fuel' }));
    await screen.findByRole('columnheader', { name: /fuel/ });
    await userEvent.click(screen.getByRole('button', { name: 'CSV 내보내기' }));
    await waitFor(() => expect(blob).not.toBeNull());
    const text = await new Promise<string>(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsText(blob!);
    });
    expect(text.split('\n')[0]).toBe('job,index,status,variant,p,fuel[feedbeef]');
  });

  test('filters runs by resource combo', async () => {
    const { client } = await setup();
    const cand = await client.uploadCandidate(MOCK_FMU_ID, MOCK_NEDC_PATH, new File(['k'], 'nedc_k.mat'));
    const orig = (await client.listResources(MOCK_FMU_ID)).find(r => r.path === MOCK_NEDC_PATH)!.candidates[0];
    await finishedBatch(client, { name: 'res', resources: { [MOCK_NEDC_PATH]: [orig.id, cand.id] } });
    const variant = (await client.listVariants(MOCK_FMU_ID)).find(v => !v.isOriginal)!;
    const spy = vi.spyOn(client, 'listRuns');
    renderApp({ route: ROUTE, client });
    await openTable();
    const before = (await screen.findAllByTestId('run-row')).length;
    expect(screen.getByRole('columnheader', { name: 'Resource 조합' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('textbox', { name: 'Resource 조합' }));
    await userEvent.click(await screen.findByRole('option', { name: 'NEDC.mat=nedc_k.mat' }));
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ variantIds: [variant.id] })));
    await waitFor(() => expect(screen.getAllByTestId('run-row').length).toBeLessThan(before));
    expect(screen.getAllByTestId('run-row')).toHaveLength(variant.nRuns);
  });

  test('variant comparison shows a boxplot per combo', async () => {
    const { client } = await setup();
    const cand = await client.uploadCandidate(MOCK_FMU_ID, MOCK_NEDC_PATH, new File(['k'], 'nedc_k.mat'));
    const orig = (await client.listResources(MOCK_FMU_ID)).find(r => r.path === MOCK_NEDC_PATH)!.candidates[0];
    await finishedBatch(client, { name: 'res', resources: { [MOCK_NEDC_PATH]: [orig.id, cand.id] } });
    renderApp({ route: ROUTE, client });
    await userEvent.click(await screen.findByRole('tab', { name: 'Resource 조합 비교' }));
    await userEvent.click(within(screen.getByRole('tabpanel')).getByRole('checkbox', { name: 'fuel' }));
    await waitFor(() => {
      const opt = chartOption('variant-boxplot');
      expect(opt.xAxis.data).toEqual(['원본', 'NEDC.mat=nedc_k.mat']);
      expect(opt.series[0].data).toHaveLength(2);
    });
  });
});

