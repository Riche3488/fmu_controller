import { describe, expect, test } from 'vitest';
import { histogram } from './vizStats';

describe('histogram', () => {
  test('빈 입력이면 빈 결과', () => {
    expect(histogram([])).toEqual({ edges: [], counts: [] });
  });

  test('NaN·null은 제외하고 모두 센다', () => {
    const xs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, NaN, null as unknown as number];
    const h = histogram(xs);
    expect(h.counts).toHaveLength(5); // ceil(sqrt(10))=4 → 최소 5
    expect(h.edges).toHaveLength(6);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(10);
    expect(h.edges[0]).toBe(0);
    expect(h.edges[5]).toBe(9);
  });

  test('bins를 지정하면 그 개수, 최댓값은 마지막 칸', () => {
    const h = histogram([0, 0.5, 1], 2);
    expect(h.edges).toEqual([0, 0.5, 1]);
    expect(h.counts).toEqual([1, 2]);
  });

  test('기본 bins는 50을 넘지 않는다', () => {
    const xs = Array.from({ length: 10000 }, (_, i) => i);
    expect(histogram(xs).counts).toHaveLength(50);
  });

  test('모든 값이 같아도 한 칸에 모인다', () => {
    const h = histogram([3, 3, 3]);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(3);
    expect(h.edges[0]).toBeLessThan(3);
    expect(h.edges[h.edges.length - 1]).toBeGreaterThan(3);
  });
});
