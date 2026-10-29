import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createMockClient, MOCK_FMU_ID as FMU_ID, MOCK_NEDC_PATH, MOCK_TIR_PATH } from './mockClient';
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

/** 업로드는 FileReader를 쓰므로 가짜 타이머를 진행시켜야 끝난다 */
async function upload(api: ReturnType<typeof createMockClient>, path: string, file: File) {
  const p = api.uploadCandidate(FMU_ID, path, file);
  await vi.advanceTimersByTimeAsync(10);
  return p;
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

  test('batch crosses params with resource candidates and tags variants', async () => {
    const api = createMockClient({ tickMs: 10 });
    const [nedc] = (await api.listResources(FMU_ID)).filter(r => r.path === MOCK_NEDC_PATH);
    const orig = nedc.candidates[0];
    expect(orig.isOriginal).toBe(true);
    const cand = await upload(api, MOCK_NEDC_PATH, new File(['scaled 0.8'], 'nedc_x0.8.mat'));
    expect(cand.existing).toBe(false);
    const job = await api.createBatch(batchReq({
      params: [{ name: 'p', mode: 'list', values: [1, 2, 3] }],
      resources: { [MOCK_NEDC_PATH]: [orig.id, cand.id] },
    }));
    expect(job.total).toBe(6);
    await runToEnd(api, job.id);
    const variants = await api.listVariants(FMU_ID);
    expect(variants).toHaveLength(2);
    expect(variants.filter(v => v.isOriginal)).toHaveLength(1);
    expect(variants.map(v => v.nRuns)).toEqual([3, 3]);
    const replaced = variants.find(v => !v.isOriginal)!;
    expect(replaced.label).toBe('NEDC.mat=nedc_x0.8.mat');
    expect(replaced.assignment).toEqual({ [MOCK_NEDC_PATH]: cand.id });
    expect((await api.listRuns({ variantIds: [replaced.id] })).total).toBe(3);
    const all = (await api.listRuns({ jobIds: [job.id] })).items;
    const orig0 = variants.find(v => v.isOriginal)!.id;
    expect(all.slice(0, 2).map(r => r.variantId)).toEqual([orig0, replaced.id]);
    expect((await api.listResources(FMU_ID)).find(r => r.path === MOCK_NEDC_PATH)!.candidates.map(c => c.nRuns)).toEqual([3, 3]);
  });

  test('uploading identical content returns the existing candidate', async () => {
    const api = createMockClient();
    const a = await upload(api, MOCK_TIR_PATH, new File(['[TYRE] A'], 'tireA.tir'));
    const b = await upload(api, MOCK_TIR_PATH, new File(['[TYRE] A'], 'renamed.tir'));
    expect(b.existing).toBe(true);
    expect(b.id).toBe(a.id);
    expect(b.name).toBe('tireA.tir');
  });

  test('rejects candidates with a different extension', async () => {
    const api = createMockClient();
    const err = await api.uploadCandidate(FMU_ID, MOCK_NEDC_PATH, new File(['x'], 'nedc.csv')).catch(e => e);
    expect(err.status).toBe(400);
  });

  test('cmaes with a search-mode resource is rejected', async () => {
    const api = createMockClient();
    const obj = await api.createObjective({ name: 'f', code: 'def evaluate(r, p):\n    return 1.0' });
    const [nedc] = (await api.listResources(FMU_ID)).filter(r => r.path === MOCK_NEDC_PATH);
    const cand = await upload(api, MOCK_NEDC_PATH, new File(['k'], 'k.mat'));
    const err = await api.createOptimization(optReq(obj.id, {
      algorithm: 'cmaes',
      resources: { [MOCK_NEDC_PATH]: { mode: 'search', candidateIds: [nedc.candidates[0].id, cand.id] } },
    })).catch(e => e);
    expect(err.status).toBe(422);
  });

  test('previews mat and text candidates', async () => {
    const api = createMockClient();
    const res = await api.listResources(FMU_ID);
    const mat = await api.previewCandidate(FMU_ID, res.find(r => r.path === MOCK_NEDC_PATH)!.candidates[0].id, 'table');
    expect(mat.kind).toBe('mat');
    if (mat.kind === 'mat') expect(mat.plot!.rows[0]).toHaveLength(3);
    const txt = await api.previewCandidate(FMU_ID, res.find(r => r.path === MOCK_TIR_PATH)!.candidates[0].id);
    expect(txt.kind).toBe('text');
  });
});

