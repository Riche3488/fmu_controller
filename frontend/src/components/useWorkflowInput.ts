import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api/client';
import { useObjectiveCompat } from './useObjectiveCompat';
import { isResourcesVisited, type WorkflowInput } from '../lib/workflow';

/** 작업 공간 단계 판정에 쓰는 입력. 조회가 끝나기 전에는 undefined. */
export function useWorkflowInput(fmuId: string): WorkflowInput | undefined {
  const api = useApi();
  const jobs = useQuery({ queryKey: ['jobs', fmuId], queryFn: () => api.listJobs({ fmuId }) });
  const okRuns = useQuery({
    queryKey: ['runs', 'ok-count', fmuId],
    queryFn: () => api.listRuns({ fmuId, status: 'ok', limit: 1 }),
  });
  const objectives = useQuery({ queryKey: ['objectives'], queryFn: () => api.listObjectives() });
  const compat = useObjectiveCompat(fmuId, objectives.data);
  if (!jobs.data || !okRuns.data || !compat) return undefined;
  return {
    nJobs: jobs.data.length,
    nOkRuns: okRuns.data.total,
    nCompatibleObjectives: [...compat.values()].filter(c => c.ok).length,
    resourcesVisited: isResourcesVisited(fmuId),
  };
}
