import { Chip, Group, Stack, Table, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api/client';
import type { ResourceCandidate, ResourceFile } from '../api/types';

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
