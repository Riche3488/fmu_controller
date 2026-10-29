import { Alert, Code, Group, Loader, Table, Text, UnstyledButton } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import ReactECharts from 'echarts-for-react';
import { useState } from 'react';
import { useApi } from '../api/client';
import type { MatVariable } from '../api/types';

/** 2D 숫자 배열이면 그래프로 그릴 수 있다 (첫 열 x, 나머지 y) */
function plottable(v: MatVariable): boolean {
  return /^(float|int|uint)/.test(v.dtype) && v.shape.length <= 2 && v.shape.every(n => n > 0);
}

function MatPlot({ name, rows }: { name: string; rows: number[][] }) {
  const ny = Math.max(0, (rows[0]?.length ?? 0) - 1);
  const series = rows[0]?.length === 1
    ? [{ name, type: 'line', showSymbol: false, data: rows.map((r, i) => [i, r[0]]) }]
    : Array.from({ length: ny }, (_, j) => ({
      name: `${name}[:, ${j + 1}]`, type: 'line', showSymbol: false, data: rows.map(r => [r[0], r[j + 1]]),
    }));
  const option = {
    animation: false,
    tooltip: { trigger: 'axis' },
    legend: { top: 0 },
    grid: { left: 60, right: 20, top: 40, bottom: 40 },
    xAxis: { type: 'value', name: rows[0]?.length === 1 ? 'index' : `${name}[:, 0]`, nameLocation: 'middle', nameGap: 25 },
    yAxis: { type: 'value', scale: true },
    series,
  };
  return <ReactECharts data-testid="mat-plot" option={option} notMerge style={{ height: 300 }} />;
}

/** 후보 파일 미리보기: 텍스트는 그대로, .mat은 변수 표 + 선택 변수 그래프, 그 외는 안내 */
export function CandidatePreview({ fmuId, candidateId }: { fmuId: string; candidateId: string }) {
  const api = useApi();
  const [varName, setVarName] = useState<string | undefined>();
  const base = useQuery({
    queryKey: ['candidate-preview', fmuId, candidateId],
    queryFn: () => api.previewCandidate(fmuId, candidateId),
  });
  const plot = useQuery({
    queryKey: ['candidate-preview', fmuId, candidateId, varName],
    queryFn: () => api.previewCandidate(fmuId, candidateId, varName),
    enabled: !!varName,
  });

  if (base.isError) return <Alert color="red">{(base.error as Error).message}</Alert>;
  const p = base.data;
  if (!p) return <Loader size="sm" />;
  if (p.kind === 'binary') return <Text c="dimmed" size="sm">{p.note}</Text>;
  if (p.kind === 'text') {
    return (
      <>
        {p.truncated && <Text size="xs" c="dimmed" mb={4}>앞부분만 표시합니다</Text>}
        <Code block mah={480} style={{ overflow: 'auto' }}>{p.text}</Code>
      </>
    );
  }
  const shown = plot.data?.kind === 'mat' ? plot.data.plot : null;
  return (
    <>
      <Table fz="xs" withTableBorder>
        <Table.Thead>
          <Table.Tr><Table.Th>변수</Table.Th><Table.Th>크기</Table.Th><Table.Th>형식</Table.Th></Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {p.variables.map(v => (
            <Table.Tr key={v.name}>
              <Table.Td>
                {plottable(v)
                  ? <UnstyledButton onClick={() => setVarName(v.name)}><Text size="xs" c="blue" fw={v.name === varName ? 700 : 400}>{v.name}</Text></UnstyledButton>
                  : v.name}
              </Table.Td>
              <Table.Td>{v.shape.join(' × ')}</Table.Td>
              <Table.Td>{v.dtype}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {varName && (
        <Group mt="sm" display="block">
          {plot.isError && <Alert color="red">{(plot.error as Error).message}</Alert>}
          {plot.isLoading && <Loader size="sm" />}
          {shown && <MatPlot name={shown.name} rows={shown.rows} />}
        </Group>
      )}
    </>
  );
}
