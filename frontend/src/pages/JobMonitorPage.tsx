import { Alert, Button, Card, Group, MultiSelect, Progress, Select, Stack, Text, Title } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ReactECharts from 'echarts-for-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useApi } from '../api/client';
import type { Direction, Job, OptimizationRequest, RunRow } from '../api/types';
import { BestTrialCard } from '../components/BestTrialCard';
import { CandidateBarChart } from '../components/CandidateBarChart';
import { JobStatusBadge } from '../components/JobStatusBadge';
import { ObjectivePicker } from '../components/ObjectivePicker';
import { useResources } from '../components/ResourceGroupSection';
import { RunTable, type Sort } from '../components/RunTable';
import { ScatterChart } from '../components/ScatterChart';
import { StaleSnapshotAlert } from '../components/StaleSnapshotAlert';
import { TimeseriesChart } from '../components/TimeseriesChart';
import { paretoFront } from '../lib/pareto';

const REFRESH_DEBOUNCE_MS = 500;
const ACTIVE = ['queued', 'running'];

function ConvergenceChart({ rows, objectiveId, direction }: { rows: RunRow[]; objectiveId: string; direction: Direction }) {
  const pts = [...rows]
    .sort((a, b) => a.index - b.index)
    .map(r => [r.index, r.objectives[objectiveId]?.value ?? null] as const)
    .filter((p): p is readonly [number, number] => p[1] !== null);
  let best: number | null = null;
  const bestLine = pts.map(([i, v]) => {
    best = best === null ? v : direction === 'minimize' ? Math.min(best, v) : Math.max(best, v);
    return [i, best];
  });
  const option = {
    animation: false,
    tooltip: { trigger: 'axis' },
    legend: { top: 0 },
    grid: { left: 60, right: 20, top: 30, bottom: 40 },
    xAxis: { type: 'value', name: 'trial', nameLocation: 'middle', nameGap: 25 },
    yAxis: { type: 'value', scale: true },
    series: [
      { name: 'trial 값', type: 'scatter', symbolSize: 6, data: pts },
      { name: '현재까지 최적', type: 'line', step: 'end', showSymbol: false, data: bestLine },
    ],
  };
  return <ReactECharts data-testid="convergence-chart" option={option} notMerge style={{ height: 320 }} />;
}

function ParetoView({ rows, objectives, directions, selected, onPick }: {
  rows: RunRow[]; objectives: { id: string; name: string }[]; directions: Direction[];
  selected: string[]; onPick: (id: string) => void;
}) {
  const [xId, setXId] = useState(objectives[0].id);
  const [yId, setYId] = useState(objectives[1].id);
  const ok = rows.filter(r => objectives.every(o => r.objectives[o.id]?.value != null));
  const front = paretoFront(ok.map(r => objectives.map(o => r.objectives[o.id].value)), directions);
  const data = objectives.map(o => ({ value: o.id, label: o.name }));
  const name = (id: string) => objectives.find(o => o.id === id)?.name ?? id;
  return (
    <Stack gap="xs">
      <Group>
        <Select label="X축" data={data} value={xId} onChange={v => v && setXId(v)} w={200} />
        <Select label="Y축" data={data} value={yId} onChange={v => v && setYId(v)} w={200} />
        <Text size="xs" c="dimmed" mt="lg">Pareto front: {front.filter(Boolean).length}개 (전체 목적 기준)</Text>
      </Group>
      <ScatterChart testId="pareto-chart" highlightName="Pareto front" xLabel={name(xId)} yLabel={name(yId)}
        selectedIds={selected} onPointClick={onPick}
        points={ok.map((r, i) => ({ id: r.id, x: r.objectives[xId].value!, y: r.objectives[yId].value!, highlight: front[i] }))} />
    </Stack>
  );
}

export function JobMonitorPage() {
  const { jobId = '' } = useParams();
  const api = useApi();
  const qc = useQueryClient();
  const job = useQuery({ queryKey: ['job', jobId], queryFn: () => api.getJob(jobId) });
  const objectivesList = useQuery({ queryKey: ['objectives'], queryFn: () => api.listObjectives() });
  const [pickedObjectives, setPickedObjectives] = useState<string[]>([]);
  const [sort, setSort] = useState<Sort>({ by: 'index', dir: 'asc' });
  const [selected, setSelected] = useState<string[]>([]);
  const [tsVars, setTsVars] = useState<string[] | null>(null);
  const [barObjective, setBarObjective] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 실시간 이벤트: 잡 상태는 바로 반영, run 목록은 디바운스 후 재조회
  useEffect(() => {
    const off = api.subscribeJob(jobId, e => {
      if (e.type === 'progress' || e.type === 'end') qc.setQueryData<Job>(['job', jobId], e.job);
      if (e.type === 'run' || e.type === 'end') {
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
        refreshTimer.current = setTimeout(() => {
          qc.invalidateQueries({ queryKey: ['runs', 'job', jobId] });
          qc.invalidateQueries({ queryKey: ['variants'] });
        }, e.type === 'end' ? 0 : REFRESH_DEBOUNCE_MS);
      }
    });
    return () => {
      off();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [api, qc, jobId]);

  const j = job.data;
  const optConfig = j?.kind === 'optimization' ? (j.config as OptimizationRequest) : null;
  const existing = new Set((objectivesList.data ?? []).map(o => o.id));
  const objectiveIds = (optConfig ? optConfig.objectives.map(o => o.objectiveId) : pickedObjectives).filter(id => existing.has(id));
  const objectiveMeta = objectiveIds.map(id => ({
    id, name: objectivesList.data?.find(o => o.id === id)?.name ?? j?.objectiveSnapshot?.[id]?.name ?? id,
  }));

  const runs = useQuery({
    queryKey: ['runs', 'job', jobId, objectiveIds, sort],
    queryFn: () => api.listRuns({ jobIds: [jobId], objectiveIds, sortBy: sort.by, sortDir: sort.dir, limit: 10000 }),
    enabled: !!j && objectivesList.isSuccess,
  });
  const fmuId = j?.fmuId ?? '';
  const variants = useQuery({ queryKey: ['variants', fmuId], queryFn: () => api.listVariants(fmuId), enabled: !!fmuId });
  const resourceFiles = useResources(fmuId);
  const cancel = useMutation({ mutationFn: () => api.cancelJob(jobId), onSuccess: d => qc.setQueryData(['job', jobId], d) });

  const paramNames = useMemo(() => {
    if (!j) return [];
    if (optConfig) return optConfig.designVars.map(d => d.name);
    return 'params' in j.config ? (j.config as { params: { name: string }[] }).params.map(p => p.name) : [];
  }, [j, optConfig]);

  if (!j) return job.isError ? <Text c="red">{(job.error as Error).message}</Text> : null;
  const done = j.completed + j.failed;
  const rows = runs.data?.items ?? [];
  const vars = tsVars ?? j.config.recordVariables.slice(0, 1);
  const toggle = (id: string) => setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : s.length >= 10 ? s : [...s, id]));
  const runLabel = (id: string) => `#${rows.find(r => r.id === id)?.index ?? '?'}`;
  const variantList = variants.data ?? [];
  const configResources = (j.config as { resources?: Record<string, unknown> }).resources ?? {};
  const showVariants = Object.keys(configResources).length > 0 || variantList.length > 1;
  const variantLabel = (id: string) => variantList.find(v => v.id === id)?.label ?? id.slice(0, 8);
  const searchFiles = optConfig
    ? (resourceFiles.data ?? []).filter(f => optConfig.resources?.[f.path]?.mode === 'search')
    : [];
  const barObjectiveId = barObjective && objectiveIds.includes(barObjective) ? barObjective : objectiveIds[0];
  const barDirection = optConfig?.objectives.find(o => o.objectiveId === barObjectiveId)?.direction ?? 'minimize';

  return (
    <Stack>
      <Group justify="space-between">
        <Group>
          <Title order={2}>잡 모니터 — {j.name}</Title>
          <JobStatusBadge status={j.status} />
        </Group>
        {ACTIVE.includes(j.status) && (
          <Button color="red" variant="light" onClick={() => cancel.mutate()} loading={cancel.isPending}>취소</Button>
        )}
      </Group>
      <Card withBorder>
        <Progress value={j.total ? (100 * done) / j.total : 0} />
        <Group justify="space-between" mt={4}>
          <Text size="sm" data-testid="job-progress-text">{done} / {j.total}</Text>
          <Text size="sm" c={j.failed ? 'red' : 'dimmed'}>실패 {j.failed}</Text>
        </Group>
        {j.error && <Alert color="red" mt="xs">{j.error}</Alert>}
      </Card>

      {optConfig && <StaleSnapshotAlert snapshot={j.objectiveSnapshot} current={runs.data?.codeHashes ?? {}} />}

      {!optConfig && (
        <Card withBorder>
          <Text size="sm" fw={500} mb="xs">표시할 목적함수 (현재 코드로 계산)</Text>
          <ObjectivePicker value={pickedObjectives} onChange={setPickedObjectives} />
        </Card>
      )}

      {optConfig && objectiveMeta.length === 1 && (
        <Card withBorder>
          <ConvergenceChart rows={rows} objectiveId={objectiveMeta[0].id} direction={optConfig.objectives[0].direction} />
        </Card>
      )}
      {optConfig && objectiveMeta.length === 1 && (
        <BestTrialCard rows={rows} objective={objectiveMeta[0]} direction={optConfig.objectives[0].direction}
          paramNames={paramNames} variantLabel={variantLabel} />
      )}
      {optConfig && searchFiles.length > 0 && barObjectiveId && (
        <Card withBorder>
          <Group mb="xs">
            <Text size="sm" fw={500}>후보별 목적함수 (성공 trial)</Text>
            {objectiveMeta.length > 1 && (
              <Select aria-label="막대 기준 목적함수" size="xs" value={barObjectiveId} allowDeselect={false}
                data={objectiveMeta.map(o => ({ value: o.id, label: o.name }))} onChange={setBarObjective}
                comboboxProps={{ transitionProps: { duration: 0 } }} />
            )}
          </Group>
          {searchFiles.map(f => (
            <div key={f.path}>
              <Text size="xs" ff="monospace" c="dimmed">{f.path}</Text>
              <CandidateBarChart rows={rows} variants={variantList} file={f} objectiveId={barObjectiveId} direction={barDirection} />
            </div>
          ))}
        </Card>
      )}
      {optConfig && objectiveMeta.length >= 2 && (
        <Card withBorder>
          <ParetoView rows={rows} objectives={objectiveMeta} selected={selected} onPick={toggle}
            directions={objectiveMeta.map(o => optConfig.objectives.find(x => x.objectiveId === o.id)!.direction)} />
        </Card>
      )}

      {runs.isError && <Alert color="red">{(runs.error as Error).message}</Alert>}
      <RunTable rows={rows} paramNames={paramNames} objectives={objectiveMeta} codeHashes={runs.data?.codeHashes ?? {}}
        sort={sort} onSort={setSort} selected={selected} onToggle={toggle} variantLabel={showVariants ? variantLabel : undefined} />

      <Card withBorder>
        <Group mb="xs">
          <Text size="sm" fw={500}>시계열 비교 (최대 10개 run)</Text>
          <MultiSelect placeholder="변수" searchable data={j.config.recordVariables} value={vars} onChange={setTsVars} w={420}
            comboboxProps={{ transitionProps: { duration: 0 } }} />
        </Group>
        <TimeseriesChart runs={selected.map(id => ({ runId: id, label: runLabel(id) }))} vars={vars} />
      </Card>
    </Stack>
  );
}
