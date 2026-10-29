// 패널 CSV: 패널에 쓰인 run 행 × (식별 열 + 패널 필드)
import type { RunRow } from '../api/types';
import { fieldValue } from './charts/fields';
import { csvLine } from './stats';
import { panelFieldRefs, type PanelSpec, type WorkbenchData } from './workbench';

/** runIds를 주면 그 run만(시계열 패널), 아니면 데이터 전체. 필드가 없는 패널은 파라미터 전체를 쓴다. */
export function panelCsv(spec: PanelSpec, data: WorkbenchData, runIds?: string[]): string {
  const refs = panelFieldRefs(spec);
  const cols = refs.length ? refs : data.params.map(name => ({ kind: 'param' as const, name }));
  let rows: RunRow[] = data.rows;
  if (runIds) {
    const byId = new Map(data.rows.map(r => [r.id, r]));
    rows = runIds.flatMap(id => byId.get(id) ?? []);
  }
  const jobName = new Map(data.jobs.map(j => [j.id, j.name]));
  const variantLabel = new Map(data.variants.map(v => [v.id, v.label]));
  const header = ['run', 'job', 'index', 'status', 'variant', ...cols.map(c => c.name)];
  const lines = rows.map(r => csvLine([
    r.id, jobName.get(r.jobId) ?? r.jobId, r.index, r.status, variantLabel.get(r.variantId) ?? r.variantId,
    ...cols.map(c => fieldValue(r, c, data.objectives)),
  ]));
  return [csvLine(header), ...lines].join('\n') + '\n';
}
