import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api/client';
import type { Objective } from '../api/types';
import { fmuCompat, jobCompat, requiredColumns, summarize } from '../lib/compat';
import { useOutputNames } from './RunSettingsSection';

export type ObjectiveCompat =
  | { kind: 'jobs'; okJobs: number; totalJobs: number; estimated: boolean; ok: boolean }
  | { kind: 'fmu'; estimated: boolean; ok: boolean };

/** 이 FMU의 잡(없으면 FMU 변수) 기준으로 목적함수별 호환 여부. 조회가 끝나기 전에는 undefined. */
export function useObjectiveCompat(fmuId: string, objectives: Objective[] | undefined) {
  const api = useApi();
  const jobs = useQuery({ queryKey: ['jobs', fmuId], queryFn: () => api.listJobs({ fmuId }) });
  const outputs = useOutputNames(fmuId);
  const allVars = useQuery({
    queryKey: ['variables', fmuId, 'all', 'all-names'],
    queryFn: () => api.listVariables(fmuId, { offset: 0, limit: 100000 }),
  });
  if (!objectives || !jobs.data || !outputs.data || !allVars.data) return undefined;
  const varNames = allVars.data.items.map(v => v.name);
  const map = new Map<string, ObjectiveCompat>();
  for (const o of objectives) {
    const { columns, estimated } = requiredColumns(o.code);
    if (jobs.data.length === 0) {
      const f = fmuCompat(columns, varNames);
      map.set(o.id, { kind: 'fmu', estimated, ok: f.recordable });
    } else {
      const s = summarize(jobCompat(columns, jobs.data, outputs.data));
      map.set(o.id, { kind: 'jobs', ...s, estimated, ok: s.okJobs > 0 });
    }
  }
  return map;
}
