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

/** ④ 실행 링크의 `record` 쿼리 값 (콤마 목록). */
export function recordParam(names: string[]): string {
  return names.join(',');
}

/** `record` 쿼리 → 변수 이름 목록. `a[1,2]`처럼 대괄호 안의 콤마는 이름의 일부로 본다. */
export function parseRecordParam(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '[') depth += 1;
    else if (ch === ']') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter((x) => x.length > 0);
}
