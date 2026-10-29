import { describe, expect, test } from 'vitest';
import type { OptPresetConfig, ResourceFile, Variable } from '../api/types';
import {
  DEFAULT_N_SAMPLES, applyBatchPresetConfig, applyPresetConfig, batchFormToPresetConfig, batchRequestToPresetConfig,
  formToPresetConfig, type BatchForm, type OptForm,
} from './presets';

const SIM = { startTime: 0, stopTime: 10, tolerance: 1e-4, outputInterval: 0.1 };

function v(name: string, causality: string): Variable {
  return { name, causality, valueReference: 0, variability: 'tunable', type: 'Real', start: 1, unit: null, description: null };
}

function file(path: string, fmu: string, shas: string[]): ResourceFile {
  return {
    path, size: 1, sha256: shas[0],
    candidates: shas.map((sha, i) => ({
      id: `${fmu}-${sha}`, path, name: `${sha}.mat`, size: 1, sha256: sha, isOriginal: i === 0, nRuns: 0, createdAt: '',
    })),
  };
}

const form = (over: Partial<OptForm> = {}): OptForm => ({
  vars: [{ name: 'p1', min: 0, max: 1, kind: 'float' }],
  objectiveIds: ['o1', 'o2'],
  directions: { o2: 'maximize' },
  algorithm: 'nsga2',
  nTrials: 30,
  resourceSel: {},
  settings: { sim: SIM, recordVariables: ['y1', 'y2'], fixedParams: { p2: 3 }, workers: 2, runTimeoutSec: 60 },
  plotVariables: ['y2'],
  ...over,
});

describe('formToPresetConfig', () => {
  test('records all-outputs as null and candidates by sha256', () => {
    const files = [file('a.mat', 'F1', ['orig', 'k1', 'k2']), file('b.tir', 'F1', ['tb', 'tb2'])];
    const cfg = formToPresetConfig(form({
      resourceSel: {
        'a.mat': { mode: 'search', candidateIds: ['F1-orig', 'F1-k2'] },
        'b.tir': { mode: 'fixed', candidateId: 'F1-tb' },
      },
    }), files, ['y2', 'y1']);
    expect(cfg.recordVariables).toBeNull();
    expect(cfg.objectives).toEqual([{ objectiveId: 'o1', direction: 'minimize' }, { objectiveId: 'o2', direction: 'maximize' }]);
    // 원본 고정은 기본값이라 저장하지 않는다
    expect(cfg.resources).toEqual({ 'a.mat': { mode: 'search', sha256s: ['orig', 'k2'] } });
  });

  test('keeps an explicit record list and drops plot vars that are not recorded', () => {
    const cfg = formToPresetConfig(form({ plotVariables: ['y2', 'gone'] }), [], ['y1', 'y2', 'y3']);
    expect(cfg.recordVariables).toEqual(['y1', 'y2']);
    expect(cfg.plotVariables).toEqual(['y2']);
  });
});

describe('applyPresetConfig', () => {
  const base: OptPresetConfig = {
    designVars: [{ name: 'p1', min: 0, max: 1, kind: 'float' }, { name: 'missing', min: 0, max: 1, kind: 'int' }],
    objectives: [{ objectiveId: 'o1', direction: 'minimize' }, { objectiveId: 'deleted', direction: 'maximize' }],
    algorithm: 'nsga2', nTrials: 30, fixedParams: { p2: 3, nope: 1 }, sim: SIM,
    recordVariables: null, plotVariables: ['y1'], workers: 2, runTimeoutSec: 60,
    resources: {
      'a.mat': { mode: 'search', sha256s: ['orig', 'k1', 'k2'] },
      'b.tir': { mode: 'fixed', sha256: 'other' },
      'c.txt': { mode: 'fixed', sha256: 'x' },
    },
  };
  const ctx = {
    files: [file('a.mat', 'F2', ['orig', 'k2']), file('b.tir', 'F2', ['tb'])],
    variables: [v('p1', 'parameter'), v('p2', 'parameter'), v('y1', 'output'), v('y9', 'output'), v('loc', 'local')],
    objectiveIds: ['o1'],
    gpAvailable: false,
  };

  test('maps to the target FMU and reports everything that was dropped', () => {
    const { form: f, warnings } = applyPresetConfig(base, ctx);
    expect(f.vars.map(x => x.name)).toEqual(['p1']);
    expect(f.settings.fixedParams).toEqual({ p2: 3 });
    expect(f.settings.recordVariables).toEqual(['y1', 'y9']);
    expect(f.plotVariables).toEqual(['y1']);
    expect(f.objectiveIds).toEqual(['o1']);
    expect(f.resourceSel).toEqual({ 'a.mat': { mode: 'search', candidateIds: ['F2-orig', 'F2-k2'] } });
    // 목적함수가 하나만 남아 NSGA-II는 쓸 수 없다
    expect(f.algorithm).toBe('tpe');
    expect(warnings).toEqual([
      '설계 변수 1개를 이 FMU에서 찾을 수 없어 뺐습니다: missing',
      '고정 파라미터 1개를 이 FMU에서 찾을 수 없어 뺐습니다: nope',
      '목적함수 1개가 삭제되어 뺐습니다',
      'a.mat: 탐색 후보 1개가 이 FMU에 없습니다',
      'b.tir: 저장한 후보가 이 FMU에 없어 원본을 씁니다 (Resources 탭에서 올리면 다시 쓸 수 있습니다)',
      'resource 파일 c.txt이(가) 이 FMU에 없어 뺐습니다',
      '알고리즘 NSGA-II을(를) 쓸 수 없어 TPE(으)로 바꿨습니다',
    ]);
  });

  test('design variables must be parameters; search with one survivor becomes fixed', () => {
    const { form: f } = applyPresetConfig({
      ...base, designVars: [{ name: 'loc', min: 0, max: 1, kind: 'float' }],
      resources: { 'a.mat': { mode: 'search', sha256s: ['k1', 'k2'] } },
    }, ctx);
    expect(f.vars).toEqual([]);
    expect(f.resourceSel).toEqual({ 'a.mat': { mode: 'fixed', candidateId: 'F2-k2' } });
  });

  test('round trip on the same FMU has no warnings', () => {
    const files = [file('a.mat', 'F1', ['orig', 'k1'])];
    const variables = [v('p1', 'parameter'), v('p2', 'parameter'), v('y1', 'output'), v('y2', 'output')];
    const original = form({ resourceSel: { 'a.mat': { mode: 'search', candidateIds: ['F1-orig', 'F1-k1'] } } });
    const cfg = formToPresetConfig(original, files, ['y1', 'y2']);
    const { form: f, warnings } = applyPresetConfig(cfg, { files, variables, objectiveIds: ['o1', 'o2'], gpAvailable: false });
    expect(warnings).toEqual([]);
    expect(f).toEqual({ ...original, directions: { o1: 'minimize', o2: 'maximize' } });
  });
});

describe('batch presets', () => {
  const files = [file('a.mat', 'F1', ['orig', 'k1', 'k2'])];
  const settings = { sim: SIM, recordVariables: ['y1', 'y2'], fixedParams: {}, workers: 2, runTimeoutSec: 60 };
  const batchForm = (over: Partial<BatchForm> = {}): BatchForm => ({
    rows: [
      { name: 'p1', mode: 'list', text: '1, 2,3', min: 0.5, max: 1.5, steps: 3 },
      { name: 'p2', mode: 'range', text: '1', min: 0, max: 10, steps: 5 },
    ],
    sampling: 'grid', nSamples: 20, resourceSel: { 'a.mat': ['F1-orig', 'F1-k2'] }, settings, plotVariables: [], ...over,
  });

  test('saves rows as sweep params (invalid list text as empty) and candidates by sha256', () => {
    const cfg = batchFormToPresetConfig(batchForm({
      rows: [{ name: 'p1', mode: 'list', text: '1, x', min: 0, max: 1, steps: 3 }],
      resourceSel: { 'a.mat': ['F1-orig'] },
    }), files, ['y1', 'y2']);
    expect(cfg.params).toEqual([{ name: 'p1', mode: 'list', values: [] }]);
    expect(cfg.recordVariables).toBeNull();
    // 원본만 고른 파일은 기본값이라 저장하지 않는다
    expect(cfg.resources).toEqual({});
  });

  test('round trip on the same FMU keeps the form', () => {
    const variables = [v('p1', 'parameter'), v('p2', 'parameter'), v('y1', 'output'), v('y2', 'output')];
    const original = batchForm();
    const cfg = batchFormToPresetConfig(original, files, ['y1', 'y2', 'y3']);
    expect(cfg.resources).toEqual({ 'a.mat': ['orig', 'k2'] });
    const { form: f, warnings } = applyBatchPresetConfig(cfg, { files, variables });
    expect(warnings).toEqual([]);
    expect(f.rows[0]).toEqual({ name: 'p1', mode: 'list', text: '1, 2, 3', min: 0.5, max: 1.5, steps: 3 });
    expect(f.rows[1]).toEqual(original.rows[1]);
    expect(f.resourceSel).toEqual(original.resourceSel);
  });

  test('another FMU drops missing params and candidates', () => {
    const cfg = batchFormToPresetConfig(batchForm({ resourceSel: { 'a.mat': ['F1-k1', 'F1-k2'] } }), files, []);
    const { form: f, warnings } = applyBatchPresetConfig(cfg, {
      files: [file('a.mat', 'F2', ['orig', 'k2'])], variables: [v('p2', 'parameter'), v('y1', 'output')],
    });
    expect(f.rows.map(r => r.name)).toEqual(['p2']);
    expect(f.resourceSel).toEqual({ 'a.mat': ['F2-k2'] });
    expect(f.settings.recordVariables).toEqual(['y1']);
    expect(warnings).toEqual([
      '스윕 파라미터 1개를 이 FMU에서 찾을 수 없어 뺐습니다: p1',
      'a.mat: 저장한 후보 1개가 이 FMU에 없습니다',
      '기록 변수 1개를 이 FMU에서 찾을 수 없어 뺐습니다: y2',
    ]);
  });

  test('grid job without nSamples gets the default', () => {
    const cfg = batchRequestToPresetConfig({
      name: 'j', fmuId: 'F1', params: [{ name: 'p1', mode: 'list', values: [1] }], sampling: 'grid', nSamples: null,
      fixedParams: {}, sim: SIM, recordVariables: ['y1'], workers: 1, runTimeoutSec: 10, resources: { 'a.mat': ['F1-k1'] },
    }, files, ['y1']);
    expect(cfg).toMatchObject({ nSamples: DEFAULT_N_SAMPLES, recordVariables: null, resources: { 'a.mat': ['k1'] } });
  });
});
