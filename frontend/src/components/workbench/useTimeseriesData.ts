// 시계열 패널용: run별 시계열을 받아 run id → Timeseries로 모은다
import { useQueries } from '@tanstack/react-query';
import { useApi } from '../../api/client';
import type { Timeseries } from '../../api/types';

const MAX_POINTS = 2000;

export function useTimeseriesData(runIds: string[], vars: string[]): {
  data: Record<string, Timeseries>; isLoading: boolean; error: Error | null;
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
  const data: Record<string, Timeseries> = {};
  runIds.forEach((id, i) => {
    const d = results[i]?.data;
    if (d) data[id] = d;
  });
  return {
    data,
    isLoading: vars.length > 0 && results.some(r => r.isLoading),
    error: (results.find(r => r.isError)?.error as Error | undefined) ?? null,
  };
}
