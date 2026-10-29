// 설정 폼 ↔ 프리셋 변환 (최적화·배치). 다른 FMU에 불러올 때 없는 항목은 빼고 경고로 알린다.
import type {
  Algorithm, BatchPresetConfig, BatchRequest, DesignVar, Direction, Job, OptimizationRequest, OptPresetConfig, OptResource,
  ParamValue, Preset, PresetResource, PresetRunConfig, ResourceFile, Sampling, SweepParam, Variable,
} from '../api/types';
import type { RunSettings } from '../components/RunSettingsSection';
import { defaultBounds, parseList, type SweepRow } from './sweep';

const ALGO_LABEL: Record<Algorithm, string> = { tpe: 'TPE', gp: 'GP', cmaes: 'CMA-ES', random: 'Random', nsga2: 'NSGA-II' };

function optSummary(c: Pick<OptPresetConfig, 'designVars' | 'objectives' | 'algorithm' | 'nTrials'>): string {
  return `설계 변수 ${c.designVars.length} · 목적 ${c.objectives.length} · ${ALGO_LABEL[c.algorithm]} · ${c.nTrials} trials`;
}

function batchSummary(c: { params: unknown[]; sampling: Sampling; nSamples: number | null; resources?: Record<string, string[]> }): string {
  const sampled = c.sampling === 'lhs' || c.sampling === 'random';
  const files = Object.keys(c.resources ?? {}).length;
  return `파라미터 ${c.params.length} · ${c.sampling}${sampled ? ` ${c.nSamples}개` : ''}${files ? ` · Resource 파일 ${files}` : ''}`;
}

export function presetSummary(p: Preset): string {
  if (p.kind === 'dashboard') return `레이아웃 ${p.config.layout} · 패널 ${p.config.panels.length}개`;
  return p.kind === 'optimization' ? optSummary(p.config) : batchSummary(p.config);
}

export function jobSummary(j: Job): string {
  return j.kind === 'optimization' ? optSummary(j.config as OptimizationRequest) : batchSummary(j.config as BatchRequest);
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(b);
  return a.every(x => s.has(x));
}

function shaOf(files: ResourceFile[], path: string, id: string): string | undefined {
  return files.find(f => f.path === path)?.candidates.find(c => c.id === id)?.sha256;
}

/** 공통 실행 설정. 기록 변수가 출력 전체와 같으면 null로 남겨 다른 FMU에서도 "출력 전체"가 되게 한다. */
function runToConfig(s: RunSettings, plotVariables: string[], allOutputs: string[]): PresetRunConfig {
  const record = s.recordVariables;
  return {
    fixedParams: { ...s.fixedParams },
    sim: { ...s.sim },
    recordVariables: allOutputs.length && sameSet(record, allOutputs) ? null : [...record],
    plotVariables: plotVariables.filter(v => record.includes(v)),
    workers: s.workers,
    runTimeoutSec: s.runTimeoutSec,
  };
}

function requestSettings(req: OptimizationRequest | BatchRequest): RunSettings {
  return {
    sim: req.sim, recordVariables: req.recordVariables, fixedParams: req.fixedParams,
    workers: req.workers, runTimeoutSec: req.runTimeoutSec,
  };
}

export type ApplyContext = {
  files: ResourceFile[];
  /** 대상 FMU의 모든 변수 */
  variables: Variable[];
};

const listOf = (names: string[]) => (names.length > 3 ? `${names.slice(0, 3).join(', ')} 외 ${names.length - 3}개` : names.join(', '));

/** 대상 FMU에 없는(또는 조건에 맞지 않는) 항목을 빼고 경고를 남기는 함수 */
function dropper(variables: Variable[], warnings: string[]) {
  const byName = new Map(variables.map(v => [v.name, v]));
  return <T>(items: T[], name: (x: T) => string, ok: (v: Variable) => boolean, what: string): T[] => {
    const kept = items.filter(x => { const v = byName.get(name(x)); return !!v && ok(v); });
    const lost = items.filter(x => !kept.includes(x)).map(name);
    if (lost.length) warnings.push(`${what} ${lost.length}개를 이 FMU에서 찾을 수 없어 뺐습니다: ${listOf(lost)}`);
    return kept;
  };
}

function applyRunConfig(cfg: PresetRunConfig, variables: Variable[], warnings: string[]) {
  const drop = dropper(variables, warnings);
  const fixedEntries = drop(Object.entries(cfg.fixedParams), ([k]) => k, () => true, '고정 파라미터');
  const outputs = variables.filter(v => v.causality === 'output').map(v => v.name);
  const record = cfg.recordVariables === null ? outputs : drop(cfg.recordVariables, n => n, () => true, '기록 변수');
  const plotVariables = cfg.plotVariables.filter(v => record.includes(v));
  if (plotVariables.length < cfg.plotVariables.length) {
    warnings.push(`표시 변수 ${cfg.plotVariables.length - plotVariables.length}개는 기록되지 않아 뺐습니다`);
  }
  const settings: RunSettings = {
    sim: { ...cfg.sim },
    recordVariables: record,
    fixedParams: Object.fromEntries(fixedEntries) as Record<string, ParamValue>,
    workers: cfg.workers,
    runTimeoutSec: cfg.runTimeoutSec,
  };
  return { settings, plotVariables };
}

// ---------- 최적화 ----------

export type OptForm = {
  vars: DesignVar[];
  objectiveIds: string[];
  directions: Record<string, Direction>;
  algorithm: Algorithm;
  nTrials: number;
  resourceSel: Record<string, OptResource>;
  settings: RunSettings;
  plotVariables: string[];
};

/** 후보 id → sha256. 원본 고정은 기본값이라 뺀다. */
export function toPresetResources(files: ResourceFile[], sel: Record<string, OptResource>): Record<string, PresetResource> {
  const out: Record<string, PresetResource> = {};
  for (const [path, r] of Object.entries(sel)) {
    const f = files.find(x => x.path === path);
    if (!f) continue;
    if (r.mode === 'fixed') {
      const sha = shaOf(files, path, r.candidateId);
      if (sha && r.candidateId !== f.candidates[0].id) out[path] = { mode: 'fixed', sha256: sha };
    } else {
      out[path] = { mode: 'search', sha256s: r.candidateIds.map(id => shaOf(files, path, id)).filter((s): s is string => !!s) };
    }
  }
  return out;
}

export function formToPresetConfig(form: OptForm, files: ResourceFile[], allOutputs: string[]): OptPresetConfig {
  return {
    designVars: form.vars.map(v => ({ ...v })),
    objectives: form.objectiveIds.map(id => ({ objectiveId: id, direction: form.directions[id] ?? 'minimize' })),
    algorithm: form.algorithm,
    nTrials: form.nTrials,
    ...runToConfig(form.settings, form.plotVariables, allOutputs),
    resources: toPresetResources(files, form.resourceSel),
  };
}

/** 지난 잡 설정 → 프리셋 (같은 FMU의 resource 목록으로 후보 id를 sha256으로 바꾼다) */
export function requestToPresetConfig(req: OptimizationRequest, files: ResourceFile[], allOutputs: string[]): OptPresetConfig {
  return formToPresetConfig({
    vars: req.designVars,
    objectiveIds: req.objectives.map(o => o.objectiveId),
    directions: Object.fromEntries(req.objectives.map(o => [o.objectiveId, o.direction])),
    algorithm: req.algorithm,
    nTrials: req.nTrials,
    resourceSel: req.resources ?? {},
    settings: requestSettings(req),
    plotVariables: req.plotVariables ?? [],
  }, files, allOutputs);
}

export type OptApplyContext = ApplyContext & { objectiveIds: string[]; gpAvailable: boolean };

function applyOptResources(cfg: OptPresetConfig, files: ResourceFile[], warnings: string[]): Record<string, OptResource> {
  const out: Record<string, OptResource> = {};
  for (const [path, r] of Object.entries(cfg.resources)) {
    const f = files.find(x => x.path === path);
    if (!f) {
      warnings.push(`resource 파일 ${path}이(가) 이 FMU에 없어 뺐습니다`);
      continue;
    }
    const idOf = (sha: string) => f.candidates.find(c => c.sha256 === sha)?.id;
    if (r.mode === 'fixed') {
      const id = idOf(r.sha256);
      if (id) out[path] = { mode: 'fixed', candidateId: id };
      else warnings.push(`${path}: 저장한 후보가 이 FMU에 없어 원본을 씁니다 (Resources 탭에서 올리면 다시 쓸 수 있습니다)`);
    } else {
      const ids = r.sha256s.map(idOf).filter((id): id is string => !!id);
      const lost = r.sha256s.length - ids.length;
      if (lost) warnings.push(`${path}: 탐색 후보 ${lost}개가 이 FMU에 없습니다`);
      if (ids.length >= 2 || (ids.length === 1 && !lost)) out[path] = { mode: 'search', candidateIds: ids };
      else if (ids.length === 1) out[path] = { mode: 'fixed', candidateId: ids[0] };
    }
  }
  return out;
}

function normalizeAlgorithm(algo: Algorithm, multi: boolean, search: boolean, gpAvailable: boolean, warnings: string[]): Algorithm {
  let next = algo;
  if (next === 'gp' && !gpAvailable) next = multi ? 'nsga2' : 'tpe';
  if (multi && next === 'cmaes') next = 'nsga2';
  if (!multi && next === 'nsga2') next = 'tpe';
  if (!multi && search && next === 'cmaes') next = 'tpe';
  if (next !== algo) warnings.push(`알고리즘 ${ALGO_LABEL[algo]}을(를) 쓸 수 없어 ${ALGO_LABEL[next]}(으)로 바꿨습니다`);
  return next;
}

/** 프리셋 → 대상 FMU의 최적화 폼. 잡 이름은 바꾸지 않는다. */
export function applyPresetConfig(cfg: OptPresetConfig, ctx: OptApplyContext): { form: OptForm; warnings: string[] } {
  const warnings: string[] = [];
  const vars = dropper(ctx.variables, warnings)(cfg.designVars, v => v.name, v => v.causality === 'parameter', '설계 변수');
  const run = applyRunConfig(cfg, ctx.variables, warnings);

  const existing = new Set(ctx.objectiveIds);
  const objectives = cfg.objectives.filter(o => existing.has(o.objectiveId));
  if (objectives.length < cfg.objectives.length) {
    warnings.push(`목적함수 ${cfg.objectives.length - objectives.length}개가 삭제되어 뺐습니다`);
  }

  const resourceSel = applyOptResources(cfg, ctx.files, warnings);
  const search = Object.values(resourceSel).some(r => r.mode === 'search');
  const algorithm = normalizeAlgorithm(cfg.algorithm, objectives.length > 1, search, ctx.gpAvailable, warnings);

  return {
    form: {
      vars: vars.map(v => ({ ...v })),
      objectiveIds: objectives.map(o => o.objectiveId),
      directions: Object.fromEntries(objectives.map(o => [o.objectiveId, o.direction])),
      algorithm,
      nTrials: cfg.nTrials,
      resourceSel,
      ...run,
    },
    warnings,
  };
}

// ---------- 배치 ----------

export type BatchForm = {
  rows: SweepRow[];
  sampling: Sampling;
  nSamples: number;
  resourceSel: Record<string, string[]>;
  settings: RunSettings;
  plotVariables: string[];
};

/** 후보 id 목록 → sha256 목록. 원본 하나만 고른 파일은 기본값이라 뺀다. */
function toBatchPresetResources(files: ResourceFile[], sel: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [path, ids] of Object.entries(sel)) {
    const f = files.find(x => x.path === path);
    if (!f || (ids.length === 1 && ids[0] === f.candidates[0].id)) continue;
    out[path] = ids.map(id => shaOf(files, path, id)).filter((s): s is string => !!s);
  }
  return out;
}

function batchConfig(
  params: SweepParam[], sampling: Sampling, nSamples: number, sel: Record<string, string[]>,
  settings: RunSettings, plotVariables: string[], files: ResourceFile[], allOutputs: string[],
): BatchPresetConfig {
  return {
    params, sampling, nSamples,
    ...runToConfig(settings, plotVariables, allOutputs),
    resources: toBatchPresetResources(files, sel),
  };
}

export function batchFormToPresetConfig(form: BatchForm, files: ResourceFile[], allOutputs: string[]): BatchPresetConfig {
  // 입력 중인(잘못된) 목록도 저장한다: 값은 빈 목록으로
  const params: SweepParam[] = form.rows.map(r => (r.mode === 'range'
    ? { name: r.name, mode: 'range', min: r.min, max: r.max, steps: r.steps }
    : { name: r.name, mode: 'list', values: parseList(r.text) ?? [] }));
  return batchConfig(params, form.sampling, form.nSamples, form.resourceSel, form.settings, form.plotVariables, files, allOutputs);
}

export const DEFAULT_N_SAMPLES = 20;

export function batchRequestToPresetConfig(req: BatchRequest, files: ResourceFile[], allOutputs: string[]): BatchPresetConfig {
  // grid/zip 잡에는 샘플 수가 없으니 화면 기본값을 넣는다
  return batchConfig(req.params, req.sampling, req.nSamples ?? DEFAULT_N_SAMPLES, req.resources ?? {},
    requestSettings(req), req.plotVariables ?? [], files, allOutputs);
}

function applyBatchResources(cfg: BatchPresetConfig, files: ResourceFile[], warnings: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [path, shas] of Object.entries(cfg.resources)) {
    const f = files.find(x => x.path === path);
    if (!f) {
      warnings.push(`resource 파일 ${path}이(가) 이 FMU에 없어 뺐습니다`);
      continue;
    }
    const ids = shas.map(sha => f.candidates.find(c => c.sha256 === sha)?.id).filter((id): id is string => !!id);
    const lost = shas.length - ids.length;
    if (lost) warnings.push(`${path}: 저장한 후보 ${lost}개가 이 FMU에 없습니다${ids.length ? '' : ' (원본을 씁니다)'}`);
    if (ids.length) out[path] = ids;
  }
  return out;
}

/** 프리셋 → 대상 FMU의 배치 폼 */
export function applyBatchPresetConfig(cfg: BatchPresetConfig, ctx: ApplyContext): { form: BatchForm; warnings: string[] } {
  const warnings: string[] = [];
  const params = dropper(ctx.variables, warnings)(cfg.params, p => p.name, v => v.causality === 'parameter', '스윕 파라미터');
  const start = (name: string) => ctx.variables.find(v => v.name === name)?.start;
  const rows: SweepRow[] = params.map(p => {
    const s = start(p.name);
    return p.mode === 'range'
      ? { name: p.name, mode: 'range', text: String(typeof s === 'number' ? s : 0), min: p.min, max: p.max, steps: p.steps }
      : { name: p.name, mode: 'list', text: p.values.join(', '), ...defaultBounds(s), steps: 3 };
  });
  const resourceSel = applyBatchResources(cfg, ctx.files, warnings);
  const run = applyRunConfig(cfg, ctx.variables, warnings);
  return { form: { rows, sampling: cfg.sampling, nSamples: cfg.nSamples, resourceSel, ...run }, warnings };
}
