import { Badge, Checkbox, Group, Table, Text, Tooltip, UnstyledButton } from '@mantine/core';
import type { RunRow, SortBy } from '../api/types';
import { CodeHashBadge } from './CodeHashBadge';

export type Sort = { by: SortBy; dir: 'asc' | 'desc' };

function fmt(v: unknown): string {
  if (typeof v === 'number') return Math.abs(v) >= 1e5 || (v !== 0 && Math.abs(v) < 1e-3) ? v.toExponential(4) : String(+v.toFixed(6));
  return v === undefined || v === null ? '' : String(v);
}

function SortHeader({ label, by, sort, onSort, children }: {
  label: string; by: SortBy; sort: Sort; onSort: (s: Sort) => void; children?: React.ReactNode;
}) {
  const active = sort.by === by;
  return (
    <Table.Th>
      <Group gap={4} wrap="nowrap">
        <UnstyledButton onClick={() => onSort({ by, dir: active && sort.dir === 'asc' ? 'desc' : 'asc' })}>
          <Text size="sm" fw={600}>{label}{active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</Text>
        </UnstyledButton>
        {children}
      </Group>
    </Table.Th>
  );
}

/** run 표: 파라미터 + (선택된) 목적함수 값 + 상태. 헤더 클릭으로 서버 정렬. */
export function RunTable({ rows, paramNames, objectives, codeHashes, sort, onSort, selected, onToggle, maxSelected = 10, showJob }: {
  rows: RunRow[];
  paramNames: string[];
  objectives: { id: string; name: string }[];
  codeHashes: Record<string, string>;
  sort: Sort;
  onSort: (s: Sort) => void;
  selected: string[];
  onToggle: (id: string) => void;
  maxSelected?: number;
  showJob?: (jobId: string) => string;
}) {
  return (
    <Table.ScrollContainer minWidth={700} mah={480}>
      <Table striped highlightOnHover stickyHeader fz="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={32} />
            {showJob && <Table.Th>잡</Table.Th>}
            <SortHeader label="#" by="index" sort={sort} onSort={onSort} />
            <Table.Th>상태</Table.Th>
            {paramNames.map(p => <SortHeader key={p} label={p} by={`param:${p}`} sort={sort} onSort={onSort} />)}
            {objectives.map(o => (
              <SortHeader key={o.id} label={o.name} by={`objective:${o.id}`} sort={sort} onSort={onSort}>
                {codeHashes[o.id] && <CodeHashBadge hash={codeHashes[o.id]} />}
              </SortHeader>
            ))}
            <SortHeader label="시간 [s]" by="elapsedSec" sort={sort} onSort={onSort} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map(r => {
            const isSel = selected.includes(r.id);
            return (
              <Table.Tr key={r.id} data-testid="run-row">
                <Table.Td>
                  <Checkbox aria-label={`run ${r.index} 선택`} checked={isSel}
                    disabled={!isSel && selected.length >= maxSelected} onChange={() => onToggle(r.id)} />
                </Table.Td>
                {showJob && <Table.Td>{showJob(r.jobId)}</Table.Td>}
                <Table.Td>{r.index}</Table.Td>
                <Table.Td>
                  {r.status === 'ok' ? <Badge size="xs" color="green" variant="light">ok</Badge> : (
                    <Tooltip label={r.error ?? ''} multiline w={320}><Badge size="xs" color="red" variant="light">failed</Badge></Tooltip>
                  )}
                </Table.Td>
                {paramNames.map(p => <Table.Td key={p}>{fmt(r.params[p])}</Table.Td>)}
                {objectives.map(o => {
                  const v = r.objectives[o.id];
                  return (
                    <Table.Td key={o.id}>
                      {v?.error ? (
                        <Tooltip label={v.error} multiline w={360}><Text size="xs" c="red">오류</Text></Tooltip>
                      ) : fmt(v?.value)}
                    </Table.Td>
                  );
                })}
                <Table.Td>{fmt(r.elapsedSec)}</Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
