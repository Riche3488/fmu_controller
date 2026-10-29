import { Alert, Badge, Button, Group, Modal, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useApi } from '../../api/client';
import type { Objective } from '../../api/types';
import { CodeHashBadge } from '../../components/CodeHashBadge';
import { ObjectiveDesigner } from '../../components/objective/ObjectiveDesigner';
import { useObjectiveCompat, type ObjectiveCompat } from '../../components/useObjectiveCompat';
import { generateCode, parseBuilderCode } from '../../lib/builder/codegen';
import { DEFAULT_SPEC } from '../../lib/builder/spec';
import { SAVE_NOTE } from '../ObjectiveEditorPage';

const isBuilderCode = (code: string) => !!parseBuilderCode(code)?.intact;

function CompatBadge({ c }: { c: ObjectiveCompat | undefined }) {
  if (!c) return <Text size="xs" c="dimmed">확인 중…</Text>;
  const label = c.kind === 'jobs' ? `${c.okJobs}/${c.totalJobs} 잡` : c.ok ? '기록 가능' : '비호환';
  return (
    <Group gap={4}>
      <Badge variant="light" color={c.ok ? 'teal' : 'red'} tt="none">{label}</Badge>
      {c.estimated && <Badge size="xs" variant="outline" color="gray">추정</Badge>}
    </Group>
  );
}

function ObjectiveList({ fmuId }: { fmuId: string }) {
  const api = useApi();
  const navigate = useNavigate();
  const list = useQuery({ queryKey: ['objectives'], queryFn: () => api.listObjectives() });
  const compat = useObjectiveCompat(fmuId, list.data);
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>③ 목적함수</Title>
        <Button onClick={() => navigate(`/fmus/${fmuId}/objectives/new`)}>새로 설계</Button>
      </Group>
      <Text size="sm" c="dimmed">
        목적함수는 run 결과에서 값 하나를 계산합니다. 호환 배지는 이 FMU의 잡이 필요한 컬럼을 기록했는지 보여 줍니다.
      </Text>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>이름</Table.Th><Table.Th>해시</Table.Th><Table.Th>호환</Table.Th><Table.Th>종류</Table.Th><Table.Th>수정 시각</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(list.data ?? []).map(o => (
            <Table.Tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/fmus/${fmuId}/objectives/${o.id}`)}>
              <Table.Td>{o.name}</Table.Td>
              <Table.Td><CodeHashBadge hash={o.codeHash} /></Table.Td>
              <Table.Td><CompatBadge c={compat?.get(o.id)} /></Table.Td>
              <Table.Td>{isBuilderCode(o.code) ? '빌더' : '코드'}</Table.Td>
              <Table.Td><Text size="xs" c="dimmed">{new Date(o.updatedAt).toLocaleString()}</Text></Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {list.isSuccess && list.data.length === 0 && <Text size="sm" c="dimmed">목적함수가 없습니다. 새로 설계해 보세요.</Text>}
    </Stack>
  );
}

/** 새 목적함수(saved 없음) 또는 저장된 목적함수 편집. 부모가 key로 목적함수마다 새로 마운트한다. */
function ObjectiveForm({ fmuId, saved }: { fmuId: string; saved: Objective | null }) {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [initial, setInitial] = useState(() => ({ name: saved?.name ?? '', code: saved?.code ?? generateCode(DEFAULT_SPEC) }));
  const [draft, setDraft] = useState(initial);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const listPath = `/fmus/${fmuId}/objectives`;
  const dirty = draft.name !== initial.name || draft.code !== initial.code;

  const save = useMutation({
    mutationFn: () => (saved ? api.updateObjective(saved.id, draft) : api.createObjective({ name: draft.name.trim(), code: draft.code })),
    onSuccess: o => {
      setInitial({ name: o.name, code: o.code });
      qc.setQueryData(['objective', o.id], o);
      qc.invalidateQueries({ queryKey: ['objectives'] });
      qc.invalidateQueries({ queryKey: ['runs'] });
      if (!saved) navigate(`${listPath}/${o.id}`, { replace: true });
    },
  });
  const remove = useMutation({
    mutationFn: () => api.deleteObjective(saved!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['objectives'] });
      navigate(listPath);
    },
  });

  // Ctrl+S로 저장 (Monaco가 포커스를 가져가도 문서 수준에서 잡는다)
  const saveRef = useRef<() => void>(() => {});
  saveRef.current = () => { if (dirty && draft.name.trim() && !save.isPending) save.mutate(); };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveRef.current(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  return (
    <Stack>
      <Group justify="space-between">
        <Group>
          <Button variant="subtle" onClick={() => (dirty ? setConfirmLeave(true) : navigate(listPath))}>목록으로</Button>
          <TextInput aria-label="목적함수 이름" placeholder="이름 (지표 이름으로 쓰입니다)" value={draft.name}
            onChange={e => setDraft({ ...draft, name: e.currentTarget.value })} />
          {saved && <CodeHashBadge hash={saved.codeHash} />}
          {dirty && saved && <Text size="xs" c="orange">수정됨</Text>}
        </Group>
        <Group>
          {saved && <Button variant="subtle" color="red" loading={remove.isPending} onClick={() => remove.mutate()}>삭제</Button>}
          <Button onClick={() => save.mutate()} disabled={!dirty || !draft.name.trim()} loading={save.isPending}>저장</Button>
        </Group>
      </Group>
      <Text size="xs" c="dimmed">{SAVE_NOTE}</Text>
      {save.isError && <Alert color="red">{(save.error as Error).message}</Alert>}
      {remove.isError && <Alert color="red">{(remove.error as Error).message}</Alert>}
      <ObjectiveDesigner fmuId={fmuId} value={draft} onChange={setDraft} />
      <Modal opened={confirmLeave} onClose={() => setConfirmLeave(false)} title="확인" transitionProps={{ duration: 0 }}>
        <Text>저장하지 않은 변경 사항이 있습니다</Text>
        <Group justify="end" mt="md">
          <Button variant="default" onClick={() => setConfirmLeave(false)}>취소</Button>
          <Button color="red" onClick={() => navigate(listPath)}>버리고 이동</Button>
        </Group>
      </Modal>
    </Stack>
  );
}

function ObjectiveLoader({ fmuId, objectiveId }: { fmuId: string; objectiveId: string }) {
  const api = useApi();
  const q = useQuery({ queryKey: ['objective', objectiveId], queryFn: () => api.getObjective(objectiveId) });
  if (q.isError) return <Alert color="red">{(q.error as Error).message}</Alert>;
  if (!q.data) return <Text c="dimmed">불러오는 중…</Text>;
  // 저장으로 해시가 바뀌어도 편집 중인 초안을 유지하려고 id로만 key를 건다
  return <ObjectiveForm key={q.data.id} fmuId={fmuId} saved={q.data} />;
}

export function ObjectivesStep() {
  const { fmuId = '', objectiveId } = useParams();
  const { pathname } = useLocation();
  if (objectiveId) return <ObjectiveLoader fmuId={fmuId} objectiveId={objectiveId} />;
  if (pathname.endsWith('/objectives/new')) return <ObjectiveForm key="new" fmuId={fmuId} saved={null} />;
  return <ObjectiveList fmuId={fmuId} />;
}
