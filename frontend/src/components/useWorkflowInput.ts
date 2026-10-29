import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api/client';
import { isResourcesVisited, type WorkflowInput } from '../lib/workflow';

/** 작업 공간 단계 판정에 쓰는 입력. 조회가 끝나기 전에는 undefined. */
export function useWorkflowInput(fmuId: string): WorkflowInput | undefined {
  const api = useApi();
  const jobs = useQuery({ queryKey: ['jobs', fmuId], queryFn: () => api.listJobs({ fmuId }) });
  const okRuns = useQuery({
    queryKey: ['runs', 'ok-count', fmuId],
    queryFn: () => api.listRuns({ fmuId, status: 'ok', limit: 1 }),
  });
  // Task 12에서 FMU 호환 판정으로 교체
  const objectives = useQuery({ queryKey: ['objectives'], queryFn: () => api.listObjectives() });
  if (!jobs.data || !okRuns.data || !objectives.data) return undefined;
  return {
    nJobs: jobs.data.length,
    nOkRuns: okRuns.data.total,
    nCompatibleObjectives: objectives.data.length,
    resourcesVisited: isResourcesVisited(fmuId),
  };
}
