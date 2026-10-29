/** 박스플롯용 [min, Q1, median, Q3, max] (선형 보간 분위수). 빈 배열이면 null. */
export function boxStats(values: number[]): [number, number, number, number, number] | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const q = (p: number) => {
    const pos = (s.length - 1) * p;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  };
  return [s[0], q(0.25), q(0.5), q(0.75), s[s.length - 1]];
}

/** CSV 한 줄 (RFC 4180 따옴표 처리) */
export function csvLine(cells: unknown[]): string {
  return cells.map(c => {
    const t = c === null || c === undefined ? '' : String(c);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  }).join(',');
}
