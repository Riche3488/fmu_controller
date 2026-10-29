// 시각화용 통계 함수 (순수 함수). NaN·null은 모두 제외한다.

const finite = (xs: (number | null | undefined)[]): number[] =>
  xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));

/** 등간격 히스토그램. 기본 bins = ceil(sqrt(n))을 5..50으로 자른 값. 최댓값은 마지막 칸에 넣는다. */
export function histogram(xs: number[], bins?: number): { edges: number[]; counts: number[] } {
  const v = finite(xs);
  if (!v.length) return { edges: [], counts: [] };
  const k = Math.max(1, Math.floor(bins ?? Math.min(50, Math.max(5, Math.ceil(Math.sqrt(v.length))))));
  let lo = v.reduce((a, b) => Math.min(a, b), Infinity);
  let hi = v.reduce((a, b) => Math.max(a, b), -Infinity);
  // 모두 같은 값이면 폭 1짜리 범위로 벌린다
  if (lo === hi) { lo -= 0.5; hi += 0.5; }
  const w = (hi - lo) / k;
  const edges = Array.from({ length: k + 1 }, (_, i) => (i === k ? hi : lo + i * w));
  const counts = new Array<number>(k).fill(0);
  for (const x of v) counts[Math.min(k - 1, Math.floor((x - lo) / w))] += 1;
  return { edges, counts };
}
