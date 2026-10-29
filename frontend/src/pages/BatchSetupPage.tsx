import {
  ActionIcon, Alert, Button, Card, Group, Modal, NumberInput, SegmentedControl, Stack, Table, Text, TextInput, Title,
} from '@mantine/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApi } from '../api/client';
import type { BatchRequest, Sampling, SweepParam } from '../api/types';
import { ResourceGroupSection, batchResourcesForRequest, useResources } from '../components/ResourceGroupSection';
import {
  PlotVariablesSelect, RunSettingsSection, defaultRunSettings, useOutputNames, useRunSettings,
} from '../components/RunSettingsSection';
import { nowStamp, usePresetEditor } from '../components/usePresetEditor';
import { VariablePicker } from '../components/VariablePicker';
import { parseRecordParam } from '../lib/compat';
import {
  DEFAULT_N_SAMPLES, applyBatchPresetConfig, batchFormToPresetConfig, batchRequestToPresetConfig, type BatchForm,
} from '../lib/presets';
import {
  countCases, countResourceCombos, newSweepRow, parseList, previewCases, rowToSweep, type SweepRow,
} from '../lib/sweep';

const CONFIRM_THRESHOLD = 1000;
type Row = SweepRow;

export function BatchSetupPage() {
  const { fmuId = '' } = useParams();
  const api = useApi();
  const navigate = useNavigate();
  const fmu = useQuery({ queryKey: ['fmu', fmuId], queryFn: () => api.getFmu(fmuId) });
  const [settings, setSettings] = useRunSettings(fmu.data);
  // ?record=a,b (목적함수 설계기의 호환성 링크): 기본 설정이 준비되면 한 번 기록 변수에 합친다
  const [searchParams] = useSearchParams();
  const recordParam = searchParams.get('record');
  const recordMerged = useRef(false);
  useEffect(() => {
    if (recordMerged.current || !settings || !recordParam) return;
    recordMerged.current = true;
    const extra = parseRecordParam(recordParam).filter(v => !settings.recordVariables.includes(v));
    if (extra.length) setSettings({ ...settings, recordVariables: [...settings.recordVariables, ...extra] });
  }, [settings, recordParam, setSettings]);
  const [fixedError, setFixedError] = useState<string | null>(null);
  const [name, setName] = useState(() => `batch-${nowStamp()}`);
  const [rows, setRows] = useState<Row[]>([]);
  const [sampling, setSampling] = useState<Sampling>('grid');
  const [nSamples, setNSamples] = useState(DEFAULT_N_SAMPLES);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resourceSel, setResourceSel] = useState<Record<string, string[]>>({});
  const [plotVars, setPlotVars] = useState<string[]>([]);
  // RunSettingsSection은 고정 파라미터 글을 자체 상태로 가지므로 불러올 때 다시 마운트한다
  const [formKey, setFormKey] = useState(0);
  const resourceFiles = useResources(fmuId);
  const outputs = useOutputNames(fmuId);
  const allVars = useQuery({
    queryKey: ['variables', fmuId, 'all', 'all-names'],
    queryFn: () => api.listVariables(fmuId, { offset: 0, limit: 100000 }),
  });

  const form: BatchForm | null = settings
    ? { rows, sampling, nSamples, resourceSel, settings, plotVariables: plotVars }
    : null;
  const applyForm = (f: BatchForm) => {
    setRows(f.rows);
    setSampling(f.sampling);
    setNSamples(f.nSamples);
    setResourceSel(f.resourceSel);
    setSettings(f.settings);
    setPlotVars(f.plotVariables);
    setFixedError(null);
    setFormKey(k => k + 1);
  };
  const presetUi = usePresetEditor({
    kind: 'batch', fmuId, modelName: fmu.data?.modelName ?? '', form, name, setName, setForm: applyForm,
    ready: !!form && resourceFiles.isSuccess && allVars.isSuccess && outputs.isSuccess,
    toConfig: f => batchFormToPresetConfig(f, resourceFiles.data ?? [], outputs.data ?? []),
    fromConfig: cfg => applyBatchPresetConfig(cfg, { files: resourceFiles.data ?? [], variables: allVars.data?.items ?? [] }),
    jobToConfig: j => batchRequestToPresetConfig(j.config as BatchRequest, resourceFiles.data ?? [], outputs.data ?? []),
    defaultForm: (): BatchForm => ({
      rows: [], sampling: 'grid', nSamples: DEFAULT_N_SAMPLES, resourceSel: {},
      settings: defaultRunSettings(fmu.data!, outputs.data ?? []), plotVariables: [],
    }),
  });

  const sweep = rows.map(rowToSweep);
  const invalidRow = rows.find((_, i) => !sweep[i]);
  const params = sweep.filter((p): p is SweepParam => !!p);

  const { count, countError, preview } = useMemo(() => {
    try {
      const ns = sampling === 'lhs' || sampling === 'random' ? nSamples : null;
      return { count: countCases(params, sampling, ns), countError: null, preview: previewCases(params, sampling, ns) };
    } catch (e) {
      return { count: 0, countError: (e as Error).message, preview: [] };
    }
  }, [JSON.stringify(params), sampling, nSamples]); // eslint-disable-line react-hooks/exhaustive-deps

  const combos = countResourceCombos(resourceSel);
  const total = count * combos;
  const submit = useMutation({
    mutationFn: () => api.createBatch({
      name, fmuId, params, sampling,
      nSamples: sampling === 'lhs' || sampling === 'random' ? nSamples : null,
      ...settings!,
      resources: batchResourcesForRequest(resourceFiles.data ?? [], resourceSel),
      plotVariables: plotVars.filter(v => settings!.recordVariables.includes(v)),
    }),
    onSuccess: job => navigate(`/jobs/${job.id}`),
  });

  const canSubmit = !!settings && rows.length > 0 && !invalidRow && !countError && !fixedError && count > 0 && !submit.isPending;
  const onSubmit = () => (total > CONFIRM_THRESHOLD ? setConfirmOpen(true) : submit.mutate());
  const update = (i: number, patch: Partial<Row>) => setRows(rs => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  const addParam = async (names: string[]) => {
    const n = names[0];
    if (!n || rows.some(r => r.name === n)) return;
    const page = await api.listVariables(fmuId, { q: n, causality: 'parameter', offset: 0, limit: 50 });
    const v = page.items.find(x => x.name === n);
    if (v) setRows(rs => (rs.some(r => r.name === n) ? rs : [...rs, newSweepRow(v)]));
  };

  if (!fmu.data) return null;

  return (
    <Stack>
      {presetUi.menuBar}
      <Title order={2}>배치 해석 설정</Title>
      <Text c="dimmed" size="sm">{fmu.data.modelName}</Text>
      {presetUi.notice}
      <Alert color="blue" variant="light">목적함수 값은 결과 조회 시 최신 코드로 계산됩니다</Alert>
      <TextInput label="잡 이름" value={name} onChange={e => setName(e.currentTarget.value)} />

      <Card withBorder>
        <Title order={4} mb="sm">스윕 파라미터</Title>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>이름</Table.Th><Table.Th>방식</Table.Th><Table.Th>값</Table.Th><Table.Th w={40} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r, i) => (
              <Table.Tr key={r.name}>
                <Table.Td><Text size="sm" ff="monospace">{r.name}</Text></Table.Td>
                <Table.Td>
                  <SegmentedControl size="xs" value={r.mode} data={[{ value: 'list', label: '목록' }, { value: 'range', label: '범위' }]}
                    onChange={m => update(i, { mode: m as Row['mode'] })} />
                </Table.Td>
                <Table.Td>
                  {r.mode === 'list' ? (
                    <TextInput aria-label={`${r.name} 값`} value={r.text} placeholder="쉼표로 구분 (예: 1, 2, 3)"
                      error={!parseList(r.text) && '숫자를 쉼표로 구분해 입력하세요'}
                      onChange={e => update(i, { text: e.currentTarget.value })} />
                  ) : (
                    <Group gap="xs" grow>
                      <NumberInput aria-label={`${r.name} 최솟값`} placeholder="최솟값" value={r.min} onChange={v => update(i, { min: Number(v) })} />
                      <NumberInput aria-label={`${r.name} 최댓값`} placeholder="최댓값" value={r.max} onChange={v => update(i, { max: Number(v) })} />
                      <NumberInput aria-label={`${r.name} 단계 수`} placeholder="단계 수" min={1} value={r.steps} onChange={v => update(i, { steps: Math.max(1, Number(v) || 1) })} />
                    </Group>
                  )}
                </Table.Td>
                <Table.Td>
                  <ActionIcon variant="subtle" color="red" aria-label={`${r.name} 삭제`}
                    onClick={() => setRows(rs => rs.filter((_, k) => k !== i))}>✕</ActionIcon>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {rows.length === 0 && <Text c="dimmed" size="sm" my="xs">아래 목록에서 스윕할 파라미터를 선택하세요</Text>}
        <Text size="sm" fw={500} mt="md" mb="xs">파라미터 추가</Text>
        <VariablePicker fmuId={fmuId} causality="parameter" mode="single" value={rows.map(r => r.name)} onChange={addParam} pageSize={50} />
      </Card>

      <Card withBorder>
        <Title order={4} mb="sm">Resource 파일</Title>
        <ResourceGroupSection fmuId={fmuId} value={resourceSel} onChange={setResourceSel} />
      </Card>

      <Card withBorder>
        <Title order={4} mb="sm">샘플링</Title>
        <Group align="end">
          <SegmentedControl value={sampling} onChange={v => setSampling(v as Sampling)}
            data={['grid', 'zip', 'lhs', 'random']} />
          {(sampling === 'lhs' || sampling === 'random') && (
            <NumberInput label="샘플 수" min={1} value={nSamples} onChange={v => setNSamples(Math.max(1, Number(v) || 1))} w={140} />
          )}
        </Group>
        {countError ? <Alert color="red" mt="sm">{countError}</Alert> : <Text fw={600} mt="sm">총 {count} 케이스</Text>}
        {!countError && combos > 1 && (
          <Text fw={600}>총 {total}개 run (파라미터 {count} × Resource 조합 {combos})</Text>
        )}
        {preview.length > 0 && (
          <Table mt="xs" fz="xs">
            <Table.Thead>
              <Table.Tr><Table.Th>#</Table.Th>{params.map(p => <Table.Th key={p.name}>{p.name}</Table.Th>)}</Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {preview.map((c, i) => (
                <Table.Tr key={i}><Table.Td>{i}</Table.Td>{params.map(p => <Table.Td key={p.name}>{c[p.name]}</Table.Td>)}</Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>

      {settings && (
        <Card withBorder>
          <Title order={4} mb="sm">실행 설정</Title>
          <RunSettingsSection key={formKey} fmuId={fmuId} value={settings} onChange={setSettings} onFixedError={setFixedError} />
          <PlotVariablesSelect recordVariables={settings.recordVariables} value={plotVars} onChange={setPlotVars} />
        </Card>
      )}

      {submit.isError && <Alert color="red">{(submit.error as Error).message}</Alert>}
      <Group justify="end">
        <Button onClick={onSubmit} disabled={!canSubmit} loading={submit.isPending}>배치 실행</Button>
      </Group>

      <Modal opened={confirmOpen} onClose={() => setConfirmOpen(false)} title="확인" transitionProps={{ duration: 0 }}>
        <Text>케이스가 많습니다 ({total}개). 계속하시겠습니까?</Text>
        <Group justify="end" mt="md">
          <Button variant="default" onClick={() => setConfirmOpen(false)}>취소</Button>
          <Button onClick={() => { setConfirmOpen(false); submit.mutate(); }}>계속</Button>
        </Group>
      </Modal>
      {presetUi.modals}
    </Stack>
  );
}
