// 미리보기 subplot ECharts 옵션 (순수 함수)
import type { BuilderTrace } from '../../lib/builder/evaluate';

const ROW = 110;
const PLOT = 76;
const TOP = 28;

export type PreviewSignal = { name: string; values: ArrayLike<number> };

export function previewOption(time: ArrayLike<number>, signals: PreviewSignal[], trace: BuilderTrace | null, markSignal?: string) {
  const n = signals.length;
  const last = n - 1;
  const t = Array.from(time);
  const areas = (trace?.segments ?? []).map(([a, b]) => [{ xAxis: t[a] }, { xAxis: t[b] }]);
  const lines = (trace?.triggerTimes ?? []).map((x, i) => ({ xAxis: x, name: `트리거 ${i + 1}` }));
  return {
    animation: false,
    tooltip: { trigger: 'axis' },
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    title: signals.map((s, i) => ({
      text: s.name, top: TOP + i * ROW - 20, left: 60, textStyle: { fontSize: 11, fontWeight: 'normal' },
    })),
    grid: signals.map((_, i) => ({ left: 60, right: 16, top: TOP + i * ROW, height: PLOT })),
    xAxis: signals.map((_, i) => ({
      type: 'value', gridIndex: i, min: 'dataMin', max: 'dataMax',
      axisLabel: { show: i === last }, name: i === last ? 'time [s]' : undefined, nameLocation: 'middle', nameGap: 22,
    })),
    yAxis: signals.map((_, i) => ({ type: 'value', gridIndex: i, scale: true, splitNumber: 3 })),
    dataZoom: [{ type: 'inside', xAxisIndex: signals.map((_, i) => i) }],
    series: signals.map((s, i) => {
      const values = Array.from(s.values);
      const isMark = s.name === markSignal;
      return {
        name: s.name, type: 'line', xAxisIndex: i, yAxisIndex: i, showSymbol: false, sampling: 'lttb',
        data: t.map((x, k) => [x, Number.isFinite(values[k]) ? values[k] : null]),
        markLine: { symbol: 'none', silent: true, label: { formatter: '{b}', fontSize: 10 }, lineStyle: { type: 'dashed' }, data: lines },
        markArea: { silent: true, itemStyle: { opacity: 0.12 }, data: areas },
        // 계산 신호에는 구간 양끝 점을 찍는다 (끝값−시작값 등에서 쓰인 값)
        ...(isMark && trace ? {
          markPoint: {
            symbol: 'circle', symbolSize: 6, label: { show: false },
            data: trace.segments.flatMap(([a, b]) => [a, b]).map(k => ({ coord: [t[k], values[k]] })),
          },
        } : {}),
      };
    }),
  };
}

export function previewHeight(n: number): number {
  return TOP + n * ROW + 10;
}
