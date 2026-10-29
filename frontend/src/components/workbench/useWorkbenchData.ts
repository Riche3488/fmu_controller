// 작업대 데이터: 필터 범위의 run 전체(+ 패널이 쓰는 목적함수 값), 파라미터·변수 이름, 잡, variant
import { keepPreviousData, useQuery } from '@tanstack/react-query';
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

/** objectiveNames: 패널이 참조하는 목적함수 이름. 목적함수 값은 조회 때마다 다시 계산하므로 이것만 요청한다. */
export function useWorkbenchData(
  fmuId: string, filter: WorkbenchFilter, objectiveNames: string[] = [],
): WorkbenchData & { isLoading: boolean; error: Error | null } {
  const api = useApi();
  const objectiveList = useQuery({ queryKey: ['objectives'], queryFn: () => api.listObjectives() });
  const wanted = new Set(objectiveNames);
  const objectiveIds = (objectiveList.data ?? []).filter(o => wanted.has(o.name)).map(o => o.id);
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
    // 패널이 다른 목적함수를 쓰게 되어 다시 받는 동안 기존 행으로 그린다
    placeholderData: keepPreviousData,
  });

  // 호출자가 매 렌더 새 배열을 넘겨도 패널을 다시 만들지 않게 문자열로 비교한다
  const jobKey = filter.jobIds?.join(',') ?? '';
  const jobs = useMemo(() => {
    const all = jobsQuery.data ?? [];
    const ids = jobKey ? jobKey.split(',') : [];
    return ids.length ? all.filter(j => ids.includes(j.id)) : all;
  }, [jobsQuery.data, jobKey]);
  const recordVars = useMemo(() => [...new Set(jobs.flatMap(j => j.config.recordVariables))], [jobs]);
  // 기록 변수를 비운 잡은 FMU 출력 변수 전체를 기록한다. 잡이 없을 때도 출력 변수 전체.
  const needOutputs = jobs.length === 0 || jobs.some(j => j.config.recordVariables.length === 0);
  const outputs = useQuery({
    queryKey: ['variables', fmuId, 'output-all'],
    queryFn: () => api.listVariables(fmuId, { causality: 'output', offset: 0, limit: ALL }),
    enabled: jobsQuery.isSuccess && needOutputs,
  });

  const rows = useMemo(() => runs.data?.items ?? [], [runs.data]);
  const params = useMemo(() => {
    const names = new Set(jobs.flatMap(jobParamNames));
    rows.forEach(r => Object.keys(r.params).forEach(k => names.add(k)));
    return [...names].sort();
  }, [jobs, rows]);
  const objectives = useMemo(() => (objectiveList.data ?? []).map(o => ({ id: o.id, name: o.name })), [objectiveList.data]);
  const vars = useMemo(
    () => (needOutputs ? [...new Set([...recordVars, ...(outputs.data?.items ?? []).map(v => v.name)])] : recordVars),
    [needOutputs, recordVars, outputs.data],
  );

  return {
    rows, objectives, params, vars, jobs, variants: variants.data ?? NO_VARIANTS,
    error: (objectiveList.error ?? runs.error ?? jobsQuery.error ?? outputs.error) as Error | null,
    isLoading: (!runs.isFetched && !runs.isPlaceholderData) || !jobsQuery.isFetched || (needOutputs && !outputs.isFetched),
  };
}
