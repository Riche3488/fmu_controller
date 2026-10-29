import type { Sampling, SweepParam } from '../api/types';

export const ZIP_LENGTH_ERROR = 'zip 방식은 모든 파라미터의 값 개수가 같아야 합니다';
export const SAMPLING_RANGE_ERROR = 'LHS/random 방식은 range 파라미터만 지원합니다';

export function expandValues(p: SweepParam): number[] {
  if (p.mode === 'list') return p.values;
  if (p.steps <= 1) return [p.min];
  return Array.from({ length: p.steps }, (_, i) => p.min + ((p.max - p.min) * i) / (p.steps - 1));
}

export function countCases(params: SweepParam[], sampling: Sampling, nSamples: number | null): number {
  if (params.length === 0) return 0;
  if (sampling === 'lhs' || sampling === 'random') {
    if (params.some(p => p.mode !== 'range')) throw new Error(SAMPLING_RANGE_ERROR);
    return nSamples ?? 0;
  }
  const lengths = params.map(p => expandValues(p).length);
  if (sampling === 'zip') {
    if (new Set(lengths).size > 1) throw new Error(ZIP_LENGTH_ERROR);
    return lengths[0];
  }
  return lengths.reduce((a, b) => a * b, 1);
}

/** 결정적 샘플링(grid/zip)만 미리보기. lhs/random은 서버에서 생성하므로 빈 배열. */
export function previewCases(
  params: SweepParam[], sampling: Sampling, nSamples: number | null, limit = 20,
): Record<string, number>[] {
  if (params.length === 0 || sampling === 'lhs' || sampling === 'random') return [];
  countCases(params, sampling, nSamples);
  const lists = params.map(p => ({ name: p.name, values: expandValues(p) }));
  if (sampling === 'zip') {
    return lists[0].values.slice(0, limit).map((_, i) => Object.fromEntries(lists.map(l => [l.name, l.values[i]])));
  }
  const out: Record<string, number>[] = [];
  const idx = lists.map(() => 0);
  while (out.length < limit) {
    out.push(Object.fromEntries(lists.map((l, k) => [l.name, l.values[idx[k]]])));
    let k = lists.length - 1;
    while (k >= 0 && ++idx[k] >= lists[k].values.length) idx[k--] = 0;
    if (k < 0) break;
  }
  return out;
}

/** 파라미터 기본 범위: start×0.5 ~ start×1.5 (start=0이면 -1 ~ 1) */
export function defaultBounds(start: unknown): { min: number; max: number } {
  const s = typeof start === 'number' ? start : 0;
  if (s === 0) return { min: -1, max: 1 };
  const [a, b] = [s * 0.5, s * 1.5];
  return { min: Math.min(a, b), max: Math.max(a, b) };
}
