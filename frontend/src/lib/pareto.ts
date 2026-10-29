import type { Direction } from '../api/types';

/** 각 점이 비지배해(Pareto front)인지 여부. null이 포함된 점은 false. */
export function paretoFront(points: (number | null)[][], directions: Direction[]): boolean[] {
  const sign = directions.map(d => (d === 'maximize' ? -1 : 1));
  const valid = points.map(p => p.every(v => v !== null && Number.isFinite(v)));
  const cost = points.map(p => p.map((v, k) => (v ?? 0) * sign[k]));
  const dominates = (a: number[], b: number[]) => a.every((v, k) => v <= b[k]) && a.some((v, k) => v < b[k]);
  return cost.map((c, i) => valid[i] && !cost.some((o, j) => j !== i && valid[j] && dominates(o, c)));
}
