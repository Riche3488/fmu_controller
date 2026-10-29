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

export function useWorkbenchData(fmuId: string, filter: WorkbenchFilter): WorkbenchData & { isLoading: boolean } {
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

  const jobs = useMemo(() => {
    const all = jobsQuery.data ?? [];
    return filter.jobIds?.length ? all.filter(j => filter.jobIds!.includes(j.id)) : all;
  }, [jobsQuery.data, filter.jobIds]);
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
    isLoading: !runs.isFetched || !jobsQuery.isFetched || (recordVars.length === 0 && !outputs.isFetched),
  };
}
