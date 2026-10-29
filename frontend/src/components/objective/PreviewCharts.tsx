// 미리보기 run의 관련 신호: 신호마다 subplot 하나, x축 공유, 트리거 세로선과 계산 구간 음영
import { Text } from '@mantine/core';
import ReactECharts from 'echarts-for-react';
import type { BuilderTrace } from '../../lib/builder/evaluate';
import { useEchartsTheme } from '../../theme';
import { previewHeight, previewOption, type PreviewSignal } from './previewOption';

export function PreviewCharts({ time, signals, trace, markSignal }: {
  time: ArrayLike<number>; signals: PreviewSignal[]; trace: BuilderTrace | null; markSignal?: string;
}) {
  const theme = useEchartsTheme();
  if (!signals.length) return <Text size="sm" c="dimmed">그릴 신호가 없습니다</Text>;
  return (
    <ReactECharts
      theme={theme} data-testid="preview-charts" notMerge
      option={previewOption(time, signals, trace, markSignal)}
      style={{ height: previewHeight(signals.length) }}
    />
  );
}
