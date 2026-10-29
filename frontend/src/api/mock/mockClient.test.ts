import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createMockClient, MOCK_FMU_ID as FMU_ID } from './mockClient';
import type { BatchRequest, JobEvent, OptimizationRequest } from '../types';

const SIM = { startTime: 0, stopTime: 10, tolerance: 1e-4, outputInterval: 1 };

function batchReq(over: Partial<BatchRequest> = {}): BatchRequest {
  return {
    name: 'b', fmuId: FMU_ID, params: [], sampling: 'grid', nSamples: null, fixedParams: {},
    sim: SIM, recordVariables: [], workers: 2, runTimeoutSec: 600, ...over,
  };
}

function optReq(objectiveId: string, over: Partial<OptimizationRequest> = {}): OptimizationRequest {
  return {
    name: 'o', fmuId: FMU_ID, designVars: [{ name: 'p', min: 0, max: 1, kind: 'float' }],
    objectives: [{ objectiveId, direction: 'minimize' }], algorithm: 'tpe', nTrials: 4,
    fixedParams: {}, sim: SIM, recordVariables: [], workers: 2, runTimeoutSec: 600, ...over,
  };
}

async function runToEnd(api: ReturnType<typeof createMockClient>, jobId: string) {
  const events: JobEvent[] = [];
  api.subscribeJob(jobId, e => events.push(e));
  await vi.advanceTimersByTimeAsync(500);
  return events;
}

describe('mock client', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('listVariables filters and paginates', async () => {
    const api = createMockClient();
    const p = await api.listVariables(FMU_ID, { q: 'road.stop', causality: 'parameter', offset: 0, limit: 5 });
    expect(p.items).toHaveLength(5);
    expect(p.items.every(v => v.name.includes('road.stop') && v.causality === 'parameter')).toBe(true);
    expect(p.total).toBeGreaterThan(5);
  });

  test('batch job progresses to done and emits run events', async () => {
    const api = createMockClient({ tickMs: 10 });
    const job = await api.createBatch(batchReq({ params: [{ name: 'p', mode: 'list', values: [1, 2, 3] }] }));
    const events = await runToEnd(api, job.id);
    expect(events.filter(e => e.type === 'run')).toHaveLength(3);
    expect(events.at(-1)).toMatchObject({ type: 'end', job: { status: 'done', completed: 3 } });
  });

  test('listRuns computes objectives with current code and reports codeHash', async () => {
    const api = createMockClient({ tickMs: 10 });
    const obj = await api.createObjective({ name: 'o1', code: 'def evaluate(r, p):\n    return 1.0' });
    const job = await api.createBatch(batchReq({ params: [{ name: 'p', mode: 'list', values: [1, 2] }] }));
    await runToEnd(api, job.id);

    const first = await api.listRuns({ jobIds: [job.id], objectiveIds: [obj.id] });
    const h1 = first.codeHashes[obj.id];
    expect(h1).toBe(obj.codeHash);
    const v1 = first.items.map(r => r.objectives[obj.id].value);

    const updated = await api.updateObjective(obj.id, { name: 'o1', code: 'def evaluate(r, p):\n    return 2.0' });
    const second = await api.listRuns({ jobIds: [job.id], objectiveIds: [obj.id] });
    expect(second.codeHashes[obj.id]).toBe(updated.codeHash);
    expect(second.codeHashes[obj.id]).not.toBe(h1);
    expect(second.items.map(r => r.objectives[obj.id].value)).not.toEqual(v1);
  });

  test('optimization job stores objectiveSnapshot', async () => {
    const api = createMockClient({ tickMs: 10 });
    const obj = await api.createObjective({ name: 'o1', code: 'def evaluate(r, p):\n    return 1.0' });
    const job = await api.createOptimization(optReq(obj.id));
    expect(job.objectiveSnapshot).toEqual({ [obj.id]: { name: 'o1', codeHash: obj.codeHash } });
    await api.updateObjective(obj.id, { name: 'o1', code: 'def evaluate(r, p):\n    return 3.0' });
    expect((await api.getJob(job.id)).objectiveSnapshot![obj.id].codeHash).toBe(obj.codeHash);
  });

  test('cancelJob stops progress with status cancelled', async () => {
    const api = createMockClient({ tickMs: 10 });
    const job = await api.createBatch(batchReq({ params: [{ name: 'p', mode: 'range', min: 0, max: 1, steps: 20 }] }));
    await vi.advanceTimersByTimeAsync(35);
    const cancelled = await api.cancelJob(job.id);
    expect(cancelled.status).toBe('cancelled');
    await vi.advanceTimersByTimeAsync(500);
    const after = await api.getJob(job.id);
    expect(after.completed).toBeLessThan(20);
    expect(after.completed).toBe(cancelled.completed);
  });

  test('testObjective returns error when code lacks evaluate', async () => {
    const api = createMockClient({ tickMs: 10 });
    const job = await api.createBatch(batchReq({ params: [{ name: 'p', mode: 'list', values: [1] }] }));
    await runToEnd(api, job.id);
    const runs = await api.listRuns({ jobIds: [job.id] });
    const res = await api.testObjective({ code: 'x = 1', runId: runs.items[0].id });
    expect(res.error).toBe('evaluate 함수가 정의되지 않았습니다');
    expect(res.value).toBeNull();
  });
});
