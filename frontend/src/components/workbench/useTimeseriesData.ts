// 시계열 패널용: run별 시계열을 받아 run id → Timeseries로 모은다
import { useQueries } from '@tanstack/react-query';
import { useApi } from '../../api/client';
import type { Timeseries } from '../../api/types';

const MAX_POINTS = 2000;

export function useTimeseriesData(runIds: string[], vars: string[]): {
  byRun: Record<string, Timeseries>; isLoading: boolean; error: Error | null;
} {
  const api = useApi();
  const results = useQueries({
    queries: runIds.map(runId => ({
      // TimeseriesChart와 같은 키·maxPoints라 캐시를 같이 쓴다
      queryKey: ['timeseries', runId, vars],
      queryFn: () => api.getTimeseries(runId, vars, MAX_POINTS),
      enabled: vars.length > 0,
    })),
  });
  const byRun: Record<string, Timeseries> = {};
  runIds.forEach((id, i) => {
    const d = results[i]?.data;
    if (d) byRun[id] = d;
  });
  return {
    byRun,
    // 보여 줄 데이터가 하나라도 있으면 로딩 중이어도 차트를 그대로 둔다 (선택이 바뀔 때 차트가 사라지지 않게).
    // placeholderData(keepPreviousData)는 쓰지 않는다: 슬롯 단위라 run이 바뀌면 다른 run의 데이터가 섞여 들어온다.
    isLoading: vars.length > 0 && results.some(r => r.isLoading) && Object.keys(byRun).length === 0,
    error: (results.find(r => r.isError)?.error as Error | undefined) ?? null,
  };
}
