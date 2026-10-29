import { Alert, Button, Group, Menu, Modal, Stack, Table, Tabs, Text, Title } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApi } from '../api/client';
import type { Preset, PresetInput, PresetKind } from '../api/types';
import { PresetNameModal, usePresets } from '../components/PresetMenuBar';
import { presetSummary } from '../lib/presets';

const NO_TRANSITION = { transitionProps: { duration: 0 } };

// 대시보드는 FMU 설정 화면으로 열지 않는다
const SETUP_PATH: Record<Exclude<PresetKind, 'dashboard'>, string> = { optimization: 'optimize', batch: 'batch' };
const KINDS: PresetKind[] = ['optimization', 'batch', 'dashboard'];

/** 프리셋 내용 한 줄 설명 (목적함수 이름은 현재 목록에서 찾는다) */
function PresetDetail({ preset, objectiveName }: { preset: Preset; objectiveName: (id: string) => string }) {
  if (preset.kind === 'batch') {
    return <>파라미터: {preset.config.params.map(p => p.name).join(', ') || '-'}</>;
  }
  if (preset.kind === 'dashboard') return <>패널: {preset.config.panels.length}개</>;
  const c = preset.config;
  return (
    <>
      목적: {c.objectives.map(o => `${objectiveName(o.objectiveId)}(${o.direction === 'minimize' ? '최소' : '최대'})`).join(', ') || '-'}
      {' · '}변수: {c.designVars.map(v => v.name).join(', ') || '-'}
    </>
  );
}

export function PresetsPage() {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const kind: PresetKind = KINDS.find(k => k === searchParams.get('kind')) ?? 'optimization';
  const presets = usePresets(kind);
  const fmus = useQuery({ queryKey: ['fmus'], queryFn: () => api.listFmus() });
  const objectives = useQuery({ queryKey: ['objectives'], queryFn: () => api.listObjectives() });
  const [renaming, setRenaming] = useState<Preset | null>(null);
  const [deleting, setDeleting] = useState<Preset | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['presets'] });
  const rename = async (name: string) => {
    const p = renaming!;
    await api.updatePreset(p.id, { name, kind: p.kind, sourceFmuId: p.sourceFmuId, config: p.config } as PresetInput);
    invalidate();
  };
  const remove = useMutation({
    mutationFn: (p: Preset) => api.deletePreset(p.id),
    onSuccess: () => { setDeleting(null); invalidate(); },
  });

  const fmuList = fmus.data ?? [];
  const objectiveName = (id: string) => objectives.data?.find(o => o.id === id)?.name ?? '(삭제됨)';
  const list = presets.data ?? [];

  return (
    <Stack>
      <Title order={2}>프리셋</Title>
      <Text size="sm" c="dimmed">
        배치 해석·최적화 설정 화면 위쪽 메뉴 바의 <b>프리셋 → 저장</b>으로 만들고, <b>불러오기</b>로 다시 씁니다.
        다른 FMU에서 열면 그 FMU에 없는 변수·resource 후보는 빠지고 무엇이 빠졌는지 알려 줍니다.
      </Text>
      <Tabs value={kind} onChange={v => v && setSearchParams({ kind: v }, { replace: true })}>
        <Tabs.List>
          <Tabs.Tab value="optimization">최적화</Tabs.Tab>
          <Tabs.Tab value="batch">배치 해석</Tabs.Tab>
          <Tabs.Tab value="dashboard">대시보드</Tabs.Tab>
        </Tabs.List>
      </Tabs>
      {presets.isError && <Alert color="red">{(presets.error as Error).message}</Alert>}
      {presets.isSuccess && list.length === 0 && <Text c="dimmed">저장된 프리셋이 없습니다</Text>}
      {list.length > 0 && (
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>이름</Table.Th><Table.Th>저장한 모델</Table.Th><Table.Th>내용</Table.Th><Table.Th>수정</Table.Th><Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {list.map(p => {
              const source = fmuList.find(f => f.id === p.sourceFmuId);
              const targets = [...(source ? [source] : []), ...fmuList.filter(f => f.id !== p.sourceFmuId)];
              return (
                <Table.Tr key={p.id} data-testid={`preset-row-${p.name}`}>
                  <Table.Td><Text size="sm" fw={500}>{p.name}</Text></Table.Td>
                  <Table.Td>
                    <Text size="sm">{p.sourceModelName || '-'}</Text>
                    {p.sourceFmuId && !source && <Text size="xs" c="dimmed">FMU가 삭제됨</Text>}
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{presetSummary(p)}</Text>
                    <Text size="xs" c="dimmed" lineClamp={2}><PresetDetail preset={p} objectiveName={objectiveName} /></Text>
                  </Table.Td>
                  <Table.Td><Text size="xs">{new Date(p.updatedAt).toLocaleString('ko-KR')}</Text></Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap" justify="end">
                      {p.kind !== 'dashboard' && <Menu position="bottom-end" shadow="md" {...NO_TRANSITION}>
                        <Menu.Target><Button size="compact-sm" disabled={targets.length === 0}>열기</Button></Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Label>어느 FMU로 {kind === 'batch' ? '해석' : '최적화'}할까요?</Menu.Label>
                          {targets.map(f => (
                            <Menu.Item key={f.id} onClick={() => navigate(`/fmus/${f.id}/${SETUP_PATH[p.kind as keyof typeof SETUP_PATH]}?preset=${p.id}`)}>
                              {f.fileName} — {f.modelName}{f.id === p.sourceFmuId ? ' (저장한 FMU)' : ''}
                            </Menu.Item>
                          ))}
                        </Menu.Dropdown>
                      </Menu>}
                      <Button size="compact-sm" variant="default" onClick={() => setRenaming(p)}>이름 바꾸기</Button>
                      <Button size="compact-sm" variant="subtle" color="red" onClick={() => setDeleting(p)}>삭제</Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      )}

      <PresetNameModal opened={!!renaming} title="프리셋 이름 바꾸기" confirmLabel="바꾸기" initialName={renaming?.name ?? ''}
        onClose={() => setRenaming(null)} onSubmit={rename} />
      <Modal opened={!!deleting} onClose={() => setDeleting(null)} title="프리셋 삭제" transitionProps={{ duration: 0 }}>
        <Text size="sm">프리셋 '{deleting?.name}'을(를) 삭제할까요? 이 프리셋으로 실행한 잡과 결과는 그대로 남습니다.</Text>
        {remove.isError && <Text size="sm" c="red" mt="xs">{(remove.error as Error).message}</Text>}
        <Group justify="end" mt="md">
          <Button variant="default" onClick={() => setDeleting(null)}>취소</Button>
          <Button color="red" loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting)}>삭제</Button>
        </Group>
      </Modal>
    </Stack>
  );
}
