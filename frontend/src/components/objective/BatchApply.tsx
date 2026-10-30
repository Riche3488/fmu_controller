// 저장 전 코드를 이 FMU의 최근 성공 run 여러 개에 적용해 값 분포와 오류를 본다
import { Button, Stack, Table, Text } from '@mantine/core';
import { useMutation } from '@tanstack/react-query';
import ReactECharts from 'echarts-for-react';
import { useApi, type ApiClient } from '../../api/client';
import type { ObjectiveTestResult, RunRow } from '../../api/types';
import { histogram } from '../../lib/vizStats';
import { useEchartsTheme } from '../../theme';

const MAX_RUNS = 200;
const MAX_ERRORS = 20;

/** 최근 잡부터 성공 run을 최대 MAX_RUNS개 모은다 (listJobs는 최신순). */
async function recentOkRuns(api: ApiClient, fmuId: string): Promise<{ run: RunRow; jobName: string }[]> {
  const jobs = await api.listJobs({ fmuId });
  const out: { run: RunRow; jobName: string }[] = [];
  for (const job of jobs) {
    if (out.length >= MAX_RUNS) break;
    const page = await api.listRuns({ jobIds: [job.id], status: 'ok', limit: MAX_RUNS - out.length });
    out.push(...page.items.map(run => ({ run, jobName: job.name })));
  }
  return out;
}

const fmt = (v: number) => String(Number(v.toPrecision(4)));

export function BatchApply({ code, fmuId }: { code: string; fmuId: string }) {
  const api = useApi();
  const theme = useEchartsTheme();
  const apply = useMutation({
    mutationFn: async (c: string) => {
      const runs = await recentOkRuns(api, fmuId);
      if (!runs.length) return { runs, results: {} as Record<string, ObjectiveTestResult> };
      const { results } = await api.testObjectiveBatch({ code: c, runIds: runs.map(r => r.run.id) });
      return { runs, results };
    },
  });

  // 결과는 그 결과를 낸 코드일 때만 보여 준다 (코드를 고치면 이전 결과는 사라진다)
  const current = apply.variables === code;
  const data = current ? apply.data : undefined;
  const values = data ? data.runs.map(r => data.results[r.run.id]?.value).filter((v): v is number => typeof v === 'number') : [];
  const errors = data ? data.runs.filter(r => data.results[r.run.id]?.error) : [];
  const h = histogram(values);

  return (
    <Stack gap="xs">
      <Button variant="light" onClick={() => apply.mutate(code)} loading={apply.isPending && current} disabled={!code.trim()}>
        여러 run에 일괄 적용
      </Button>
      {current && apply.isError && <Text size="sm" c="red">{(apply.error as Error).message}</Text>}
      {data && data.runs.length === 0 && <Text size="sm" c="dimmed">이 FMU에 성공한 run이 없습니다</Text>}
      {data && data.runs.length > 0 && (
        <>
          <Text size="sm">
            {data.runs.length}개 run 중 <span className="fmuc-num">{values.length}</span>개 계산됨
            {errors.length > 0 && <>, 오류 <span className="fmuc-num">{errors.length}</span>개</>}
          </Text>
          {h.counts.length > 0 && (
            <ReactECharts
              theme={theme} data-testid="batch-histogram" notMerge style={{ height: 200 }}
              option={{
                animation: false,
                tooltip: { trigger: 'axis' },
                grid: { left: 40, right: 12, top: 12, bottom: 40 },
                xAxis: {
                  type: 'category', data: h.counts.map((_, i) => `${fmt(h.edges[i])} ~ ${fmt(h.edges[i + 1])}`),
                  axisLabel: { hideOverlap: true },
                },
                yAxis: { type: 'value', minInterval: 1 },
                series: [{ type: 'bar', data: h.counts, barCategoryGap: '5%' }],
              }}
            />
          )}
          {errors.length > 0 && (
            <Table fz="xs">
              <Table.Thead><Table.Tr><Table.Th>run</Table.Th><Table.Th>오류</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {errors.slice(0, MAX_ERRORS).map(({ run, jobName }) => (
                  <Table.Tr key={run.id}>
                    <Table.Td>{jobName} #{run.index}</Table.Td>
                    <Table.Td>{data.results[run.id].error}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
          {errors.length > MAX_ERRORS && <Text size="xs" c="dimmed">외 {errors.length - MAX_ERRORS}개</Text>}
        </>
      )}
    </Stack>
  );
}
