import { Button, Checkbox, Group, Loader, Radio, Table, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useApi } from '../api/client';

export type VariablePickerProps = {
  fmuId: string;
  causality?: 'parameter' | 'output' | 'local' | 'all';
  /** view: 선택 없이 표시만 */
  mode: 'single' | 'multi' | 'view';
  value?: string[];
  onChange?: (names: string[]) => void;
  pageSize?: number;
};

function formatStart(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

export function VariablePicker({ fmuId, causality = 'all', mode, value = [], onChange, pageSize = 100 }: VariablePickerProps) {
  const api = useApi();
  const [search, setSearch] = useState('');
  const [q] = useDebouncedValue(search, 300);
  const [offset, setOffset] = useState(0);
  useEffect(() => setOffset(0), [q, causality]);

  const query = useQuery({
    queryKey: ['variables', fmuId, causality, q, offset, pageSize],
    queryFn: () => api.listVariables(fmuId, { q, causality, offset, limit: pageSize }),
    placeholderData: keepPreviousData,
  });

  const toggle = (name: string, checked: boolean) => {
    if (!onChange) return;
    if (mode === 'single') return onChange([name]);
    onChange(checked ? [...value, name] : value.filter(n => n !== name));
  };

  const total = query.data?.total ?? 0;
  const items = query.data?.items ?? [];

  return (
    <div>
      <Group mb="xs">
        <TextInput placeholder="변수 이름 또는 설명 검색" value={search}
          onChange={e => setSearch(e.currentTarget.value)} style={{ flex: 1 }} />
        {query.isFetching && <Loader size="xs" />}
      </Group>
      {query.isSuccess && items.length === 0 ? (
        <Text c="dimmed" size="sm">일치하는 변수가 없습니다</Text>
      ) : (
        <Table.ScrollContainer minWidth={600} mah={420}>
          <Table striped highlightOnHover stickyHeader>
            <Table.Thead>
              <Table.Tr>
                {mode !== 'view' && <Table.Th w={40} />}
                <Table.Th>이름</Table.Th>
                <Table.Th>타입</Table.Th>
                <Table.Th>기본값</Table.Th>
                <Table.Th>단위</Table.Th>
                <Table.Th>설명</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.map(v => {
                const checked = value.includes(v.name);
                return (
                  <Table.Tr key={v.name}>
                    {mode === 'multi' && (
                      <Table.Td>
                        <Checkbox aria-label={v.name} checked={checked} onChange={e => toggle(v.name, e.currentTarget.checked)} />
                      </Table.Td>
                    )}
                    {mode === 'single' && (
                      <Table.Td>
                        <Radio aria-label={v.name} checked={checked} onChange={() => toggle(v.name, true)} />
                      </Table.Td>
                    )}
                    <Table.Td><Text size="sm" ff="monospace">{v.name}</Text></Table.Td>
                    <Table.Td>{v.type}</Table.Td>
                    <Table.Td>{formatStart(v.start)}</Table.Td>
                    <Table.Td>{v.unit ?? ''}</Table.Td>
                    <Table.Td><Text size="xs" c="dimmed" lineClamp={2}>{v.description ?? ''}</Text></Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      <Group justify="space-between" mt="xs">
        <Text size="xs" c="dimmed">
          {total === 0 ? '0건' : `${offset + 1}–${Math.min(offset + pageSize, total)} / ${total.toLocaleString()}건`}
        </Text>
        <Group gap="xs">
          <Button size="xs" variant="default" disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - pageSize))}>이전 페이지</Button>
          <Button size="xs" variant="default" disabled={offset + pageSize >= total}
            onClick={() => setOffset(offset + pageSize)}>다음 페이지</Button>
        </Group>
      </Group>
    </div>
  );
}
