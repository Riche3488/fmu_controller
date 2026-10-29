import {
  Alert, Button, Card, Group, Loader, MultiSelect, Pagination, Select, Stack, Table, Tabs, Text, Title,
} from '@mantine/core';
import { useQueries, useQuery } from '@tanstack/react-query';
import ReactECharts from 'echarts-for-react';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useApi } from '../api/client';
import type { FmuSummary, Job, RunPage, RunRow } from '../api/types';
import { ObjectivePicker } from '../components/ObjectivePicker';
import { useVariants } from '../components/ResourceGroupSection';
import { RunTable, type Sort } from '../components/RunTable';
import { ScatterChart } from '../components/ScatterChart';
import { TimeseriesChart } from '../components/TimeseriesChart';
import { boxStats, csvLine } from '../lib/stats';

const PAGE_SIZE = 100;
const ALL = 100000;

function useObjectiveMeta(ids: string[]) {
  const api = useApi();
  const list = useQuery({ queryKey: ['objectives'], queryFn: () => api.listObjectives() });
  return ids.map(id => ({ id, name: list.data?.find(o => o.id === id)?.name ?? id }));
}

function paramNamesOf(rows: RunRow[]): string[] {
  const names = new Set<string>();
  rows.forEach(r => Object.keys(r.params).forEach(k => names.add(k)));
  return [...names].sort();
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function axisValue(r: RunRow, key: string): number | null {
  if (key.startsWith('param:')) {
    const v = r.params[key.slice(6)];
    return typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : null;
  }
  return r.objectives[key.slice(10)]?.value ?? null;
}

function FmuResults({ fmu }: { fmu: FmuSummary }) {
  const api = useApi();
  const [jobIds, setJobIds] = useState<string[]>([]);
  const [variantIds, setVariantIds] = useState<string[]>([]);
  const [status, setStatus] = useState<'ok' | 'failed' | null>(null);
  const [objectiveIds, setObjectiveIds] = useState<string[]>([]);
  const [sort, setSort] = useState<Sort>({ by: 'index', dir: 'asc' });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [xKey, setXKey] = useState<string | null>(null);
  const [yKey, setYKey] = useState<string | null>(null);
  const [tsVars, setTsVars] = useState<string[] | null>(null);
  const objectives = useObjectiveMeta(objectiveIds);

  const jobs = useQuery({ queryKey: ['jobs', fmu.id], queryFn: () => api.listJobs({ fmuId: fmu.id }) });
  const variants = useVariants(fmu.id);
  const filter = {
    fmuId: fmu.id, jobIds: jobIds.length ? jobIds : undefined, status: status ?? undefined, objectiveIds,
    variantIds: variantIds.length ? variantIds : undefined,
  };
  const pageQuery = useQuery({
    queryKey: ['runs', 'results', filter, sort, page],
    queryFn: () => api.listRuns({ ...filter, sortBy: sort.by, sortDir: sort.dir, offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE }),
  });
  const allQuery = useQuery({
    queryKey: ['runs', 'results-all', filter],
    queryFn: () => api.listRuns({ ...filter, limit: ALL }),
  });

  const allRows = allQuery.data?.items ?? [];
  const paramNames = useMemo(() => paramNamesOf(allRows), [allRows]);
  const jobName = (id: string) => jobs.data?.find(j => j.id === id)?.name ?? id;
  const variantList = variants.data ?? [];
  const variantLabel = (id: string) => variantList.find(v => v.id === id)?.label ?? id.slice(0, 8);
  const codeHashes = pageQuery.data?.codeHashes ?? {};
  const recordVars = useMemo(() => [...new Set((jobs.data ?? []).flatMap(j => j.config.recordVariables))], [jobs.data]);
  const vars = tsVars ?? recordVars.slice(0, 1);
  const toggle = (id: string) => setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : s.length >= 10 ? s : [...s, id]));

  const exportCsv = () => {
    // 값과 해시는 반드시 같은 응답에서 가져온다 (두 조회 사이에 코드가 바뀌어도 라벨이 어긋나지 않도록)
    const exportHashes = allQuery.data?.codeHashes ?? {};
    const header = ['job', 'index', 'status', 'variant', ...paramNames, ...objectives.map(o => `${o.name}[${(exportHashes[o.id] ?? '').slice(0, 8)}]`)];
    const lines = allRows.map(r => csvLine([
      jobName(r.jobId), r.index, r.status, variantLabel(r.variantId), ...paramNames.map(p => r.params[p]), ...objectives.map(o => r.objectives[o.id]?.value),
    ]));
    download(`${fmu.fileName.replace(/\.fmu$/i, '')}-results.csv`, [csvLine(header), ...lines].join('\n') + '\n');
  };

  const axisOptions = [
    ...paramNames.map(p => ({ value: `param:${p}`, label: p })),
    ...objectives.map(o => ({ value: `objective:${o.id}`, label: o.name })),
  ];
  const label = (key: string | null) => axisOptions.find(o => o.value === key)?.label ?? '';
  const scatterPoints = xKey && yKey
    ? allRows.flatMap(r => {
      const x = axisValue(r, xKey), y = axisValue(r, yKey);
      return x === null || y === null ? [] : [{ id: r.id, x, y }];
    })
    : [];
  const total = pageQuery.data?.total ?? 0;

  return (
    <Stack>
      <Group align="end">
        <MultiSelect label="잡 필터" placeholder="모든 잡" clearable w={360} value={jobIds}
          onChange={v => { setJobIds(v); setPage(1); }} comboboxProps={{ transitionProps: { duration: 0 } }}
          data={(jobs.data ?? []).map((j: Job) => ({ value: j.id, label: `${j.name} (${j.kind === 'batch' ? '배치' : '최적화'})` }))} />
        {variantList.length > 1 && (
          <MultiSelect label="Resource 조합" placeholder="모든 조합" clearable w={360} value={variantIds}
            onChange={v => { setVariantIds(v); setPage(1); }} comboboxProps={{ transitionProps: { duration: 0 } }}
            data={variantList.map(v => ({ value: v.id, label: v.label }))} />
        )}
        <Select label="상태" placeholder="전체" clearable w={140} value={status} data={['ok', 'failed']}
          onChange={v => { setStatus(v as typeof status); setPage(1); }} comboboxProps={{ transitionProps: { duration: 0 } }} />
        <Button variant="default" onClick={exportCsv} disabled={!allQuery.data}>CSV 내보내기</Button>
      </Group>
      <Card withBorder>
        <Text size="sm" fw={500} mb="xs">표시할 목적함수</Text>
        <ObjectivePicker value={objectiveIds} onChange={setObjectiveIds} />
        {objectiveIds.length > 0 && (
          <Group gap="xs" mt="xs">
            <Text size="xs" c="blue">현재 목적함수 코드 기준으로 계산된 값입니다</Text>
            {(pageQuery.isFetching || allQuery.isFetching) && <Loader size="xs" />}
          </Group>
        )}
      </Card>
      {pageQuery.isError && <Alert color="red">{(pageQuery.error as Error).message}</Alert>}
      <RunTable rows={pageQuery.data?.items ?? []} paramNames={paramNames} objectives={objectives} codeHashes={codeHashes}
        sort={sort} onSort={s => { setSort(s); setPage(1); }} selected={selected} onToggle={toggle} showJob={jobName}
        variantLabel={variantList.length > 1 ? variantLabel : undefined} />
      <Group justify="space-between">
        <Text size="xs" c="dimmed">총 {total.toLocaleString()}개 run</Text>
        <Pagination total={Math.max(1, Math.ceil(total / PAGE_SIZE))} value={page} onChange={setPage} size="sm" />
      </Group>

      <Card withBorder>
        <Group mb="xs">
          <Select label="X축" placeholder="파라미터 또는 목적함수" data={axisOptions} value={xKey} onChange={setXKey} w={260}
            comboboxProps={{ transitionProps: { duration: 0 } }} />
          <Select label="Y축" placeholder="목적함수" data={axisOptions.filter(o => o.value.startsWith('objective:'))} value={yKey}
            onChange={setYKey} w={260} comboboxProps={{ transitionProps: { duration: 0 } }} />
        </Group>
        <ScatterChart testId="results-scatter" points={scatterPoints} xLabel={label(xKey)} yLabel={label(yKey)}
          selectedIds={selected} onPointClick={toggle} />
      </Card>

      <Card withBorder>
        <Group mb="xs">
          <Text size="sm" fw={500}>선택한 run 시계열 (최대 10개)</Text>
          <MultiSelect placeholder="변수" searchable data={recordVars} value={vars} onChange={setTsVars} w={420}
            comboboxProps={{ transitionProps: { duration: 0 } }} />
        </Group>
        <TimeseriesChart vars={vars} runs={selected.map(id => {
          const r = allRows.find(x => x.id === id);
          return { runId: id, label: r ? `${jobName(r.jobId)}#${r.index}` : id };
        })} />
      </Card>
    </Stack>
  );
}

function FmuCompare({ fmu }: { fmu: FmuSummary }) {
  const api = useApi();
  const fmus = useQuery({ queryKey: ['fmus'], queryFn: () => api.listFmus() });
  const [others, setOthers] = useState<string[]>([]);
  const [objectiveIds, setObjectiveIds] = useState<string[]>([]);
  const [selectedRuns, setSelectedRuns] = useState<string[]>([]);
  const [tsVars, setTsVars] = useState<string[]>([]);
  const objectives = useObjectiveMeta(objectiveIds);
  const ids = [fmu.id, ...others];
  const jobs = useQuery({ queryKey: ['jobs'], queryFn: () => api.listJobs() });
  const recordVars = [...new Set((jobs.data ?? []).filter(j => ids.includes(j.fmuId)).flatMap(j => j.config.recordVariables))];
  const byId = (id: string) => fmus.data?.find(f => f.id === id);

  const results = useQueries({
    queries: ids.map(id => ({
      queryKey: ['runs', 'compare', id, objectiveIds],
      queryFn: () => api.listRuns({ fmuId: id, status: 'ok', objectiveIds, limit: ALL }),
    })),
  });
  const pages = results.map(r => r.data);
  const ready = pages.every(Boolean);
  const names = ids.map(id => byId(id)?.fileName ?? id);
  const runLabel = (r: RunRow) => `${byId(r.fmuId)?.fileName ?? r.fmuId}#${r.index}`;
  const allRuns = (pages.filter(Boolean) as RunPage[]).flatMap(p => p.items);

  const option = {
    animation: false,
    tooltip: { trigger: 'item' },
    legend: { top: 0 },
    grid: { left: 60, right: 20, top: 40, bottom: 40 },
    xAxis: { type: 'category', data: names },
    yAxis: { type: 'value', scale: true },
    series: objectives.map(o => ({
      name: o.name, type: 'boxplot',
      data: pages.map(p => boxStats((p?.items ?? []).map(r => r.objectives[o.id]?.value).filter((v): v is number => v != null)) ?? []),
    })),
  };

  return (
    <Stack>
      <MultiSelect label="비교할 FMU" placeholder="FMU 선택" value={others} onChange={setOthers} w={480}
        comboboxProps={{ transitionProps: { duration: 0 } }}
        data={(fmus.data ?? []).filter(f => f.id !== fmu.id).map(f => ({ value: f.id, label: `${f.fileName} — ${f.modelName}` }))} />
      <Card withBorder>
        <Text size="sm" fw={500} mb="xs">비교할 목적함수 (현재 코드로 계산)</Text>
        <ObjectivePicker value={objectiveIds} onChange={setObjectiveIds} />
      </Card>
      {objectives.length > 0 && (
        <Card withBorder>
          {!ready && <Loader size="sm" />}
          <ReactECharts data-testid="compare-boxplot" option={option} notMerge style={{ height: 360 }} />
          <Table fz="xs" mt="sm">
            <Table.Thead>
              <Table.Tr><Table.Th>FMU</Table.Th><Table.Th>ok run</Table.Th>
                {objectives.map(o => <Table.Th key={o.id}>{o.name} 중앙값</Table.Th>)}</Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {ids.map((id, i) => (
                <Table.Tr key={id}>
                  <Table.Td>{names[i]}</Table.Td>
                  <Table.Td>{pages[i]?.total ?? '-'}</Table.Td>
                  {objectives.map(o => {
                    const st = boxStats((pages[i]?.items ?? []).map(r => r.objectives[o.id]?.value).filter((v): v is number => v != null));
                    return <Table.Td key={o.id}>{st ? +st[2].toFixed(6) : '-'}</Table.Td>;
                  })}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      )}
      <Card withBorder>
        <Group mb="xs" align="end">
          <MultiSelect label="시계열 비교 run" placeholder="run 선택 (최대 10개)" searchable maxValues={10} w={420}
            value={selectedRuns} onChange={setSelectedRuns} comboboxProps={{ transitionProps: { duration: 0 } }}
            data={allRuns.map(r => ({ value: r.id, label: runLabel(r) }))} />
          <MultiSelect label="변수" placeholder="변수 이름" searchable w={420} value={tsVars} onChange={setTsVars}
            comboboxProps={{ transitionProps: { duration: 0 } }}
            data={recordVars} />
        </Group>
        <TimeseriesChart vars={tsVars} runs={selectedRuns.map(id => {
          const r = allRuns.find(x => x.id === id);
          return { runId: id, label: r ? runLabel(r) : id };
        })} />
      </Card>
    </Stack>
  );
}

/** 같은 FMU의 resource 조합끼리 목적함수 분포 비교 */
function VariantCompare({ fmu }: { fmu: FmuSummary }) {
  const api = useApi();
  const [objectiveIds, setObjectiveIds] = useState<string[]>([]);
  const objectives = useObjectiveMeta(objectiveIds);
  const variants = useVariants(fmu.id);
  const runs = useQuery({
    queryKey: ['runs', 'variant-compare', fmu.id, objectiveIds],
    queryFn: () => api.listRuns({ fmuId: fmu.id, status: 'ok', objectiveIds, limit: ALL }),
    enabled: objectiveIds.length > 0,
  });
  const rows = runs.data?.items ?? [];
  const shown = (variants.data ?? []).filter(v => rows.some(r => r.variantId === v.id));
  const valuesOf = (variantId: string, objectiveId: string) => rows
    .filter(r => r.variantId === variantId).map(r => r.objectives[objectiveId]?.value).filter((v): v is number => v != null);
  const option = {
    animation: false,
    tooltip: { trigger: 'item' },
    legend: { top: 0 },
    grid: { left: 60, right: 20, top: 40, bottom: 60 },
    xAxis: { type: 'category', data: shown.map(v => v.label), axisLabel: { interval: 0, rotate: shown.length > 4 ? 20 : 0 } },
    yAxis: { type: 'value', scale: true },
    series: objectives.map(o => ({ name: o.name, type: 'boxplot', data: shown.map(v => boxStats(valuesOf(v.id, o.id)) ?? []) })),
  };
  return (
    <Stack>
      <Card withBorder>
        <Text size="sm" fw={500} mb="xs">비교할 목적함수 (현재 코드로 계산)</Text>
        <ObjectivePicker value={objectiveIds} onChange={setObjectiveIds} />
      </Card>
      {(variants.data?.length ?? 0) <= 1 && <Text size="sm" c="dimmed">resource 후보로 해석한 결과가 아직 없습니다 (원본 조합만 있음)</Text>}
      {objectives.length > 0 && (
        <Card withBorder>
          {runs.isFetching && <Loader size="sm" />}
          {runs.isError && <Alert color="red">{(runs.error as Error).message}</Alert>}
          <ReactECharts data-testid="variant-boxplot" option={option} notMerge style={{ height: 360 }} />
          <Table fz="xs" mt="sm">
            <Table.Thead>
              <Table.Tr><Table.Th>Resource 조합</Table.Th><Table.Th>ok run</Table.Th>
                {objectives.map(o => <Table.Th key={o.id}>{o.name} 중앙값</Table.Th>)}</Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {shown.map(v => (
                <Table.Tr key={v.id}>
                  <Table.Td>{v.label}</Table.Td>
                  <Table.Td>{rows.filter(r => r.variantId === v.id).length}</Table.Td>
                  {objectives.map(o => {
                    const st = boxStats(valuesOf(v.id, o.id));
                    return <Table.Td key={o.id}>{st ? +st[2].toFixed(6) : '-'}</Table.Td>;
                  })}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      )}
    </Stack>
  );
}

export function ResultsPage() {
  const { fmuId = '' } = useParams();
  const api = useApi();
  const fmu = useQuery({ queryKey: ['fmu', fmuId], queryFn: () => api.getFmu(fmuId) });
  if (!fmu.data) return fmu.isError ? <Text c="red">{(fmu.error as Error).message}</Text> : null;
  return (
    <Stack>
      <Title order={2}>결과 조회</Title>
      <Text c="dimmed" size="sm">{fmu.data.modelName} · {fmu.data.fileName} — 누적 run {fmu.data.nRuns.toLocaleString()}개</Text>
      <Tabs defaultValue="results" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="results">결과</Tabs.Tab>
          <Tabs.Tab value="compare">FMU 비교</Tabs.Tab>
          <Tabs.Tab value="variants">Resource 조합 비교</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="results" pt="sm"><FmuResults fmu={fmu.data} /></Tabs.Panel>
        <Tabs.Panel value="compare" pt="sm"><FmuCompare fmu={fmu.data} /></Tabs.Panel>
        <Tabs.Panel value="variants" pt="sm"><VariantCompare fmu={fmu.data} /></Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
