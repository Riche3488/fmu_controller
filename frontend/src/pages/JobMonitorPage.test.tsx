import { describe, expect, test, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/render';
import { createMockClient, MOCK_FMU_ID } from '../api/mock/mockClient';
import { batchReq, SIM } from '../test/fixtures';
import type { OptimizationRequest } from '../api/types';

const STALE = '최적화 실행 당시와 목적함수 코드가 다릅니다. 표시된 값은 현재 코드 기준입니다.';

function optReq(objectives: OptimizationRequest['objectives'], nTrials = 6): OptimizationRequest {
  return {
    name: 'opt', fmuId: MOCK_FMU_ID, designVars: [{ name: 'p', min: 0, max: 1, kind: 'float' }], objectives,
    algorithm: objectives.length > 1 ? 'nsga2' : 'tpe', nTrials, fixedParams: {}, sim: SIM,
    recordVariables: ['controlBus.chassisBus.longitudinalVelocity'], workers: 2, runTimeoutSec: 600,
  };
}

function chartOption(testId: string) {
  return JSON.parse(screen.getByTestId(testId).getAttribute('data-option')!);
}

describe('JobMonitorPage', () => {
  test('progress and run table update from events; cancel disappears at end', async () => {
    const client = createMockClient({ tickMs: 20 });
    const job = await client.createBatch(batchReq());
    renderApp({ route: `/jobs/${job.id}`, client });
    expect(await screen.findByRole('button', { name: '취소' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('job-progress-text')).toHaveTextContent('3 / 3'), { timeout: 3000 });
    await waitFor(() => expect(screen.queryByRole('button', { name: '취소' })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByTestId('run-row')).toHaveLength(3), { timeout: 3000 });
  });

  test('batch job shows objective values only after picking objectives, with code hash', async () => {
    const client = createMockClient({ tickMs: 5 });
    const obj = await client.createObjective({ name: 'fuel', code: 'def evaluate(r, p):\n    return 1.0' });
    const job = await client.createBatch(batchReq());
    const spy = vi.spyOn(client, 'listRuns');
    renderApp({ route: `/jobs/${job.id}`, client });
    await waitFor(() => expect(screen.getAllByTestId('run-row')).toHaveLength(3), { timeout: 3000 });
    expect(screen.queryByRole('columnheader', { name: /fuel/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'fuel' }));
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ jobIds: [job.id], objectiveIds: [obj.id] })));
    const header = await screen.findByRole('columnheader', { name: /fuel/ });
    expect(within(header).getByText(obj.codeHash.slice(0, 8))).toBeInTheDocument();
  });

  test('single-objective optimization renders a convergence chart with best-so-far', async () => {
    const client = createMockClient({ tickMs: 5 });
    const obj = await client.createObjective({ name: 'fuel', code: 'def evaluate(r, p):\n    return 1.0' });
    const job = await client.createOptimization(optReq([{ objectiveId: obj.id, direction: 'minimize' }]));
    renderApp({ route: `/jobs/${job.id}`, client });
    await waitFor(() => expect(screen.getAllByTestId('run-row').length).toBeGreaterThanOrEqual(5), { timeout: 3000 });
    await waitFor(() => {
      const opt = chartOption('convergence-chart');
      const best = opt.series.find((s: { name: string }) => s.name === '현재까지 최적');
      expect(best.data.length).toBeGreaterThan(0);
      const ys = best.data.map((d: [number, number]) => d[1]);
      expect(ys).toEqual([...ys].sort((a, b) => b - a));
    });
  });

  test('multi-objective optimization shows pareto scatter and stale-code alert only after edit', async () => {
    const client = createMockClient({ tickMs: 5 });
    const a = await client.createObjective({ name: 'fuel', code: 'def evaluate(r, p):\n    return 1.0' });
    const b = await client.createObjective({ name: 'comfort', code: 'def evaluate(r, p):\n    return 2.0' });
    const job = await client.createOptimization(optReq([
      { objectiveId: a.id, direction: 'minimize' }, { objectiveId: b.id, direction: 'maximize' },
    ]));
    const { unmount } = renderApp({ route: `/jobs/${job.id}`, client });
    await waitFor(() => {
      const opt = chartOption('pareto-chart');
      expect(opt.series.find((s: { name: string }) => s.name === 'Pareto front').data.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
    expect(screen.queryByText(STALE)).not.toBeInTheDocument();
    unmount();

    await client.updateObjective(a.id, { name: 'fuel', code: 'def evaluate(r, p):\n    return 9.0' });
    renderApp({ route: `/jobs/${job.id}`, client });
    expect(await screen.findByText(STALE)).toBeInTheDocument();
  });

  test('selecting rows overlays their time series', async () => {
    const client = createMockClient({ tickMs: 5 });
    const job = await client.createBatch(batchReq());
    const spy = vi.spyOn(client, 'getTimeseries');
    renderApp({ route: `/jobs/${job.id}`, client });
    await waitFor(() => expect(screen.getAllByTestId('run-row')).toHaveLength(3), { timeout: 3000 });
    const rows = screen.getAllByTestId('run-row');
    await userEvent.click(within(rows[0]).getByRole('checkbox'));
    await userEvent.click(within(rows[1]).getByRole('checkbox'));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy).toHaveBeenCalledWith(expect.any(String), ['controlBus.chassisBus.longitudinalVelocity'], 2000);
    await waitFor(() => expect(chartOption('timeseries-chart').series).toHaveLength(2));
  });

  test('unsubscribes on unmount', async () => {
    const client = createMockClient({ tickMs: 5 });
    const job = await client.createBatch(batchReq());
    const unsub = vi.fn();
    const orig = client.subscribeJob.bind(client);
    vi.spyOn(client, 'subscribeJob').mockImplementation((id, cb) => {
      const off = orig(id, cb);
      return () => { unsub(); off(); };
    });
    const { unmount } = renderApp({ route: `/jobs/${job.id}`, client });
    await screen.findByTestId('job-progress-text');
    unmount();
    expect(unsub).toHaveBeenCalled();
  });
});

describe('JobListPage', () => {
  test('lists jobs with kind, status and progress', async () => {
    const client = createMockClient({ tickMs: 5 });
    await client.createBatch(batchReq({ name: 'sweep-1' }));
    renderApp({ route: '/jobs', client });
    const row = (await screen.findByText('sweep-1')).closest('tr')!;
    expect(within(row).getByText('배치')).toBeInTheDocument();
    await userEvent.click(within(row).getByText('sweep-1'));
    expect(await screen.findByRole('heading', { level: 2, name: /sweep-1/ })).toBeInTheDocument();
  });
});
