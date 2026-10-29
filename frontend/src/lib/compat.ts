import type { Job } from '../api/types';
import { parseBuilderCode } from './builder/codegen';
import { specColumns } from './builder/spec';

const RESULT_RE = /result\[\s*(['"])(.+?)\1\s*\]/g;

/** 목적함수 코드가 읽는 결과 컬럼. 'time'은 항상 있으므로 제외한다. */
export function requiredColumns(code: string): { columns: string[]; estimated: boolean } {
  const parsed = parseBuilderCode(code);
  if (parsed && parsed.intact) {
    return { columns: specColumns(parsed.spec).filter((c) => c !== 'time'), estimated: false };
  }
  const seen = new Set<string>();
  for (const m of code.matchAll(RESULT_RE)) {
    if (m[2] !== 'time') seen.add(m[2]);
  }
  return { columns: [...seen], estimated: true };
}

export type JobCompat = { jobId: string; jobName: string; ok: boolean; missing: string[] };

export function jobCompat(required: string[], jobs: Job[], outputNames: string[]): JobCompat[] {
  return jobs.map((job) => {
    const rec = job.config.recordVariables;
    // 빈 배열 = FMPy 기본(출력 변수 전체)
    const have = new Set(rec && rec.length > 0 ? rec : outputNames);
    const missing = required.filter((c) => c !== 'time' && !have.has(c));
    return { jobId: job.id, jobName: job.name, ok: missing.length === 0, missing };
  });
}

export function fmuCompat(required: string[], fmuVarNames: string[]): { recordable: boolean; unknown: string[] } {
  const known = new Set(fmuVarNames);
  const unknown = required.filter((c) => !known.has(c));
  return { recordable: unknown.length === 0, unknown };
}

export function summarize(c: JobCompat[]): { okJobs: number; totalJobs: number } {
  return { okJobs: c.filter((x) => x.ok).length, totalJobs: c.length };
}
