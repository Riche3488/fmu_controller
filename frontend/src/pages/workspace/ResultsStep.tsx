// ⑤ 결과 분석: 상단 필터 → 작업대(기본) / 결과 표 / 비교 탭. run 선택은 작업대와 결과 표가 공유한다.
import { Stack, Tabs, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useApi } from '../../api/client';
import { ResultsFilters, type ResultsFilterState } from '../../components/ResultsFilters';
import { SelectionProvider } from '../../components/workbench/SelectionContext';
import { Workbench } from '../../components/workbench/Workbench';
import type { WorkbenchFilter } from '../../components/workbench/useWorkbenchData';
import { FmuCompare, ResultsTable, VariantCompare } from '../ResultsPage';

export function ResultsStep() {
  const { fmuId = '' } = useParams();
  const api = useApi();
  const fmu = useQuery({ queryKey: ['fmu', fmuId], queryFn: () => api.getFmu(fmuId) });
  const [filter, setFilter] = useState<ResultsFilterState>({ jobIds: [], variantIds: [], status: null, objectiveIds: [] });
  const { jobIds, variantIds, status } = filter;
  // 목적함수 열 선택만 바뀔 때는 작업대 범위를 새로 만들지 않는다
  const wbFilter = useMemo<WorkbenchFilter>(
    () => ({ jobIds, variantIds, status: status ?? undefined }), [jobIds, variantIds, status]);

  if (!fmu.data) return fmu.isError ? <Text c="red">{(fmu.error as Error).message}</Text> : null;
  return (
    <SelectionProvider>
      <Stack>
        <Title order={2}>결과 분석</Title>
        <Text c="dimmed" size="sm">{fmu.data.modelName} · {fmu.data.fileName} — 누적 run {fmu.data.nRuns.toLocaleString()}개</Text>
        <ResultsFilters fmuId={fmuId} value={filter} onChange={setFilter} />
        <Tabs defaultValue="workbench" keepMounted={false}>
          <Tabs.List>
            <Tabs.Tab value="workbench">작업대</Tabs.Tab>
            <Tabs.Tab value="table">결과 표</Tabs.Tab>
            <Tabs.Tab value="compare">FMU 비교</Tabs.Tab>
            <Tabs.Tab value="variants">Resource 조합 비교</Tabs.Tab>
          </Tabs.List>
          {/* 탭을 오가도 패널 구성·불러온 프리셋이 남도록 작업대는 늘 마운트해 둔다 */}
          <Tabs.Panel value="workbench" pt="sm" keepMounted><Workbench fmuId={fmuId} filter={wbFilter} /></Tabs.Panel>
          <Tabs.Panel value="table" pt="sm"><ResultsTable fmu={fmu.data} filter={filter} /></Tabs.Panel>
          <Tabs.Panel value="compare" pt="sm"><FmuCompare fmu={fmu.data} /></Tabs.Panel>
          <Tabs.Panel value="variants" pt="sm"><VariantCompare fmu={fmu.data} /></Tabs.Panel>
        </Tabs>
      </Stack>
    </SelectionProvider>
  );
}
