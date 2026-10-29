import { Card, Group, Table, Text } from '@mantine/core';
import type { Direction, RunRow } from '../api/types';

/** 단일 목적 최적화의 현재 최적 trial: 목적값, 파라미터, resource 조합 */
export function BestTrialCard({ rows, objective, direction, paramNames, variantLabel }: {
  rows: RunRow[];
  objective: { id: string; name: string };
  direction: Direction;
  paramNames: string[];
  variantLabel: (variantId: string) => string;
}) {
  let best: RunRow | null = null;
  for (const r of rows) {
    const v = r.objectives[objective.id]?.value;
    if (r.status !== 'ok' || v === null || v === undefined) continue;
    const b = best?.objectives[objective.id]?.value;
    if (b === null || b === undefined || (direction === 'minimize' ? v < b : v > b)) best = r;
  }
  return (
    <Card withBorder data-testid="best-trial">
      <Text size="sm" fw={500} mb="xs">현재 최적 trial</Text>
      {!best ? <Text size="sm" c="dimmed">아직 성공한 trial이 없습니다</Text> : (
        <>
          <Group gap="xl" mb="xs">
            <Text size="sm">#{best.index}</Text>
            <Text size="sm" fw={600}>{objective.name} = {best.objectives[objective.id].value}</Text>
            <Text size="sm">Resource 조합: <Text span fw={500}>{variantLabel(best.variantId)}</Text></Text>
          </Group>
          {paramNames.length > 0 && (
            <Table fz="xs">
              <Table.Tbody>
                {paramNames.map(p => (
                  <Table.Tr key={p}><Table.Td ff="monospace">{p}</Table.Td><Table.Td>{String(best!.params[p] ?? '')}</Table.Td></Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </>
      )}
    </Card>
  );
}
