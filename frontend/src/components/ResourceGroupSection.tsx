import { Chip, Group, SegmentedControl, Select, Stack, Table, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api/client';
import type { OptResource, ResourceCandidate, ResourceFile } from '../api/types';

export function candidateLabel(c: ResourceCandidate): string {
  return c.isOriginal ? `${c.name} (원본)` : c.name;
}

/** 원본만 고른 path는 빼고, 모두 원본이면 undefined (요청에서 생략) */
export function batchResourcesForRequest(
  files: ResourceFile[], sel: Record<string, string[]>,
): Record<string, string[]> | undefined {
  const out: Record<string, string[]> = {};
  for (const f of files) {
    const ids = sel[f.path];
    if (ids && !(ids.length === 1 && ids[0] === f.candidates[0].id)) out[f.path] = ids;
  }
  return Object.keys(out).length ? out : undefined;
}

export const SEARCH_MIN_ERROR = '탐색할 후보를 2개 이상 고르세요';

/** 최적화용: 원본 고정은 빼고, 모두 원본 고정이면 undefined */
export function optResourcesForRequest(
  files: ResourceFile[], sel: Record<string, OptResource>,
): Record<string, OptResource> | undefined {
  const out: Record<string, OptResource> = {};
  for (const f of files) {
    const r = sel[f.path];
    if (r && !(r.mode === 'fixed' && r.candidateId === f.candidates[0].id)) out[f.path] = r;
  }
  return Object.keys(out).length ? out : undefined;
}

export function hasSearch(sel: Record<string, OptResource>): boolean {
  return Object.values(sel).some(r => r.mode === 'search');
}

export function searchInvalid(sel: Record<string, OptResource>): boolean {
  return Object.values(sel).some(r => r.mode === 'search' && r.candidateIds.length < 2);
}

export function useResources(fmuId: string) {
  const api = useApi();
  return useQuery({ queryKey: ['resources', fmuId], queryFn: () => api.listResources(fmuId) });
}

/** 배치용 Resource 그룹: 파일마다 후보를 여러 개 체크 (기본 원본, 최소 1개) */
export function ResourceGroupSection({ fmuId, value, onChange }: {
  fmuId: string;
  value: Record<string, string[]>;
  onChange: (v: Record<string, string[]>) => void;
}) {
  const resources = useResources(fmuId);
  const files = resources.data ?? [];
  if (resources.isSuccess && files.length === 0) return <Text c="dimmed" size="sm">이 FMU에는 resource 파일이 없습니다</Text>;
  return (
    <Stack gap="xs">
      <Text size="xs" c="dimmed">파일마다 해석에 쓸 후보를 고르세요. 여러 개를 고르면 모든 조합을 실행합니다. 후보는 FMU 상세의 Resources 탭에서 올립니다.</Text>
      <Table fz="sm">
        <Table.Tbody>
          {files.map(f => {
            const selected = value[f.path] ?? [f.candidates[0].id];
            return (
              <Table.Tr key={f.path} data-testid={`resource-group-${f.path}`}>
                <Table.Td w="30%"><Text size="sm" ff="monospace">{f.path}</Text></Table.Td>
                <Table.Td>
                  <Chip.Group multiple value={selected}
                    onChange={ids => { if (ids.length) onChange({ ...value, [f.path]: f.candidates.map(c => c.id).filter(id => ids.includes(id)) }); }}>
                    <Group gap={6}>
                      {f.candidates.map(c => <Chip key={c.id} value={c.id} size="xs">{candidateLabel(c)}</Chip>)}
                    </Group>
                  </Chip.Group>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

/** 최적화용 Resource 그룹: 파일마다 고정(후보 1개) 또는 탐색(후보 여러 개 중 최적화가 선택) */
export function OptResourceSection({ fmuId, value, onChange }: {
  fmuId: string;
  value: Record<string, OptResource>;
  onChange: (v: Record<string, OptResource>) => void;
}) {
  const resources = useResources(fmuId);
  const files = resources.data ?? [];
  if (resources.isSuccess && files.length === 0) return <Text c="dimmed" size="sm">이 FMU에는 resource 파일이 없습니다</Text>;
  return (
    <Stack gap="xs">
      <Text size="xs" c="dimmed">고정: 모든 trial에 같은 후보를 씁니다. 탐색: 고른 후보 중 무엇이 좋은지 최적화가 함께 찾습니다.</Text>
      <Table fz="sm">
        <Table.Tbody>
          {files.map(f => {
            const cur: OptResource = value[f.path] ?? { mode: 'fixed', candidateId: f.candidates[0].id };
            const set = (r: OptResource) => onChange({ ...value, [f.path]: r });
            const order = (ids: string[]) => f.candidates.map(c => c.id).filter(id => ids.includes(id));
            return (
              <Table.Tr key={f.path} data-testid={`opt-resource-${f.path}`}>
                <Table.Td w="30%"><Text size="sm" ff="monospace">{f.path}</Text></Table.Td>
                <Table.Td w={140}>
                  <SegmentedControl size="xs" value={cur.mode} data={[{ value: 'fixed', label: '고정' }, { value: 'search', label: '탐색' }]}
                    onChange={m => set(m === 'search'
                      ? { mode: 'search', candidateIds: cur.mode === 'fixed' ? [cur.candidateId] : cur.candidateIds }
                      : { mode: 'fixed', candidateId: cur.mode === 'search' ? cur.candidateIds[0] ?? f.candidates[0].id : cur.candidateId })} />
                </Table.Td>
                <Table.Td>
                  {cur.mode === 'fixed' ? (
                    <Select aria-label={`${f.path} 후보`} size="xs" allowDeselect={false} value={cur.candidateId}
                      data={f.candidates.map(c => ({ value: c.id, label: candidateLabel(c) }))}
                      comboboxProps={{ transitionProps: { duration: 0 } }}
                      onChange={id => id && set({ mode: 'fixed', candidateId: id })} />
                  ) : (
                    <>
                      <Chip.Group multiple value={cur.candidateIds} onChange={ids => set({ mode: 'search', candidateIds: order(ids) })}>
                        <Group gap={6}>
                          {f.candidates.map(c => <Chip key={c.id} value={c.id} size="xs">{candidateLabel(c)}</Chip>)}
                        </Group>
                      </Chip.Group>
                      {cur.candidateIds.length < 2 && <Text size="xs" c="red" mt={4}>{SEARCH_MIN_ERROR}</Text>}
                    </>
                  )}
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}
