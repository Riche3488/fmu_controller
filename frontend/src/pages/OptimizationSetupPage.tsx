import {
  ActionIcon, Alert, Button, Card, Group, NumberInput, SegmentedControl, Stack, Table, Text, TextInput, Title,
} from '@mantine/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApi } from '../api/client';
import type { Algorithm, DesignVar, Direction } from '../api/types';
import { ObjectivePicker } from '../components/ObjectivePicker';
import { RunSettingsSection, useRunSettings } from '../components/RunSettingsSection';
import { VariablePicker } from '../components/VariablePicker';
import { defaultBounds } from '../lib/sweep';

const SINGLE_ALGOS = [{ value: 'tpe', label: 'TPE' }, { value: 'cmaes', label: 'CMA-ES' }, { value: 'random', label: 'Random' }];
const MULTI_ALGOS = [{ value: 'nsga2', label: 'NSGA-II' }, { value: 'tpe', label: 'TPE' }, { value: 'random', label: 'Random' }];
const BOUNDS_ERROR = '최솟값은 최댓값보다 작아야 합니다';

export function OptimizationSetupPage() {
  const { fmuId = '' } = useParams();
  const api = useApi();
  const navigate = useNavigate();
  const fmu = useQuery({ queryKey: ['fmu', fmuId], queryFn: () => api.getFmu(fmuId) });
  const [settings, setSettings] = useRunSettings(fmu.data);
  const [fixedError, setFixedError] = useState<string | null>(null);
  const [name, setName] = useState(() => `opt-${new Date().toISOString().slice(0, 16).replace('T', ' ')}`);
  const [vars, setVars] = useState<DesignVar[]>([]);
  const [objectiveIds, setObjectiveIds] = useState<string[]>([]);
  const [directions, setDirections] = useState<Record<string, Direction>>({});
  const [algorithm, setAlgorithm] = useState<Algorithm>('tpe');
  const [algoNote, setAlgoNote] = useState<string | null>(null);
  const [nTrials, setNTrials] = useState(50);

  const multi = objectiveIds.length > 1;
  useEffect(() => {
    // 단일↔다목적 전환 시 기본 알고리즘으로 바꾼다 (다목적: NSGA-II, 단일: TPE)
    if (multi) {
      setAlgoNote(algorithm === 'cmaes' ? 'CMA-ES는 단일 목적만 지원합니다' : null);
      setAlgorithm('nsga2');
    } else if (algorithm === 'nsga2') {
      setAlgorithm('tpe');
    }
  }, [multi]); // eslint-disable-line react-hooks/exhaustive-deps

  const badBounds = vars.some(v => !(v.min < v.max));
  const submit = useMutation({
    mutationFn: () => api.createOptimization({
      name, fmuId, designVars: vars, algorithm, nTrials,
      objectives: objectiveIds.map(id => ({ objectiveId: id, direction: directions[id] ?? 'minimize' })),
      ...settings!,
    }),
    onSuccess: job => navigate(`/jobs/${job.id}`),
  });
  const canSubmit = !!settings && vars.length > 0 && objectiveIds.length > 0 && !badBounds && !fixedError && !submit.isPending;
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
      <Title order={2}>최적화 설정</Title>
      <Text c="dimmed" size="sm">{fmu.data.modelName}</Text>
      <TextInput label="잡 이름" value={name} onChange={e => setName(e.currentTarget.value)} />

      <Card withBorder>
        <Title order={4} mb="sm">목적함수</Title>
        <Text size="xs" c="dimmed" mb="xs">하나를 고르면 단일 목적, 여러 개를 고르면 다목적 최적화입니다. 실행 시점의 코드로 최적화하며, 결과 화면의 값은 항상 현재 코드로 다시 계산됩니다.</Text>
        <ObjectivePicker value={objectiveIds} onChange={setObjectiveIds} withDirection directions={directions} onDirectionsChange={setDirections} />
      </Card>

      <Card withBorder>
        <Title order={4} mb="sm">알고리즘</Title>
        <Group align="end">
          <SegmentedControl value={algorithm} data={multi ? MULTI_ALGOS : SINGLE_ALGOS}
            onChange={v => { setAlgorithm(v as Algorithm); setAlgoNote(null); }} />
          <NumberInput label="trial 수" min={1} value={nTrials} onChange={v => setNTrials(Math.max(1, Number(v) || 1))} w={140} />
        </Group>
        {algoNote && <Text size="sm" c="orange" mt="xs">{algoNote}</Text>}
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

      {settings && (
        <Card withBorder>
          <Title order={4} mb="sm">실행 설정</Title>
          <RunSettingsSection fmuId={fmuId} value={settings} onChange={setSettings} onFixedError={setFixedError} />
        </Card>
      )}

      {submit.isError && <Alert color="red">{(submit.error as Error).message}</Alert>}
      <Group justify="end">
        <Button onClick={() => submit.mutate()} disabled={!canSubmit} loading={submit.isPending}>최적화 실행</Button>
      </Group>
    </Stack>
  );
}
