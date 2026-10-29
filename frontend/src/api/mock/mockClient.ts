// 메모리 기반 mock ApiClient — Phase 1 UI 개발용. 백엔드 동작을 흉내 낸다:
// - 배치 잡은 목적함수를 계산하지 않는다.
// - 목적함수 값은 listRuns 호출 시점의 현재 코드로 계산한다 (코드가 바뀌면 값도 바뀐다).
import { ApiError, type ApiClient } from '../client';
import type {
  BatchRequest,
  CandidatePreview,
  FmuSummary,
  Job,
  JobEvent,
  Objective,
  ObjectiveValue,
  OptimizationRequest,
  ParamValue,
  ResourceCandidate,
  Run,
  RunRow,
  Variable,
  Variant,
} from '../types';
import fmusFixture from './fixtures/fmus.json';
import resourcesFixture from './fixtures/resources.json';
import variablesFixture from './fixtures/variables.json';
import { expandValues } from '../../lib/sweep';

export const MOCK_FMU_ID = (fmusFixture as FmuSummary[])[0].id;
export const MOCK_NEDC_PATH = 'NEDC.mat';
export const MOCK_TIR_PATH = 'tire.tir';

type ResourceFixture = { path: string; size: number; sha256: string; kind: string; text?: string };
type MockCandidate = Omit<ResourceCandidate, 'nRuns'>;
type MockResource = { path: string; size: number; sha256: string; candidates: MockCandidate[] };
type MockVariant = Omit<Variant, 'nRuns' | 'label'>;
type MockCase = { params: Record<string, ParamValue>; variantId: string };

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

/** mock 목적함수: 코드 해시가 정하는 최적점까지의 거리 제곱합 (+ 원본이 아닌 resource 조합이면 조합별 오프셋) */
function evaluateMock(code: string, run: Run, originalVariant: boolean): ObjectiveValue {
  if (run.status !== 'ok') return { value: null, error: '시뮬레이션 실패' };
  if (!/def\s+evaluate\s*\(/.test(code)) return { value: null, error: MISSING_EVALUATE };
  const nums = Object.values(run.params).filter((v): v is number => typeof v === 'number');
  const center = unit(code);
  const value = nums.reduce((s, v) => s + (v - center) ** 2, 0) + unit(code + run.id) * 0.01
    + (originalVariant ? 0 : unit(code + run.variantId) * 0.5);
  return { value, error: null };
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i).toLowerCase();
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** path 정렬 순 직곱 */
function resourceCombos(sel: Record<string, string[]>): Record<string, string>[] {
  return Object.keys(sel).sort().reduce<Record<string, string>[]>(
    (acc, path) => acc.flatMap(c => sel[path].map(id => ({ ...c, [path]: id }))),
    [{}],
  );
}

/** File 내용을 텍스트로 (jsdom의 File에는 text()가 없다) */
function readText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function now() {
  return new Date().toISOString();
}

type Listener = (e: JobEvent) => void;

type JobState = {
  job: Job;
  cases: MockCase[];
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
  const resources = new Map<string, MockResource[]>();
  const contents = new Map<string, string>(); // 후보 id -> 텍스트 내용 (미리보기용)
  const variants = new Map<string, MockVariant>();
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}${(++seq).toString().padStart(6, '0')}`;

  function candidateId(fmuId: string, path: string, sha: string) {
    return mockCodeHash(`${fmuId}:${path}:${sha}`).slice(0, 16);
  }

  function initResources(fmuId: string) {
    const list = (resourcesFixture as ResourceFixture[]).map(r => {
      const id = candidateId(fmuId, r.path, r.sha256);
      if (r.text) contents.set(id, r.text);
      return {
        path: r.path, size: r.size, sha256: r.sha256,
        candidates: [{ id, path: r.path, name: basename(r.path), size: r.size, sha256: r.sha256, isOriginal: true, createdAt: now() }],
      };
    });
    resources.set(fmuId, list);
    ensureVariant(fmuId, {});
  }

  function getResources(fmuId: string): MockResource[] {
    if (!fmus.has(fmuId)) throw new ApiError('FMU를 찾을 수 없습니다', 404);
    return resources.get(fmuId)!;
  }

  function findCandidate(fmuId: string, id: string): MockCandidate | null {
    for (const r of resources.get(fmuId) ?? []) {
      const c = r.candidates.find(x => x.id === id);
      if (c) return c;
    }
    return null;
  }

  /** assignment(path -> 후보 id)에서 원본을 뺀 조합의 variant를 찾거나 만든다 */
  function ensureVariant(fmuId: string, assignment: Record<string, string>): string {
    const replaced: Record<string, string> = {};
    const pairs: string[] = [];
    for (const path of Object.keys(assignment).sort()) {
      const c = findCandidate(fmuId, assignment[path]);
      if (!c || c.path !== path) throw new ApiError(`${path}의 후보가 아닙니다: ${assignment[path]}`, 422);
      if (c.isOriginal) continue;
      replaced[path] = c.id;
      pairs.push(`\n${path}=${c.sha256}`);
    }
    const id = mockCodeHash(fmuId + pairs.join('')).slice(0, 16);
    if (!variants.has(id)) variants.set(id, { id, fmuId, assignment: replaced, isOriginal: pairs.length === 0 });
    return id;
  }

  function variantLabel(v: MockVariant): string {
    if (v.isOriginal) return '원본';
    return Object.keys(v.assignment).sort()
      .map(path => `${basename(path)}=${findCandidate(v.fmuId, v.assignment[path])?.name ?? '?'}`).join(', ');
  }

  function variantRuns(id: string): number {
    return [...runs.values()].filter(r => r.variantId === id).length;
  }

  function candidateRuns(fmuId: string, c: MockCandidate): number {
    return [...variants.values()]
      .filter(v => v.fmuId === fmuId && (c.isOriginal ? !(c.path in v.assignment) : v.assignment[c.path] === c.id))
      .reduce((n, v) => n + variantRuns(v.id), 0);
  }

  function isOriginalVariant(id: string) {
    return variants.get(id)?.isOriginal ?? true;
  }

  for (const id of fmus.keys()) initResources(id);

  function emit(st: JobState, e: JobEvent) {
    st.listeners.forEach(l => l(e));
  }

  function finish(st: JobState, status: Job['status']) {
    if (st.timer) clearInterval(st.timer);
    st.timer = null;
    st.job = { ...st.job, status, finishedAt: now() };
    emit(st, { type: 'end', job: st.job });
  }

  function startJob(job: Job, cases: MockCase[]): Job {
    const st: JobState = { job, cases, timer: null, listeners: new Set() };
    jobs.set(job.id, st);
    st.timer = setInterval(() => {
      if (st.job.status === 'queued') st.job = { ...st.job, status: 'running' };
      const index = st.job.completed + st.job.failed;
      if (index >= st.cases.length) return finish(st, 'done');
      const { params, variantId } = st.cases[index];
      const failed = unit(`${job.id}:${index}`) < 0.05;
      const run: Run = {
        id: nextId('run'), jobId: job.id, fmuId: job.fmuId, index, params,
        status: failed ? 'failed' : 'ok', error: failed ? 'CVode: convergence test failed' : null,
        elapsedSec: 3 + unit(`e${index}`) * 4, variantId,
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
      return { status: 'ok', parallelBackend: 'ray', gpAvailable: false };
    },

    async listFmus() {
      return [...fmus.values()].map(f => ({ ...f }));
    },
    async uploadFmu(file) {
      const id = mockCodeHash(file.name).slice(0, 16);
      if (!fmus.has(id)) {
        const base = (fmusFixture as FmuSummary[])[0];
        fmus.set(id, { ...base, id, fileName: file.name, uploadedAt: now(), nRuns: 0 });
        initResources(id);
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
      resources.delete(id);
      for (const v of [...variants.values()]) if (v.fmuId === id) variants.delete(v.id);
    },
    async listVariables(fmuId, { q = '', causality, offset = 0, limit = 100 }) {
      if (!fmus.has(fmuId)) throw new ApiError('FMU를 찾을 수 없습니다', 404);
      const needle = q.toLowerCase();
      const matched = variables.filter(v =>
        (!causality || causality === 'all' || v.causality === causality) &&
        (!needle || v.name.toLowerCase().includes(needle) || (v.description ?? '').toLowerCase().includes(needle)));
      return { total: matched.length, items: matched.slice(offset, offset + limit) };
    },

    async listResources(fmuId) {
      return getResources(fmuId).map(r => ({
        path: r.path, size: r.size, sha256: r.sha256,
        candidates: r.candidates.map(c => ({ ...c, nRuns: candidateRuns(fmuId, c) })),
      }));
    },
    async uploadCandidate(fmuId, path, file) {
      const res = getResources(fmuId).find(r => r.path === path);
      if (!res) throw new ApiError(`resource 파일이 없습니다: ${path}`, 404);
      const ext = extOf(path);
      if (extOf(file.name) !== ext) throw new ApiError(`원본과 같은 확장자(${ext})의 파일만 올릴 수 있습니다`, 400);
      const text = await readText(file);
      const sha = mockCodeHash(text) + mockCodeHash('x' + text);
      const found = res.candidates.find(c => c.sha256 === sha);
      if (found) return { ...found, nRuns: candidateRuns(fmuId, found), existing: true };
      const c = { id: candidateId(fmuId, path, sha), path, name: file.name, size: file.size, sha256: sha, isOriginal: false, createdAt: now() };
      res.candidates.push(c);
      contents.set(c.id, text);
      return { ...c, nRuns: 0, existing: false };
    },
    async deleteCandidate(fmuId, candidateId) {
      getResources(fmuId);
      const c = findCandidate(fmuId, candidateId);
      if (!c) throw new ApiError('후보를 찾을 수 없습니다', 404);
      if (c.isOriginal) throw new ApiError('원본 파일은 삭제할 수 없습니다', 400);
      if (candidateRuns(fmuId, c)) throw new ApiError('이 후보로 해석한 결과가 있어 삭제할 수 없습니다', 409);
      const res = getResources(fmuId).find(r => r.path === c.path)!;
      res.candidates = res.candidates.filter(x => x.id !== candidateId);
      for (const v of [...variants.values()]) if (v.assignment[c.path] === candidateId) variants.delete(v.id);
    },
    async previewCandidate(fmuId, candidateId, varName): Promise<CandidatePreview> {
      getResources(fmuId);
      const c = findCandidate(fmuId, candidateId);
      if (!c) throw new ApiError('후보를 찾을 수 없습니다', 404);
      if (extOf(c.path) === '.mat') {
        const variables = [{ name: 'table', shape: [119, 3], dtype: 'float64' }];
        const rows = Array.from({ length: 20 }, (_, i) => [i * 60, 10 + 40 * unit(`${c.id}:${i}`), i % 2]);
        return { kind: 'mat', variables, plot: varName ? { name: varName, rows } : null };
      }
      const text = contents.get(c.id);
      return text === undefined
        ? { kind: 'binary', note: '미리보기를 지원하지 않는 바이너리 파일입니다' }
        : { kind: 'text', text, truncated: false };
    },
    async listVariants(fmuId) {
      getResources(fmuId);
      return [...variants.values()].filter(v => v.fmuId === fmuId)
        .map(v => ({ ...v, label: variantLabel(v), nRuns: variantRuns(v.id) }));
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
      return { ...evaluateMock(code, run, isOriginalVariant(run.variantId)), stdout: '', durationMs: 12 };
    },

    async createBatch(req) {
      const sel = req.resources ?? {};
      getResources(req.fmuId);
      if (Object.values(sel).some(ids => ids.length === 0)) throw new ApiError('resource 후보를 하나 이상 고르세요', 422);
      const variantIds = resourceCombos(sel).map(a => ensureVariant(req.fmuId, a));
      const cases = generateCases(req)
        .flatMap(c => variantIds.map(variantId => ({ params: { ...req.fixedParams, ...c }, variantId })));
      return { ...startJob(newJob('batch', req, cases.length), cases) };
    },
    async createOptimization(req) {
      if (req.objectives.length === 0) throw new ApiError('목적함수를 하나 이상 선택하세요', 422);
      if (req.algorithm === 'cmaes' && req.objectives.length > 1) {
        throw new ApiError('CMA-ES는 단일 목적만 지원합니다', 422);
      }
      if (req.algorithm === 'gp') throw new ApiError('GP를 쓰려면 torch를 설치하세요 (pip install -e "backend[gp]")', 422);
      const res = req.resources ?? {};
      const searchCounts = Object.values(res).flatMap(r => (r.mode === 'search' ? [r.candidateIds.length] : []));
      if (searchCounts.some(n => n < 2)) throw new ApiError('탐색할 후보를 2개 이상 고르세요', 422);
      if (req.algorithm === 'cmaes' && searchCounts.length) {
        throw new ApiError('CMA-ES는 파일 탐색(선택형 변수)을 지원하지 않습니다', 422);
      }
      getResources(req.fmuId);
      const job = newJob('optimization', req, req.nTrials);
      job.objectiveSnapshot = Object.fromEntries(req.objectives.map(o => {
        const obj = getObj(o.objectiveId);
        return [obj.id, { name: obj.name, codeHash: obj.codeHash }];
      }));
      const pick = (path: string, i: number) => {
        const r = res[path];
        return r.mode === 'fixed' ? r.candidateId : r.candidateIds[Math.floor(unit(`${job.id}:${path}:${i}`) * r.candidateIds.length)];
      };
      const cases = Array.from({ length: req.nTrials }, (_, i) => ({
        params: {
          ...req.fixedParams,
          ...Object.fromEntries(req.designVars.map(d => {
            const v = d.min + (d.max - d.min) * unit(`${job.id}:${d.name}:${i}`);
            return [d.name, d.kind === 'int' ? Math.round(v) : v];
          })),
        },
        variantId: ensureVariant(req.fmuId, Object.fromEntries(Object.keys(res).map(path => [path, pick(path, i)]))),
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
        (!q.status || r.status === q.status) &&
        (!q.variantIds?.length || q.variantIds.includes(r.variantId)));
      const objIds = q.objectiveIds ?? [];
      const objs = objIds.map(getObj);
      let out: RunRow[] = rows.map(r => ({
        ...r,
        objectives: Object.fromEntries(objs.map(o => [o.id, evaluateMock(o.code, r, isOriginalVariant(r.variantId))])),
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
      const gain = (1 + Object.values(run.params).reduce<number>((s, v) => s + (typeof v === 'number' ? v : 0), 0) * 0.1)
        * (isOriginalVariant(run.variantId) ? 1 : 0.7 + unit(run.variantId) * 0.6);
      const series = Object.fromEntries(vars.map(name => {
        const f = 0.01 + unit(name) * 0.05;
        const phase = unit(name + 'p') * Math.PI;
        return [name, time.map(t => gain * Math.sin(f * t + phase) + 0.05 * Math.sin(7 * f * t))];
      }));
      return { time, series };
    },
  };
}
