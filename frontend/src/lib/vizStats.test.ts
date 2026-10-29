import { describe, expect, test } from 'vitest';
import {
  histogram, rank, pearson, spearman, corrMatrix, kde, idwGrid, fft, bestSoFar, band, resampleTo,
} from './vizStats';

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

describe('rank', () => {
  test('동순위는 평균 순위(1부터)', () => {
    expect(rank([10, 20, 20, 5])).toEqual([2, 3.5, 3.5, 1]);
  });
});

describe('pearson / spearman', () => {
  test('null 쌍을 제외하고 유효쌍 3개면 계산한다', () => {
    expect(pearson([1, 2, null as unknown as number, 4], [2, 4, 6, 8])).toBeCloseTo(1, 10);
  });
  test('유효쌍 3 미만이면 null', () => {
    expect(pearson([1, NaN, 3], [1, 2, 3])).toBeNull();
  });
  test('분산 0이면 null', () => {
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull();
  });
  test('음의 상관', () => {
    expect(pearson([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1, 10);
  });
  test('spearman은 단조 비선형이면 1', () => {
    expect(spearman([1, 2, 3, 4, 5], [1, 8, 27, 64, 125])).toBeCloseTo(1, 10);
  });
  test('spearman도 null 쌍 제외', () => {
    expect(spearman([1, 2, null as unknown as number, 4, 5], [1, 4, 9, 16, 25])).toBeCloseTo(1, 10);
  });
});

describe('corrMatrix', () => {
  test('대각은 유효값 3개 이상이면 1, 아니면 null', () => {
    const r = corrMatrix({ a: [1, 2, 3, 4], b: [2, 4, 6, null], c: [1, null, null, 2] }, 'pearson');
    expect(r.names).toEqual(['a', 'b', 'c']);
    expect(r.m[0][0]).toBe(1);
    expect(r.m[1][1]).toBe(1);
    expect(r.m[2][2]).toBeNull();
    expect(r.m[0][1]).toBeCloseTo(1, 10);
    expect(r.m[1][0]).toBeCloseTo(1, 10);
    expect(r.m[0][2]).toBeNull();
  });
});

describe('kde', () => {
  test('평균 근처에서 밀도가 가장 크고 null은 무시', () => {
    const d = kde([0, 0.1, -0.1, NaN, null as unknown as number], [0, 5]);
    expect(d[0]).toBeGreaterThan(d[1]);
    expect(d[1]).toBeGreaterThanOrEqual(0);
  });
  test('빈 입력이면 0', () => {
    expect(kde([], [0, 1])).toEqual([0, 0]);
  });
});

describe('idwGrid', () => {
  test('데이터 점과 겹치는 격자점은 z를 그대로 가진다', () => {
    const g = idwGrid([{ x: 0, y: 0, z: 1 }, { x: 2, y: 2, z: 5 }, { x: NaN, y: 1, z: 9 }], 3, 3);
    expect(g.xs).toEqual([0, 1, 2]);
    expect(g.ys).toEqual([0, 1, 2]);
    expect(g.z[0][0]).toBe(1);
    expect(g.z[2][2]).toBe(5);
    expect(g.z[1][1]).toBeCloseTo(3, 10);
  });
  test('빈 점이면 빈 결과', () => {
    expect(idwGrid([], 3, 3)).toEqual({ xs: [], ys: [], z: [] });
  });
  test('점 200000개도 범위 계산에서 스택이 넘치지 않는다', () => {
    const pts = Array.from({ length: 200000 }, (_, i) => ({ x: i, y: -i, z: 1 }));
    const g = idwGrid(pts, 2, 2);
    expect(g.xs).toEqual([0, 199999]);
    expect(g.ys).toEqual([-199999, 0]);
  });
});

describe('fft', () => {
  test('5Hz 사인의 피크는 5Hz, 진폭 ≈ 1', () => {
    const dt = 1 / 64;
    const sig = Array.from({ length: 64 }, (_, i) => Math.sin(2 * Math.PI * 5 * i * dt));
    const { freq, amp } = fft(sig, dt);
    expect(freq).toHaveLength(32);
    let k = 1;
    for (let i = 1; i < amp.length; i++) if (amp[i] > amp[k]) k = i;
    expect(freq[k]).toBeCloseTo(5, 6);
    expect(amp[k]).toBeCloseTo(1, 6);
  });
  test('길이가 2의 거듭제곱이 아니면 zero-pad', () => {
    const { freq } = fft([1, 2, 3, 4, 5], 0.5);
    expect(freq).toHaveLength(4); // 8점 → 4빈
    expect(freq[1]).toBeCloseTo(1 / (8 * 0.5), 10);
  });
});

describe('bestSoFar', () => {
  test('null은 이전 최고값을 이어 간다', () => {
    expect(bestSoFar([3, null, 1, 2], 'minimize')).toEqual([3, 3, 1, 1]);
  });
  test('앞쪽 null은 null, maximize', () => {
    expect(bestSoFar([null, NaN, 1, 5, 2], 'maximize')).toEqual([null, null, 1, 5, 5]);
  });
});

describe('band', () => {
  test('인덱스별 평균·최소·최대, 비유한값 무시', () => {
    const b = band([[1, 2, NaN], [3, NaN, NaN], [5, 4, NaN]]);
    expect(b.mean[0]).toBe(3);
    expect(b.min[0]).toBe(1);
    expect(b.max[0]).toBe(5);
    expect(b.mean[1]).toBe(3);
    expect(b.max[1]).toBe(4);
    expect(b.mean[2]).toBeNaN();
    expect(b.min[2]).toBeNaN();
  });
});

describe('resampleTo', () => {
  test('선형 보간, 범위 밖은 끝값', () => {
    expect(resampleTo([0, 1, 2], [0, 10, 0], [-1, 0.5, 1, 1.5, 3])).toEqual([0, 5, 10, 5, 0]);
  });
});
