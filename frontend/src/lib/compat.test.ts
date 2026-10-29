import { describe, expect, test } from 'vitest';
import type { BatchRequest, Job } from '../api/types';
import { DEFAULT_SPEC, type BuilderSpec } from './builder/spec';
import { generateCode } from './builder/codegen';
import { fmuCompat, jobCompat, requiredColumns, summarize } from './compat';

const SPEC: BuilderSpec = { ...DEFAULT_SPEC, calc: { kind: 'max', signal: 'speed' } };

function job(id: string, rec: string[]): Job {
  return {
    id,
    name: 'n' + id,
    config: { recordVariables: rec } as unknown as BatchRequest,
  } as unknown as Job;
}

describe('requiredColumns', () => {
  test('빌더 코드는 estimated=false, time 제외', () => {
    const r = requiredColumns(generateCode(SPEC));
    expect(r.estimated).toBe(false);
    expect(r.columns).toContain('speed');
    expect(r.columns).not.toContain('time');
  });
  test('고친 빌더 코드는 정규식 경로(estimated=true)', () => {
    const r = requiredColumns(generateCode(SPEC).replace('return float(v)', 'return float(v) * 2'));
    expect(r.estimated).toBe(true);
  });
  test('손코드 정규식 추출, 중복·time 제외', () => {
    const code = `def evaluate(result, params):\n    a = result["x"]\n    b = result['a.b']\n    c = result["x"]\n    t = result["time"]\n    return 1.0\n`;
    expect(requiredColumns(code)).toEqual({ columns: ['x', 'a.b'], estimated: true });
  });
});

describe('jobCompat', () => {
  test('누락 목록과 ok', () => {
    const r = jobCompat(['x', 'y'], [job('1', ['x']), job('2', ['x', 'y'])], []);
    expect(r[0]).toMatchObject({ jobId: '1', jobName: 'n1', ok: false, missing: ['y'] });
    expect(r[1].ok).toBe(true);
  });
  test('recordVariables 빈 배열은 outputNames 기준', () => {
    const r = jobCompat(['x', 'y', 'time'], [job('1', [])], ['x']);
    expect(r[0].missing).toEqual(['y']);
  });
  test('time은 항상 있음', () => {
    expect(jobCompat(['time'], [job('1', ['x'])], [])[0].ok).toBe(true);
  });
});

describe('fmuCompat / summarize', () => {
  test('unknown', () => {
    expect(fmuCompat(['a', 'b'], ['a'])).toEqual({ recordable: false, unknown: ['b'] });
    expect(fmuCompat(['a'], ['a'])).toEqual({ recordable: true, unknown: [] });
  });
  test('summarize', () => {
    const c = jobCompat(['x'], [job('1', ['x']), job('2', [])], []);
    expect(summarize(c)).toEqual({ okJobs: 1, totalJobs: 2 });
  });
});
