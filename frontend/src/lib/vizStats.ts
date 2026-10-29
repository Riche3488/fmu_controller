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

const isFin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** 동순위는 평균 순위(1부터). */
export function rank(xs: number[]): number[] {
  const idx = xs.map((_, i) => i).sort((i, j) => xs[i] - xs[j]);
  const r = new Array<number>(xs.length);
  let s = 0;
  while (s < idx.length) {
    let e = s;
    while (e + 1 < idx.length && xs[idx[e + 1]] === xs[idx[s]]) e++;
    const avg = (s + e) / 2 + 1;
    for (let k = s; k <= e; k++) r[idx[k]] = avg;
    s = e + 1;
  }
  return r;
}

/** 쌍 중 하나라도 비유한이면 그 쌍은 제외. 유효쌍 3개 미만이거나 분산 0이면 null. */
export function pearson(a: (number | null)[], b: (number | null)[]): number | null {
  const x: number[] = [];
  const y: number[] = [];
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const p = a[i], q = b[i];
    if (isFin(p) && isFin(q)) { x.push(p); y.push(q); }
  }
  if (x.length < 3) return null;
  const mx = x.reduce((s, v) => s + v, 0) / x.length;
  const my = y.reduce((s, v) => s + v, 0) / y.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/** 유효쌍만 골라 순위로 바꾼 뒤 피어슨. */
export function spearman(a: (number | null)[], b: (number | null)[]): number | null {
  const x: number[] = [];
  const y: number[] = [];
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const p = a[i], q = b[i];
    if (isFin(p) && isFin(q)) { x.push(p); y.push(q); }
  }
  if (x.length < 3) return null;
  return pearson(rank(x), rank(y));
}

export function corrMatrix(
  cols: Record<string, (number | null)[]>,
  method: 'pearson' | 'spearman',
): { names: string[]; m: (number | null)[][] } {
  const names = Object.keys(cols);
  const f = method === 'pearson' ? pearson : spearman;
  const m = names.map((p, i) =>
    names.map((q, j) => {
      if (i === j) return finite(cols[p]).length >= 3 ? 1 : null;
      return f(cols[p], cols[q]);
    }),
  );
  return { names, m };
}

/** 가우시안 KDE. bandwidth 기본은 Silverman 규칙. */
export function kde(xs: number[], at: number[], bandwidth?: number): number[] {
  const v = finite(xs);
  const n = v.length;
  if (!n) return at.map(() => 0);
  let h = bandwidth;
  if (h === undefined || !(h > 0)) {
    const mean = v.reduce((s, x) => s + x, 0) / n;
    const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, n - 1));
    const sorted = [...v].sort((p, q) => p - q);
    const q = (p: number) => {
      const pos = (n - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos);
      return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
    };
    const spread = Math.min(sd, (q(0.75) - q(0.25)) / 1.34) || sd;
    h = 0.9 * spread * n ** -0.2;
    if (!(h > 0)) h = 1; // 모두 같은 값
  }
  const c = 1 / (n * h * Math.sqrt(2 * Math.PI));
  return at.map((t) => {
    let s = 0;
    for (const x of v) { const u = (t - x) / h!; s += Math.exp(-0.5 * u * u); }
    return c * s;
  });
}

/** 역거리 가중(IDW) 격자 보간. z[j][i]는 ys[j], xs[i]. */
export function idwGrid(
  pts: { x: number; y: number; z: number }[],
  nx: number,
  ny: number,
  power = 2,
): { xs: number[]; ys: number[]; z: number[][] } {
  const p = pts.filter((q) => isFin(q.x) && isFin(q.y) && isFin(q.z));
  if (!p.length) return { xs: [], ys: [], z: [] };
  const lin = (lo: number, hi: number, n: number) =>
    Array.from({ length: n }, (_, i) => (n === 1 ? lo : lo + ((hi - lo) * i) / (n - 1)));
  // 펼침(Math.min(...arr))은 점이 많으면 호출 스택을 넘는다
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const q of p) {
    if (q.x < xmin) xmin = q.x;
    if (q.x > xmax) xmax = q.x;
    if (q.y < ymin) ymin = q.y;
    if (q.y > ymax) ymax = q.y;
  }
  const xs = lin(xmin, xmax, nx);
  const ys = lin(ymin, ymax, ny);
  const z = ys.map((gy) =>
    xs.map((gx) => {
      let num = 0, den = 0;
      for (const q of p) {
        const d2 = (q.x - gx) ** 2 + (q.y - gy) ** 2;
        if (d2 === 0) return q.z;
        const w = 1 / d2 ** (power / 2);
        num += w * q.z; den += w;
      }
      return num / den;
    }),
  );
  return { xs, ys, z };
}

/** 길이를 2의 거듭제곱으로 zero-pad한 단측 진폭 스펙트럼 (N/2 빈). */
export function fft(signal: number[], dt: number): { freq: number[]; amp: number[] } {
  let N = 1;
  while (N < signal.length) N *= 2;
  const re = new Array<number>(N).fill(0);
  const im = new Array<number>(N).fill(0);
  signal.forEach((v, i) => { re[i] = isFin(v) ? v : 0; });
  // 비트 반전 순서
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  const half = N / 2;
  const freq: number[] = [];
  const amp: number[] = [];
  for (let k = 0; k < half; k++) {
    const mag = Math.hypot(re[k], im[k]);
    freq.push(k / (N * dt));
    amp.push(k === 0 ? mag / N : (2 * mag) / N);
  }
  return { freq, amp };
}

/** 지금까지의 최고값. null·NaN이면 이전 최고값을 이어 가고, 첫 유한값 전에는 null. */
export function bestSoFar(values: (number | null)[], dir: 'minimize' | 'maximize'): (number | null)[] {
  let best: number | null = null;
  return values.map((v) => {
    if (isFin(v) && (best === null || (dir === 'minimize' ? v < best : v > best))) best = v;
    return best;
  });
}

/** 인덱스별 평균·최소·최대 (비유한값 무시, 없으면 NaN). */
export function band(series: number[][]): { mean: number[]; min: number[]; max: number[] } {
  const len = series.reduce((m, s) => Math.max(m, s.length), 0);
  const mean: number[] = [], min: number[] = [], max: number[] = [];
  for (let i = 0; i < len; i++) {
    const v = finite(series.map((s) => s[i]));
    if (!v.length) { mean.push(NaN); min.push(NaN); max.push(NaN); continue; }
    mean.push(v.reduce((s, x) => s + x, 0) / v.length);
    min.push(v.reduce((a, b) => Math.min(a, b), Infinity));
    max.push(v.reduce((a, b) => Math.max(a, b), -Infinity));
  }
  return { mean, min, max };
}

/** 선형 보간. t는 오름차순 가정, 범위 밖은 끝값으로 자른다. */
export function resampleTo(t: number[], y: number[], grid: number[]): number[] {
  const n = Math.min(t.length, y.length);
  if (!n) return grid.map(() => NaN);
  let j = 0;
  return grid.map((g) => {
    if (g <= t[0]) return y[0];
    if (g >= t[n - 1]) return y[n - 1];
    while (j > 0 && t[j] > g) j--;
    while (j < n - 2 && t[j + 1] < g) j++;
    const span = t[j + 1] - t[j];
    return span === 0 ? y[j + 1] : y[j] + ((y[j + 1] - y[j]) * (g - t[j])) / span;
  });
}
