import {
  ActionIcon, Alert, Button, Card, Group, NumberInput, SegmentedControl, Stack, Table, Text, TextInput, Title,
} from '@mantine/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApi } from '../api/client';
import type { Algorithm, DesignVar, Direction, OptimizationRequest, OptResource } from '../api/types';
import { ObjectivePicker } from '../components/ObjectivePicker';
import {
  OptResourceSection, hasSearch, optResourcesForRequest, searchInvalid, useResources,
} from '../components/ResourceGroupSection';
import {
  PlotVariablesSelect, RunSettingsSection, defaultRunSettings, useOutputNames, useRunSettings,
} from '../components/RunSettingsSection';
import { nowStamp, usePresetEditor } from '../components/usePresetEditor';
import { VariablePicker } from '../components/VariablePicker';
import { applyPresetConfig, formToPresetConfig, requestToPresetConfig, type OptForm } from '../lib/presets';
import { defaultBounds } from '../lib/sweep';

const CMAES_SEARCH_NOTE = 'CMA-ES는 파일 탐색(선택형 변수)을 지원하지 않습니다';
const DEFAULT_N_TRIALS = 50;

function algorithms(multi: boolean, gpAvailable: boolean, search: boolean) {
  const gp = { value: 'gp', label: gpAvailable ? 'GP' : 'GP (torch 설치 필요)', disabled: !gpAvailable };
  if (multi) return [{ value: 'nsga2', label: 'NSGA-II' }, { value: 'tpe', label: 'TPE' }, gp, { value: 'random', label: 'Random' }];
  return [{ value: 'tpe', label: 'TPE' }, gp, { value: 'cmaes', label: 'CMA-ES', disabled: search }, { value: 'random', label: 'Random' }];
}
const BOUNDS_ERROR = '최솟값은 최댓값보다 작아야 합니다';

export function OptimizationSetupPage() {
  const { fmuId = '' } = useParams();
  const api = useApi();
  const navigate = useNavigate();
  const fmu = useQuery({ queryKey: ['fmu', fmuId], queryFn: () => api.getFmu(fmuId) });
  const [settings, setSettings] = useRunSettings(fmu.data);
  const [fixedError, setFixedError] = useState<string | null>(null);
  const [name, setName] = useState(() => `opt-${nowStamp()}`);
  const [vars, setVars] = useState<DesignVar[]>([]);
  const [objectiveIds, setObjectiveIds] = useState<string[]>([]);
  const [directions, setDirections] = useState<Record<string, Direction>>({});
  const [algorithm, setAlgorithm] = useState<Algorithm>('tpe');
  const [algoNote, setAlgoNote] = useState<string | null>(null);
  const [nTrials, setNTrials] = useState(DEFAULT_N_TRIALS);
  const [resourceSel, setResourceSel] = useState<Record<string, OptResource>>({});
  const [plotVars, setPlotVars] = useState<string[]>([]);
  const resourceFiles = useResources(fmuId);
  const outputs = useOutputNames(fmuId);
  const allVars = useQuery({
    queryKey: ['variables', fmuId, 'all', 'all-names'],
    queryFn: () => api.listVariables(fmuId, { offset: 0, limit: 100000 }),
  });
  const objectivesList = useQuery({ queryKey: ['objectives'], queryFn: () => api.listObjectives() });
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.health() });
  const search = hasSearch(resourceSel);
  // RunSettingsSection은 고정 파라미터 글을 자체 상태로 가지므로 불러올 때 다시 마운트한다
  const [formKey, setFormKey] = useState(0);

  const multi = objectiveIds.length > 1;
  const prevMulti = useRef(multi);
  useEffect(() => {
    // 사용자가 단일↔다목적을 바꾸면 기본 알고리즘으로 (다목적: NSGA-II, 단일: TPE). 불러온 설정은 건드리지 않는다.
    if (prevMulti.current === multi) return;
    prevMulti.current = multi;
    if (multi) {
      setAlgoNote(algorithm === 'cmaes' ? 'CMA-ES는 단일 목적만 지원합니다' : null);
      setAlgorithm('nsga2');
    } else if (algorithm === 'nsga2') {
      setAlgorithm('tpe');
    }
  }, [multi]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // 파일 탐색(선택형 변수)이 생기면 CMA-ES는 쓸 수 없다
    if (search && algorithm === 'cmaes') {
      setAlgorithm('tpe');
      setAlgoNote(CMAES_SEARCH_NOTE);
    }
  }, [search, algorithm]);

  const form: OptForm | null = settings
    ? { vars, objectiveIds, directions, algorithm, nTrials, resourceSel, settings, plotVariables: plotVars }
    : null;
  const loadReady = !!form && resourceFiles.isSuccess && allVars.isSuccess && objectivesList.isSuccess
    && outputs.isSuccess && health.isFetched;

  const applyForm = (f: OptForm) => {
    prevMulti.current = f.objectiveIds.length > 1;
    setVars(f.vars);
    setObjectiveIds(f.objectiveIds);
    setDirections(f.directions);
    setAlgorithm(f.algorithm);
    setAlgoNote(null);
    setNTrials(f.nTrials);
    setResourceSel(f.resourceSel);
    setSettings(f.settings);
    setPlotVars(f.plotVariables);
    setFixedError(null);
    setFormKey(k => k + 1);
  };

  const presetUi = usePresetEditor({
    kind: 'optimization', fmuId, modelName: fmu.data?.modelName ?? '', form, ready: loadReady, name, setName,
    setForm: applyForm,
    toConfig: f => formToPresetConfig(f, resourceFiles.data ?? [], outputs.data ?? []),
    fromConfig: cfg => applyPresetConfig(cfg, {
      files: resourceFiles.data ?? [], variables: allVars.data?.items ?? [],
      objectiveIds: (objectivesList.data ?? []).map(o => o.id), gpAvailable: !!health.data?.gpAvailable,
    }),
    jobToConfig: j => requestToPresetConfig(j.config as OptimizationRequest, resourceFiles.data ?? [], outputs.data ?? []),
    defaultForm: (): OptForm => ({
      vars: [], objectiveIds: [], directions: {}, algorithm: 'tpe', nTrials: DEFAULT_N_TRIALS, resourceSel: {},
      settings: defaultRunSettings(fmu.data!, outputs.data ?? []), plotVariables: [],
    }),
  });

  const badBounds = vars.some(v => !(v.min < v.max));
  const submit = useMutation({
    mutationFn: () => api.createOptimization({
      name, fmuId, designVars: vars, algorithm, nTrials,
      objectives: objectiveIds.map(id => ({ objectiveId: id, direction: directions[id] ?? 'minimize' })),
      ...settings!,
      resources: optResourcesForRequest(resourceFiles.data ?? [], resourceSel),
      plotVariables: plotVars.filter(v => settings!.recordVariables.includes(v)),
    }),
    onSuccess: job => navigate(`/jobs/${job.id}`),
  });
  const canSubmit = !!settings && vars.length > 0 && objectiveIds.length > 0 && !badBounds && !fixedError
    && !searchInvalid(resourceSel) && !submit.isPending;
  const update = (i: number, patch: Partial<DesignVar>) => setVars(vs => vs.map((v, k) => (k === i ? { ...v, ...patch } : v)));

  const addVar = async (names: string[]) => {
    const n = names[0];
    if (!n || vars.some(v => v.name === n)) return;
    const page = await api.listVariables(fmuId, { q: n, causality: 'parameter', offset: 0, limit: 50 });
    const v = page.items.find(x => x.name === n);
    if (!v) return;
    const kind = v.type === 'Integer' ? 'int' : 'float';
    setVars(vs => (vs.some(x => x.name === n) ? vs : [...vs, { name: n, ...defaultBounds(v.start), kind }]));
  };

  if (!fmu.data) return null;

  return (
    <Stack>
      {presetUi.menuBar}
      <Title order={2}>최적화 설정</Title>
      <Text c="dimmed" size="sm">{fmu.data.modelName}</Text>

      {presetUi.notice}

      <TextInput label="잡 이름" value={name} onChange={e => setName(e.currentTarget.value)} />

      <Card withBorder>
        <Title order={4} mb="sm">목적함수</Title>
        <Text size="xs" c="dimmed" mb="xs">하나를 고르면 단일 목적, 여러 개를 고르면 다목적 최적화입니다. 실행 시점의 코드로 최적화하며, 결과 화면의 값은 항상 현재 코드로 다시 계산됩니다.</Text>
        <ObjectivePicker value={objectiveIds} onChange={setObjectiveIds} withDirection directions={directions} onDirectionsChange={setDirections} />
      </Card>

      <Card withBorder>
        <Title order={4} mb="sm">알고리즘</Title>
        <Group align="end">
          <SegmentedControl value={algorithm} data={algorithms(multi, !!health.data?.gpAvailable, search)}
            onChange={v => { setAlgorithm(v as Algorithm); setAlgoNote(null); }} />
          <NumberInput label="trial 수" min={1} value={nTrials} onChange={v => setNTrials(Math.max(1, Number(v) || 1))} w={140} />
        </Group>
        {algoNote && <Text size="sm" c="orange" mt="xs">{algoNote}</Text>}
        {search && !algoNote && !multi && <Text size="xs" c="dimmed" mt="xs">{CMAES_SEARCH_NOTE}</Text>}
      </Card>

      <Card withBorder>
        <Title order={4} mb="sm">설계 변수</Title>
        <Table>
          <Table.Thead>
            <Table.Tr><Table.Th>이름</Table.Th><Table.Th>최솟값</Table.Th><Table.Th>최댓값</Table.Th><Table.Th>타입</Table.Th><Table.Th w={40} /></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {vars.map((v, i) => {
              const err = !(v.min < v.max) ? BOUNDS_ERROR : null;
              return (
                <Table.Tr key={v.name}>
                  <Table.Td><Text size="sm" ff="monospace">{v.name}</Text></Table.Td>
                  <Table.Td><NumberInput aria-label={`${v.name} 최솟값`} value={v.min} error={err} onChange={x => update(i, { min: Number(x) })} /></Table.Td>
                  <Table.Td><NumberInput aria-label={`${v.name} 최댓값`} value={v.max} onChange={x => update(i, { max: Number(x) })} /></Table.Td>
                  <Table.Td>
                    <SegmentedControl size="xs" value={v.kind} data={[{ value: 'float', label: '실수' }, { value: 'int', label: '정수' }]}
                      onChange={k => update(i, { kind: k as DesignVar['kind'] })} />
                  </Table.Td>
                  <Table.Td>
                    <ActionIcon variant="subtle" color="red" aria-label={`${v.name} 삭제`} onClick={() => setVars(vs => vs.filter((_, k) => k !== i))}>✕</ActionIcon>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
        <Text size="sm" fw={500} mt="md" mb="xs">설계 변수 추가</Text>
        <VariablePicker fmuId={fmuId} causality="parameter" mode="single" value={vars.map(v => v.name)} onChange={addVar} pageSize={50} />
      </Card>

      <Card withBorder>
        <Title order={4} mb="sm">Resource 파일</Title>
        <OptResourceSection fmuId={fmuId} value={resourceSel} onChange={setResourceSel} />
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
        <Button onClick={() => submit.mutate()} disabled={!canSubmit} loading={submit.isPending}>최적화 실행</Button>
      </Group>

      {presetUi.modals}
    </Stack>
  );
}
