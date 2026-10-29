import { describe, expect, test, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/render';
import { createMockClient, MOCK_FMU_ID, MOCK_NEDC_PATH } from '../api/mock/mockClient';
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

  test('batch with resources shows the resource column', async () => {
    const client = createMockClient({ tickMs: 5 });
    const cand = await client.uploadCandidate(MOCK_FMU_ID, MOCK_NEDC_PATH, new File(['k'], 'nedc_x0.8.mat'));
    const orig = (await client.listResources(MOCK_FMU_ID)).find(r => r.path === MOCK_NEDC_PATH)!.candidates[0];
    const job = await client.createBatch(batchReq({ resources: { [MOCK_NEDC_PATH]: [orig.id, cand.id] } }));
    renderApp({ route: `/jobs/${job.id}`, client });
    await waitFor(() => expect(screen.getAllByTestId('run-row')).toHaveLength(6), { timeout: 3000 });
    expect(screen.getByRole('columnheader', { name: 'Resource 조합' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('NEDC.mat=nedc_x0.8.mat')).toHaveLength(3));
    expect(screen.getAllByText('원본')).toHaveLength(3);
  });

  test('single-objective optimization shows best trial with its resource combo', async () => {
    const client = createMockClient({ tickMs: 5 });
    const obj = await client.createObjective({ name: 'fuel', code: 'def evaluate(r, p):\n    return 1.0' });
    const cand = await client.uploadCandidate(MOCK_FMU_ID, MOCK_NEDC_PATH, new File(['k'], 'k.mat'));
    const job = await client.createOptimization({
      ...optReq([{ objectiveId: obj.id, direction: 'minimize' }], 8),
      resources: { [MOCK_NEDC_PATH]: { mode: 'fixed', candidateId: cand.id } },
    });
    renderApp({ route: `/jobs/${job.id}`, client });
    const card = await screen.findByTestId('best-trial', {}, { timeout: 3000 });
    await waitFor(() => expect(within(card).getByText('NEDC.mat=k.mat')).toBeInTheDocument(), { timeout: 3000 });
    expect(within(card).getByText(/fuel/)).toBeInTheDocument();
  });

  test('search-mode resource shows per-candidate bars', async () => {
    const client = createMockClient({ tickMs: 5 });
    const obj = await client.createObjective({ name: 'fuel', code: 'def evaluate(r, p):\n    return 1.0' });
    const cand = await client.uploadCandidate(MOCK_FMU_ID, MOCK_NEDC_PATH, new File(['k'], 'k.mat'));
    const orig = (await client.listResources(MOCK_FMU_ID)).find(r => r.path === MOCK_NEDC_PATH)!.candidates[0];
    const job = await client.createOptimization({
      ...optReq([{ objectiveId: obj.id, direction: 'minimize' }], 12),
      resources: { [MOCK_NEDC_PATH]: { mode: 'search', candidateIds: [orig.id, cand.id] } },
    });
    renderApp({ route: `/jobs/${job.id}`, client });
    await waitFor(() => {
      const opt = chartOption(`candidate-bar-${MOCK_NEDC_PATH}`);
      expect(opt.xAxis.data).toEqual(['NEDC.mat (원본)', 'k.mat']);
      expect(opt.series.map((x: { name: string }) => x.name)).toEqual(['평균', '최적']);
      expect(opt.series[0].data.filter((v: number | null) => v !== null).length).toBeGreaterThan(0);
    }, { timeout: 3000 });
  });
});

