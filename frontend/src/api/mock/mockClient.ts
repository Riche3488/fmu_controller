// 메모리 기반 mock ApiClient — Phase 1 UI 개발용. 백엔드 동작을 흉내 낸다:
// - 배치 잡은 목적함수를 계산하지 않는다.
// - 목적함수 값은 listRuns 호출 시점의 현재 코드로 계산한다 (코드가 바뀌면 값도 바뀐다).
import { ApiError, type ApiClient } from '../client';
import type {
  BatchRequest,
  FmuSummary,
  Job,
  JobEvent,
  Objective,
  ObjectiveValue,
  OptimizationRequest,
  ParamValue,
  Run,
  RunRow,
  SweepParam,
  Variable,
} from '../types';
import fmusFixture from './fixtures/fmus.json';
import variablesFixture from './fixtures/variables.json';

export const MOCK_FMU_ID = (fmusFixture as FmuSummary[])[0].id;

const MISSING_EVALUATE = 'evaluate 함수가 정의되지 않았습니다';

/** 문자열 → 32bit 해시 (FNV-1a) */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mockCodeHash(code: string): string {
  return [hash32(code), hash32('a' + code), hash32('b' + code), hash32('c' + code)]
    .map(n => n.toString(16).padStart(8, '0'))
    .join('');
}

function unit(seed: string): number {
  return hash32(seed) / 0xffffffff;
}

function expandValues(p: SweepParam): number[] {
  if (p.mode === 'list') return p.values;
  if (p.steps <= 1) return [p.min];
  return Array.from({ length: p.steps }, (_, i) => p.min + ((p.max - p.min) * i) / (p.steps - 1));
}

function generateCases(req: BatchRequest): Record<string, number>[] {
  const lists = req.params.map(p => ({ name: p.name, values: expandValues(p) }));
  if (lists.length === 0) return [];
  if (req.sampling === 'zip') {
    return lists[0].values.map((_, i) => Object.fromEntries(lists.map(l => [l.name, l.values[i]])));
  }
  if (req.sampling === 'lhs' || req.sampling === 'random') {
    const n = req.nSamples ?? 10;
    return Array.from({ length: n }, (_, i) =>
      Object.fromEntries(req.params.map(p => {
        const lo = p.mode === 'range' ? p.min : Math.min(...p.values);
        const hi = p.mode === 'range' ? p.max : Math.max(...p.values);
        return [p.name, lo + (hi - lo) * unit(`${req.name}:${p.name}:${i}`)];
      })));
  }
  return lists.reduce<Record<string, number>[]>(
    (acc, l) => acc.flatMap(c => l.values.map(v => ({ ...c, [l.name]: v }))),
    [{}],
  );
}

/** mock 목적함수: 코드 해시가 정하는 최적점까지의 거리 제곱합 */
function evaluateMock(code: string, run: Run): ObjectiveValue {
  if (run.status !== 'ok') return { value: null, error: '시뮬레이션 실패' };
  if (!/def\s+evaluate\s*\(/.test(code)) return { value: null, error: MISSING_EVALUATE };
  const nums = Object.values(run.params).filter((v): v is number => typeof v === 'number');
  const center = unit(code);
  const value = nums.reduce((s, v) => s + (v - center) ** 2, 0) + unit(code + run.id) * 0.01;
  return { value, error: null };
}

function now() {
  return new Date().toISOString();
}

type Listener = (e: JobEvent) => void;

type JobState = {
  job: Job;
  cases: Record<string, ParamValue>[];
  timer: ReturnType<typeof setInterval> | null;
  listeners: Set<Listener>;
};

export function createMockClient(opts: { tickMs?: number } = {}): ApiClient {
  const tickMs = opts.tickMs ?? 400;
  const fmus = new Map<string, FmuSummary>((fmusFixture as FmuSummary[]).map(f => [f.id, { ...f }]));
  const variables = variablesFixture as Variable[];
  const objectives = new Map<string, Objective>();
  const jobs = new Map<string, JobState>();
  const runs = new Map<string, Run>();
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}${(++seq).toString().padStart(6, '0')}`;

  function emit(st: JobState, e: JobEvent) {
    st.listeners.forEach(l => l(e));
  }

  function finish(st: JobState, status: Job['status']) {
    if (st.timer) clearInterval(st.timer);
    st.timer = null;
    st.job = { ...st.job, status, finishedAt: now() };
    emit(st, { type: 'end', job: st.job });
  }

  function startJob(job: Job, cases: Record<string, ParamValue>[]): Job {
    const st: JobState = { job, cases, timer: null, listeners: new Set() };
    jobs.set(job.id, st);
    st.timer = setInterval(() => {
      if (st.job.status === 'queued') st.job = { ...st.job, status: 'running' };
      const index = st.job.completed + st.job.failed;
      if (index >= st.cases.length) return finish(st, 'done');
      const params = st.cases[index];
      const failed = unit(`${job.id}:${index}`) < 0.05;
      const run: Run = {
        id: nextId('run'), jobId: job.id, fmuId: job.fmuId, index, params,
        status: failed ? 'failed' : 'ok', error: failed ? 'CVode: convergence test failed' : null,
        elapsedSec: 3 + unit(`e${index}`) * 4,
      };
      runs.set(run.id, run);
      const fmu = fmus.get(job.fmuId);
      if (fmu) fmu.nRuns += 1;
      st.job = { ...st.job, completed: st.job.completed + (failed ? 0 : 1), failed: st.job.failed + (failed ? 1 : 0) };
      emit(st, { type: 'run', run });
      emit(st, { type: 'progress', job: st.job });
      if (st.job.completed + st.job.failed >= st.cases.length) finish(st, 'done');
    }, tickMs);
    return job;
  }

  function newJob(kind: Job['kind'], req: BatchRequest | OptimizationRequest, total: number): Job {
    if (!fmus.has(req.fmuId)) throw new ApiError('FMU를 찾을 수 없습니다', 404);
    return {
      id: nextId('job'), kind, name: req.name, fmuId: req.fmuId, status: 'queued', total,
      completed: 0, failed: 0, createdAt: now(), finishedAt: null, error: null, config: req,
      objectiveSnapshot: null,
    };
  }

  function getObj(id: string): Objective {
    const o = objectives.get(id);
    if (!o) throw new ApiError('목적함수를 찾을 수 없습니다', 404);
    return o;
  }

  function getState(id: string): JobState {
    const st = jobs.get(id);
    if (!st) throw new ApiError('잡을 찾을 수 없습니다', 404);
    return st;
  }

  return {
    async health() {
      return { status: 'ok', parallelBackend: 'ray' };
    },

    async listFmus() {
      return [...fmus.values()].map(f => ({ ...f }));
    },
    async uploadFmu(file) {
      const id = mockCodeHash(file.name).slice(0, 16);
      if (!fmus.has(id)) {
        const base = (fmusFixture as FmuSummary[])[0];
        fmus.set(id, { ...base, id, fileName: file.name, uploadedAt: now(), nRuns: 0 });
      }
      return { ...fmus.get(id)! };
    },
    async getFmu(id) {
      const f = fmus.get(id);
      if (!f) throw new ApiError('FMU를 찾을 수 없습니다', 404);
      return { ...f };
    },
    async deleteFmu(id) {
      if ([...runs.values()].some(r => r.fmuId === id)) {
        throw new ApiError('이 FMU에 저장된 해석 결과가 있어 삭제할 수 없습니다', 409);
      }
      fmus.delete(id);
    },
    async listVariables(fmuId, { q = '', causality, offset = 0, limit = 100 }) {
      if (!fmus.has(fmuId)) throw new ApiError('FMU를 찾을 수 없습니다', 404);
      const needle = q.toLowerCase();
      const matched = variables.filter(v =>
        (!causality || causality === 'all' || v.causality === causality) &&
        (!needle || v.name.toLowerCase().includes(needle) || (v.description ?? '').toLowerCase().includes(needle)));
      return { total: matched.length, items: matched.slice(offset, offset + limit) };
    },

    async listObjectives() {
      return [...objectives.values()].map(o => ({ ...o }));
    },
    async getObjective(id) {
      return { ...getObj(id) };
    },
    async createObjective({ name, code }) {
      if ([...objectives.values()].some(o => o.name === name)) {
        throw new ApiError('같은 이름의 목적함수가 이미 있습니다', 409);
      }
      const o: Objective = { id: nextId('obj'), name, code, codeHash: mockCodeHash(code), updatedAt: now() };
      objectives.set(o.id, o);
      return { ...o };
    },
    async updateObjective(id, { name, code }) {
      const cur = getObj(id);
      if ([...objectives.values()].some(o => o.name === name && o.id !== id)) {
        throw new ApiError('같은 이름의 목적함수가 이미 있습니다', 409);
      }
      const o: Objective = { ...cur, name, code, codeHash: mockCodeHash(code), updatedAt: now() };
      objectives.set(id, o);
      return { ...o };
    },
    async deleteObjective(id) {
      getObj(id);
      objectives.delete(id);
    },
    async testObjective({ code, runId }) {
      const run = runs.get(runId);
      if (!run) throw new ApiError('run을 찾을 수 없습니다', 404);
      return { ...evaluateMock(code, run), stdout: '', durationMs: 12 };
    },

    async createBatch(req) {
      const cases = generateCases(req).map(c => ({ ...req.fixedParams, ...c }));
      return { ...startJob(newJob('batch', req, cases.length), cases) };
    },
    async createOptimization(req) {
      if (req.objectives.length === 0) throw new ApiError('목적함수를 하나 이상 선택하세요', 422);
      if (req.algorithm === 'cmaes' && req.objectives.length > 1) {
        throw new ApiError('CMA-ES는 단일 목적만 지원합니다', 422);
      }
      const job = newJob('optimization', req, req.nTrials);
      job.objectiveSnapshot = Object.fromEntries(req.objectives.map(o => {
        const obj = getObj(o.objectiveId);
        return [obj.id, { name: obj.name, codeHash: obj.codeHash }];
      }));
      const cases = Array.from({ length: req.nTrials }, (_, i) => ({
        ...req.fixedParams,
        ...Object.fromEntries(req.designVars.map(d => {
          const v = d.min + (d.max - d.min) * unit(`${job.id}:${d.name}:${i}`);
          return [d.name, d.kind === 'int' ? Math.round(v) : v];
        })),
      }));
      return { ...startJob(job, cases) };
    },
    async listJobs(q = {}) {
      return [...jobs.values()]
        .map(s => s.job)
        .filter(j => !q.fmuId || j.fmuId === q.fmuId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    },
    async getJob(id) {
      return { ...getState(id).job };
    },
    async cancelJob(id) {
      const st = getState(id);
      if (st.job.status === 'queued' || st.job.status === 'running') finish(st, 'cancelled');
      return { ...st.job };
    },
    subscribeJob(id, onEvent) {
      const st = jobs.get(id);
      if (!st) return () => {};
      st.listeners.add(onEvent);
      onEvent({ type: 'progress', job: st.job });
      if (!['queued', 'running'].includes(st.job.status)) onEvent({ type: 'end', job: st.job });
      return () => st.listeners.delete(onEvent);
    },

    async listRuns(q) {
      const rows = [...runs.values()].filter(r =>
        (!q.fmuId || r.fmuId === q.fmuId) &&
        (!q.jobIds?.length || q.jobIds.includes(r.jobId)) &&
        (!q.status || r.status === q.status));
      const objIds = q.objectiveIds ?? [];
      const objs = objIds.map(getObj);
      let out: RunRow[] = rows.map(r => ({
        ...r,
        objectives: Object.fromEntries(objs.map(o => [o.id, evaluateMock(o.code, r)])),
      }));
      const dir = q.sortDir === 'desc' ? -1 : 1;
      const sortBy = q.sortBy ?? 'index';
      const key = (r: RunRow): number | null => {
        if (sortBy === 'index') return r.index;
        if (sortBy === 'elapsedSec') return r.elapsedSec;
        if (sortBy.startsWith('param:')) {
          const v = r.params[sortBy.slice(6)];
          return typeof v === 'number' ? v : v === undefined ? null : Number(v);
        }
        return r.objectives[sortBy.slice(10)]?.value ?? null;
      };
      out = out.sort((a, b) => {
        const ka = key(a), kb = key(b);
        if (ka === null && kb === null) return 0;
        if (ka === null) return 1;
        if (kb === null) return -1;
        return (ka - kb) * dir || a.jobId.localeCompare(b.jobId) || a.index - b.index;
      });
      const offset = q.offset ?? 0;
      const limit = q.limit ?? 100;
      return {
        total: out.length,
        items: out.slice(offset, offset + limit),
        codeHashes: Object.fromEntries(objs.map(o => [o.id, o.codeHash])),
      };
    },
    async getTimeseries(runId, vars, maxPoints = 2000) {
      const run = runs.get(runId);
      if (!run) throw new ApiError('run을 찾을 수 없습니다', 404);
      const cfg = jobs.get(run.jobId)!.job.config;
      const { startTime, stopTime, outputInterval } = cfg.sim;
      const n = Math.min(maxPoints, Math.floor((stopTime - startTime) / outputInterval) + 1);
      const time = Array.from({ length: n }, (_, i) => startTime + ((stopTime - startTime) * i) / Math.max(n - 1, 1));
      const gain = 1 + Object.values(run.params).reduce<number>((s, v) => s + (typeof v === 'number' ? v : 0), 0) * 0.1;
      const series = Object.fromEntries(vars.map(name => {
        const f = 0.01 + unit(name) * 0.05;
        const phase = unit(name + 'p') * Math.PI;
        return [name, time.map(t => gain * Math.sin(f * t + phase) + 0.05 * Math.sin(7 * f * t))];
      }));
      return { time, series };
    },
  };
}
