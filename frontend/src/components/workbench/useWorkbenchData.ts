// 작업대 데이터: 필터 범위의 run 전체(+ 모든 목적함수 값), 파라미터·변수 이름, 잡, variant
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useApi } from '../../api/client';
import type { BatchRequest, Job, OptimizationRequest, RunQuery, Variant } from '../../api/types';
import type { WorkbenchData } from '../../lib/workbench';
import { useVariants } from '../ResourceGroupSection';

const ALL = 100000;
const NO_VARIANTS: Variant[] = [];

export type WorkbenchFilter = Pick<RunQuery, 'jobIds' | 'variantIds' | 'status'>;

function jobParamNames(j: Job): string[] {
  return j.kind === 'batch'
    ? (j.config as BatchRequest).params.map(p => p.name)
    : (j.config as OptimizationRequest).designVars.map(d => d.name);
}

export function useWorkbenchData(fmuId: string, filter: WorkbenchFilter): WorkbenchData & { isLoading: boolean; error: Error | null } {
  const api = useApi();
  const objectiveList = useQuery({ queryKey: ['objectives'], queryFn: () => api.listObjectives() });
  const objectiveIds = (objectiveList.data ?? []).map(o => o.id);
  const jobsQuery = useQuery({ queryKey: ['jobs', fmuId], queryFn: () => api.listJobs({ fmuId }) });
  const variants = useVariants(fmuId);
  const query: RunQuery = {
    fmuId, jobIds: filter.jobIds?.length ? filter.jobIds : undefined, status: filter.status,
    variantIds: filter.variantIds?.length ? filter.variantIds : undefined, objectiveIds,
  };
  const runs = useQuery({
    queryKey: ['runs', 'workbench', query],
    queryFn: () => api.listRuns({ ...query, limit: ALL }),
    enabled: objectiveList.isSuccess,
  });

  // 호출자가 매 렌더 새 배열을 넘겨도 패널을 다시 만들지 않게 문자열로 비교한다
  const jobKey = filter.jobIds?.join(',') ?? '';
  const jobs = useMemo(() => {
    const all = jobsQuery.data ?? [];
    const ids = jobKey ? jobKey.split(',') : [];
    return ids.length ? all.filter(j => ids.includes(j.id)) : all;
  }, [jobsQuery.data, jobKey]);
  const recordVars = useMemo(() => [...new Set(jobs.flatMap(j => j.config.recordVariables))], [jobs]);
  // 기록 변수를 알 수 없으면(잡 없음) FMU 출력 변수 전체
  const outputs = useQuery({
    queryKey: ['variables', fmuId, 'output-all'],
    queryFn: () => api.listVariables(fmuId, { causality: 'output', offset: 0, limit: ALL }),
    enabled: jobsQuery.isSuccess && recordVars.length === 0,
  });

  const rows = useMemo(() => runs.data?.items ?? [], [runs.data]);
  const params = useMemo(() => {
    const names = new Set(jobs.flatMap(jobParamNames));
    rows.forEach(r => Object.keys(r.params).forEach(k => names.add(k)));
    return [...names].sort();
  }, [jobs, rows]);
  const objectives = useMemo(() => (objectiveList.data ?? []).map(o => ({ id: o.id, name: o.name })), [objectiveList.data]);
  const vars = useMemo(() => recordVars.length ? recordVars : (outputs.data?.items ?? []).map(v => v.name), [recordVars, outputs.data]);

  return {
    rows, objectives, params, vars, jobs, variants: variants.data ?? NO_VARIANTS,
    error: (objectiveList.error ?? runs.error ?? jobsQuery.error ?? outputs.error) as Error | null,
    isLoading: !runs.isFetched || !jobsQuery.isFetched || (recordVars.length === 0 && !outputs.isFetched),
  };
}
