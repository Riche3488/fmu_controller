import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { ApiProvider } from '../../api/client';
import { createMockClient } from '../../api/mock/mockClient';
import type { Timeseries } from '../../api/types';
import { useTimeseriesData } from './useTimeseriesData';

const TS: Timeseries = { time: [0, 1], series: { v: [1, 2] } };

function setup(getTimeseries: (id: string) => Promise<Timeseries>) {
  const client = { ...createMockClient({ tickMs: 5 }), getTimeseries };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}><ApiProvider client={client}>{children}</ApiProvider></QueryClientProvider>
  );
  return (ids: string[], vars: string[]) => renderHook(() => useTimeseriesData(ids, vars), { wrapper });
}

describe('useTimeseriesData', () => {
  it('변수가 없으면 요청하지 않고 로딩도 아니다', () => {
    let calls = 0;
    const { result } = setup(() => { calls++; return Promise.resolve(TS); })(['a'], []);
    expect(result.current).toEqual({ byRun: {}, isLoading: false, error: null });
    expect(calls).toBe(0);
  });

  it('한 run만 도착하면 로딩 아님, 아직 안 온 run은 byRun에 없다', async () => {
    const { result } = setup(id => (id === 'a' ? Promise.resolve(TS) : new Promise(() => {})))(['a', 'b'], ['v']);
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.byRun).toEqual({ a: TS }));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('한 run이 실패하면 그 오류를 올리고 나머지 데이터는 유지한다', async () => {
    const { result } = setup(id => (id === 'a' ? Promise.resolve(TS) : Promise.reject(new Error('run b 실패'))))(['a', 'b'], ['v']);
    await waitFor(() => expect(result.current.error?.message).toBe('run b 실패'));
    expect(result.current.byRun).toEqual({ a: TS });
    expect(result.current.isLoading).toBe(false);
  });
});
