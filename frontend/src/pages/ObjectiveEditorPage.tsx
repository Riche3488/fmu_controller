import {
  Alert, Button, Card, Code, Grid, Group, Modal, NavLink, ScrollArea, Select, Stack, Text, TextInput, Title,
} from '@mantine/core';
import Editor from '@monaco-editor/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApi } from '../api/client';
import type { ObjectiveTestResult } from '../api/types';
import TEMPLATE from '../api/mock/fixtures/objective_template.py.txt?raw';
import { SAVE_NOTE } from '../lib/objectiveText';
import { useSaveShortcut } from '../components/useSaveShortcut';
import { CodeHashBadge } from '../components/CodeHashBadge';
import { ObjectiveDesigner } from '../components/objective/ObjectiveDesigner';
import { generateCode, parseBuilderCode } from '../lib/builder/codegen';
import { DEFAULT_SPEC } from '../lib/builder/spec';


function CreateModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const create = useMutation({
    // 기본은 빌더 코드, '빈 코드로 시작'은 예전 템플릿
    mutationFn: (code: string) => api.createObjective({ name: name.trim(), code }),
    onSuccess: o => {
      qc.invalidateQueries({ queryKey: ['objectives'] });
      setName('');
      onClose();
      navigate(`/objectives/${o.id}`);
    },
  });
  return (
    <Modal opened={opened} onClose={onClose} title="새 목적함수" transitionProps={{ duration: 0 }}>
      <Stack>
        <TextInput label="이름" description="이 이름이 지표 이름으로 쓰입니다" value={name} onChange={e => setName(e.currentTarget.value)} />
        {create.isError && <Alert color="red">{(create.error as Error).message}</Alert>}
        <Group justify="end">
          <Button variant="default" disabled={!name.trim()} onClick={() => create.mutate(TEMPLATE)}>빈 코드로 시작</Button>
          <Button disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutate(generateCode(DEFAULT_SPEC))}>만들기</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function TestPanel({ code }: { code: string }) {
  const api = useApi();
  const [runId, setRunId] = useState<string | null>(null);
  const [result, setResult] = useState<ObjectiveTestResult | null>(null);
  const runs = useQuery({ queryKey: ['runs', 'recent-ok'], queryFn: () => api.listRuns({ status: 'ok', sortBy: 'index', limit: 200 }) });
  const jobs = useQuery({ queryKey: ['jobs'], queryFn: () => api.listJobs() });
  const jobName = (id: string) => jobs.data?.find(j => j.id === id)?.name ?? id;
  const selected = runs.data?.items.find(r => r.id === runId);
  const job = useQuery({ queryKey: ['job', selected?.jobId], queryFn: () => api.getJob(selected!.jobId), enabled: !!selected });
  const test = useMutation({
    mutationFn: () => api.testObjective({ code, runId: runId! }),
    onSuccess: setResult,
  });

  return (
    <Stack gap="sm">
      <Title order={5}>테스트 실행</Title>
      <Select label="테스트할 run" placeholder="run 선택" searchable value={runId} onChange={setRunId}
        data={(runs.data?.items ?? []).map(r => ({ value: r.id, label: `${jobName(r.jobId)} #${r.index}` }))}
        nothingFoundMessage="성공한 run이 없습니다" comboboxProps={{ transitionProps: { duration: 0 } }} />
      <Button onClick={() => test.mutate()} disabled={!runId} loading={test.isPending}>테스트 실행</Button>
      {test.isError && <Alert color="red">{(test.error as Error).message}</Alert>}
      {result && (result.error ? (
        <Alert color="red" title="오류"><Text size="xs" ff="monospace" style={{ whiteSpace: 'pre-wrap' }}>{result.error}</Text></Alert>
      ) : (
        <Card withBorder>
          <Text size="xs" c="dimmed">값 ({result.durationMs} ms)</Text>
          <Text fw={700} size="lg" data-testid="test-value">{result.value === null ? 'null' : result.value}</Text>
        </Card>
      ))}
      {result?.stdout && (
        <div>
          <Text size="xs" c="dimmed">stdout</Text>
          <Code block>{result.stdout}</Code>
        </div>
      )}
      {job.data && (
        <div>
          <Text size="xs" c="dimmed">이 run에 기록된 컬럼 (result DataFrame)</Text>
          <ScrollArea.Autosize mah={240}>
            <Text size="xs" ff="monospace">time</Text>
            {job.data.config.recordVariables.map(v => <Text key={v} size="xs" ff="monospace">{v}</Text>)}
          </ScrollArea.Autosize>
        </div>
      )}
    </Stack>
  );
}

export function ObjectiveEditorPage() {
  const { objectiveId } = useParams();
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingNav, setPendingNav] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; code: string } | null>(null);
  const [pickedFmu, setPickedFmu] = useState<string | null>(null);
  const fmus = useQuery({ queryKey: ['fmus'], queryFn: () => api.listFmus() });
  const designerFmu = pickedFmu ?? fmus.data?.[0]?.id ?? null;

  const list = useQuery({ queryKey: ['objectives'], queryFn: () => api.listObjectives() });
  const current = useQuery({
    queryKey: ['objective', objectiveId], queryFn: () => api.getObjective(objectiveId!), enabled: !!objectiveId,
  });
  useEffect(() => {
    if (current.data) setDraft({ name: current.data.name, code: current.data.code });
  }, [current.data]);

  // 저장된 코드가 빌더 코드인지로 정한다 (편집 중 코드 모드로 바꿔도 화면이 바뀌지 않게)
  const builderMode = !!current.data && !!parseBuilderCode(current.data.code)?.intact;

  const dirty = !!current.data && !!draft && (draft.code !== current.data.code || draft.name !== current.data.name);

  const save = useMutation({
    mutationFn: () => api.updateObjective(objectiveId!, draft!),
    onSuccess: o => {
      qc.setQueryData(['objective', o.id], o);
      qc.invalidateQueries({ queryKey: ['objectives'] });
      qc.invalidateQueries({ queryKey: ['runs'] });
    },
  });
  const remove = useMutation({
    mutationFn: () => api.deleteObjective(objectiveId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['objectives'] });
      navigate('/objectives');
    },
  });

  const saveNow = useSaveShortcut(() => save.mutate(), dirty && !save.isPending);

  const go = (id: string) => (dirty ? setPendingNav(id) : navigate(`/objectives/${id}`));

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>목적함수</Title>
        <Button onClick={() => setCreateOpen(true)}>새 목적함수</Button>
      </Group>
      <Text size="sm" c="dimmed">파일 하나는 값 하나를 계산합니다. 다목적 최적화는 목적함수 여러 개를 선택해서 수행합니다.</Text>
      <Grid>
        <Grid.Col span={{ base: 12, md: 2 }}>
          {(list.data ?? []).map(o => (
            <NavLink key={o.id} component="button" label={o.name} active={o.id === objectiveId} onClick={() => go(o.id)} />
          ))}
          {list.isSuccess && list.data.length === 0 && <Text size="sm" c="dimmed">목적함수가 없습니다</Text>}
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 7 }}>
          {current.data && draft ? (
            <Stack gap="xs">
              <Group justify="space-between">
                <Group>
                  <TextInput aria-label="목적함수 이름" value={draft.name} onChange={e => setDraft({ ...draft, name: e.currentTarget.value })} />
                  <CodeHashBadge hash={current.data.codeHash} />
                  {dirty && <Text size="xs" c="orange">수정됨</Text>}
                </Group>
                <Group>
                  <Button variant="subtle" color="red" onClick={() => remove.mutate()}>삭제</Button>
                  <Button onClick={() => save.mutate()} disabled={!dirty} loading={save.isPending}>저장</Button>
                </Group>
              </Group>
              <Text size="xs" c="dimmed">{SAVE_NOTE}</Text>
              {save.isError && <Alert color="red">{(save.error as Error).message}</Alert>}
              {builderMode ? (
                <Stack gap="xs">
                  <Select label="미리보기·호환성 기준 FMU" value={designerFmu} onChange={setPickedFmu} allowDeselect={false}
                    data={(fmus.data ?? []).map(f => ({ value: f.id, label: f.modelName || f.fileName }))}
                    comboboxProps={{ transitionProps: { duration: 0 } }} />
                  {designerFmu
                    ? <ObjectiveDesigner key={`${current.data.id}:${designerFmu}`} fmuId={designerFmu} value={draft} onChange={setDraft} />
                    : <Text c="dimmed" size="sm">등록된 FMU가 없습니다</Text>}
                </Stack>
              ) : (
                <Card withBorder p={0}>
                  <Editor height="60vh" language="python" value={draft.code}
                    onChange={v => setDraft(d => (d ? { ...d, code: v ?? '' } : d))}
                    onMount={(editor, monaco) => {
                      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, saveNow);
                    }}
                    options={{ minimap: { enabled: false }, fontSize: 13, tabSize: 4 }} />
                </Card>
              )}
            </Stack>
          ) : (
            <Text c="dimmed">왼쪽에서 목적함수를 선택하거나 새로 만드세요</Text>
          )}
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 3 }}>
          {draft && current.data && !builderMode && <TestPanel code={draft.code} />}
        </Grid.Col>
      </Grid>

      <CreateModal opened={createOpen} onClose={() => setCreateOpen(false)} />
      <Modal opened={!!pendingNav} onClose={() => setPendingNav(null)} title="확인" transitionProps={{ duration: 0 }}>
        <Text>저장하지 않은 변경 사항이 있습니다</Text>
        <Group justify="end" mt="md">
          <Button variant="default" onClick={() => setPendingNav(null)}>취소</Button>
          <Button color="red" onClick={() => { navigate(`/objectives/${pendingNav}`); setPendingNav(null); }}>버리고 이동</Button>
        </Group>
      </Modal>
    </Stack>
  );
}
