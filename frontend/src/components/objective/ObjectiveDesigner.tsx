// 목적함수 설계기: 블록 빌더 + 실제 run 미리보기 + 호환성 + 일괄 적용 + 생성 코드
import { Alert, Badge, Button, Card, Collapse, Grid, Group, Modal, Select, SimpleGrid, Stack, Text } from '@mantine/core';
import Editor from '@monaco-editor/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from '../../api/client';
import type { Job } from '../../api/types';
import { generateCode, parseBuilderCode } from '../../lib/builder/codegen';
import { DEFAULT_SPEC, specColumns, type BuilderSpec } from '../../lib/builder/spec';
import { jobCompat, requiredColumns } from '../../lib/compat';
import { useOutputNames } from '../RunSettingsSection';
import { BatchApply } from './BatchApply';
import { BuilderPanel } from './BuilderPanel';
import type { SignalGroups } from './builderFields';
import { CompatBox } from './CompatBox';
import { PreviewCharts } from './PreviewCharts';
import { evaluatePreview } from './previewEval';
import { TrialRunButton } from './TrialRunButton';

type Value = { name: string; code: string };
type Mode = 'builder' | 'code';

/** 헤더가 있고 본문이 그 스펙으로 다시 생성한 것과 같으면 빌더 모드 */
function initFromCode(code: string): { mode: Mode; spec: BuilderSpec } {
  try {
    const p = parseBuilderCode(code);
    if (p?.intact) return { mode: 'builder', spec: p.spec };
    return { mode: 'code', spec: p?.spec ?? DEFAULT_SPEC };
  } catch {
    return { mode: 'code', spec: DEFAULT_SPEC };
  }
}

function safeColumns(spec: BuilderSpec): string[] {
  try { return specColumns(spec); } catch { return ['time']; }
}

const recordedOf = (job: Job | undefined, outputs: string[]) =>
  job ? (job.config.recordVariables.length ? job.config.recordVariables : outputs) : [];

const fmtValue = (v: number) => String(Number(v.toPrecision(6)));

export function ObjectiveDesigner({ fmuId, value, onChange }: {
  fmuId: string; value: Value; onChange: (v: Value) => void;
}) {
  const api = useApi();
  const [init] = useState(() => initFromCode(value.code));
  const [mode, setMode] = useState<Mode>(init.mode);
  const [spec, setSpecState] = useState<BuilderSpec>(init.spec);
  const [pickedRunId, setPickedRunId] = useState<string | null>(null);
  const [codeOpen, setCodeOpen] = useState(false);
  const [revertOpen, setRevertOpen] = useState(false);

  // 부모가 다른 코드를 넣으면(다른 목적함수를 불러옴 등) 다시 판정한다. 우리가 낸 코드는 무시.
  const emitted = useRef(value.code);
  useEffect(() => {
    if (value.code === emitted.current) return;
    emitted.current = value.code;
    const next = initFromCode(value.code);
    setMode(next.mode);
    setSpecState(next.spec);
  }, [value.code]);

  const emit = (code: string) => {
    emitted.current = code;
    onChange({ name: value.name, code });
  };
  const setSpec = (s: BuilderSpec) => {
    setSpecState(s);
    emit(generateCode(s));
  };

  const runs = useQuery({
    queryKey: ['runs', 'designer', fmuId],
    queryFn: () => api.listRuns({ fmuId, status: 'ok', limit: 200 }),
  });
  const jobs = useQuery({ queryKey: ['jobs', fmuId], queryFn: () => api.listJobs({ fmuId }) });
  const outputs = useOutputNames(fmuId);
  const allVars = useQuery({
    queryKey: ['variables', fmuId, 'all', 'all-names'],
    queryFn: () => api.listVariables(fmuId, { offset: 0, limit: 100000 }),
  });
  const fmuVarNames = useMemo(() => allVars.data?.items.map(v => v.name), [allVars.data]);

  const columns = mode === 'builder' ? safeColumns(spec) : ['time', ...requiredColumns(value.code).columns];
  const required = columns.filter(c => c !== 'time');
  const estimated = mode === 'code';

  const jobList = jobs.data ?? [];
  const outs = outputs.data ?? [];
  const okJobIds = new Set(jobCompat(required, jobList, outs).filter(c => c.ok).map(c => c.jobId));
  const runItems = runs.data?.items ?? [];
  // 고른 run이 없으면 필요한 컬럼을 모두 기록한 잡의 run을 먼저 쓴다
  const previewRun = runItems.find(r => r.id === pickedRunId)
    ?? runItems.find(r => okJobIds.has(r.jobId)) ?? runItems[0];
  const previewJob = jobList.find(j => j.id === previewRun?.jobId);
  const recorded = recordedOf(previewJob, outs);
  const recordedSet = new Set(recorded);
  const fetchVars = required.filter(c => recordedSet.has(c));
  const needTrial = runs.isSuccess && jobs.isSuccess && !runItems.some(r => okJobIds.has(r.jobId));

  const ts = useQuery({
    queryKey: ['timeseries', previewRun?.id, fetchVars],
    queryFn: () => api.getTimeseries(previewRun!.id, fetchVars, 2000),
    enabled: mode === 'builder' && !!previewRun && !!previewJob,
  });
  const preview = useMemo(
    () => (mode === 'builder' && ts.data && previewRun ? evaluatePreview(spec, ts.data, recorded, previewRun.params) : null),
    [mode, spec, ts.data, previewRun, recorded.join('\n')], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const derivedNames = (spec.derived ?? []).map(d => d.name).filter(Boolean);
  const groups: SignalGroups = useMemo(() => {
    const seen = new Set<string>();
    const take = (xs: string[]) => xs.filter(x => (seen.has(x) ? false : (seen.add(x), true)));
    return [
      { group: '기록된 신호', items: take(['time', ...recorded]) },
      { group: '파생 신호', items: take(derivedNames) },
      { group: 'FMU 변수', items: take(fmuVarNames ?? outs) },
    ].filter(g => g.items.length > 0);
  }, [recorded.join('\n'), derivedNames.join('\n'), fmuVarNames, outs]); // eslint-disable-line react-hooks/exhaustive-deps
  const defaultSignal = recorded[0] ?? 'time';
  const paramNames = Object.keys(previewRun?.params ?? {});
  const runLabel = (jobId: string, index: number) => `${jobList.find(j => j.id === jobId)?.name ?? jobId} #${index}`;

  const header = mode === 'code' ? parseBuilderCode(value.code) : null;
  const revert = () => {
    if (!header) return;
    setRevertOpen(false);
    setMode('builder');
    setSpec(header.spec);
  };

  const previewPane = (
    <Stack gap="sm">
      <Group align="flex-end">
        <Select
          label="미리보기 run" placeholder={runItems.length ? undefined : '성공한 run이 없습니다'} style={{ flex: 1 }}
          data={runItems.map(r => ({ value: r.id, label: runLabel(r.jobId, r.index) }))} searchable
          value={previewRun?.id ?? null} onChange={id => id && setPickedRunId(id)} allowDeselect={false}
        />
        {needTrial && <TrialRunButton fmuId={fmuId} columns={columns} onDone={id => setPickedRunId(id)} />}
      </Group>
      {mode === 'builder' && (
        <>
          {preview?.error && <Alert color="red" variant="light">{preview.error}</Alert>}
          {preview && preview.value !== null && (
            <Text className="fmuc-num" fz={32} fw={500} data-testid="builder-value">{fmtValue(preview.value)}</Text>
          )}
          {ts.isError && <Alert color="red" variant="light">{(ts.error as Error).message}</Alert>}
          <Group gap={4}>
            <Text size="xs" c="dimmed">필요한 컬럼</Text>
            {required.length === 0 && <Text size="xs" c="dimmed">없음</Text>}
            {required.map(c => (
              <Badge key={c} size="sm" variant="outline" color={previewRun && !recordedSet.has(c) ? 'red' : 'gray'} tt="none">{c}</Badge>
            ))}
          </Group>
          {preview && ts.data && (
            <PreviewCharts time={ts.data.time} signals={preview.signals} trace={preview.trace} markSignal={spec.calc.signal} />
          )}
        </>
      )}
    </Stack>
  );

  return (
    <Stack>
      {mode === 'builder' ? (
        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, md: 5 }}>
            <Card><BuilderPanel spec={spec} onChange={setSpec} groups={groups} paramNames={paramNames} defaultSignal={defaultSignal} /></Card>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 7 }}><Card>{previewPane}</Card></Grid.Col>
        </Grid>
      ) : (
        <Card>{previewPane}</Card>
      )}

      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Card>
          <Stack gap="xs">
            <Text className="fmuc-label">호환성</Text>
            <CompatBox fmuId={fmuId} required={required} estimated={estimated}
              jobs={jobs.data} outputNames={outputs.data} fmuVarNames={fmuVarNames} />
          </Stack>
        </Card>
        <Card>
          <Stack gap="xs">
            <Text className="fmuc-label">일괄 적용</Text>
            <BatchApply code={value.code} fmuId={fmuId} />
          </Stack>
        </Card>
      </SimpleGrid>

      <Card>
        <Group justify="space-between">
          <Text className="fmuc-label">{mode === 'builder' ? '생성된 코드' : '코드 (직접 편집)'}</Text>
          <Group gap="xs">
            {mode === 'builder' && (
              <>
                <Button variant="subtle" size="xs" onClick={() => setCodeOpen(o => !o)}>{codeOpen ? '코드 접기' : '코드 펼치기'}</Button>
                <Button variant="light" size="xs" onClick={() => { setMode('code'); setCodeOpen(true); }}>코드로 직접 편집</Button>
              </>
            )}
            {mode === 'code' && header && (
              <Button variant="light" size="xs" onClick={() => setRevertOpen(true)}>빌더로 되돌리기</Button>
            )}
          </Group>
        </Group>
        <Collapse in={mode === 'code' || codeOpen}>
          <div style={{ marginTop: 8 }}>
            <Editor
              height="50vh" language="python" value={value.code}
              options={{ readOnly: mode === 'builder', minimap: { enabled: false }, automaticLayout: true }}
              onChange={v => mode === 'code' && emit(v ?? '')}
            />
          </div>
        </Collapse>
      </Card>

      <Modal opened={revertOpen} onClose={() => setRevertOpen(false)} title="빌더로 되돌리기">
        <Stack>
          <Text size="sm">직접 고친 코드가 사라집니다</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setRevertOpen(false)}>취소</Button>
            <Button color="red" onClick={revert}>되돌리기</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
