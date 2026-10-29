import { afterEach, describe, expect, test, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/render';
import { createMockClient, MOCK_FMU_ID } from '../api/mock/mockClient';
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

function chartOption(testId: string) {
  return JSON.parse(screen.getByTestId(testId).getAttribute('data-option')!);
}

afterEach(() => vi.restoreAllMocks());

describe('ResultsPage', () => {
  test('lists all runs of this FMU only, paginated by the server', async () => {
    const { client, job1, job2 } = await setup();
    const spy = vi.spyOn(client, 'listRuns');
    renderApp({ route: ROUTE, client });
    const expected = job1.completed + job1.failed + job2.completed + job2.failed;
    await waitFor(() => expect(screen.getAllByTestId('run-row')).toHaveLength(expected));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ fmuId: MOCK_FMU_ID, offset: 0, limit: 100 }));
    expect(screen.queryByText('other-job')).not.toBeInTheDocument();
  });

  test('objective values use current code: hash shown, notice shown, sort hits server', async () => {
    const { client, obj } = await setup();
    const spy = vi.spyOn(client, 'listRuns');
    renderApp({ route: ROUTE, client });
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
    await userEvent.click(await screen.findByRole('checkbox', { name: 'fuel' }));
    const header = await screen.findByRole('columnheader', { name: /fuel/ });
    expect(within(header).getByText(updated.codeHash.slice(0, 8))).toBeInTheDocument();
    expect(within(header).queryByText(obj.codeHash.slice(0, 8))).not.toBeInTheDocument();
  });

  test('scatter plots parameter vs objective for ok runs', async () => {
    const { client, obj, job1, job2 } = await setup();
    renderApp({ route: ROUTE, client });
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
    expect(header).toBe(`job,index,status,p,fuel[${obj.codeHash.slice(0, 8)}]`);
    expect(text.trim().split('\n').length).toBeGreaterThan(3);
  });
});
