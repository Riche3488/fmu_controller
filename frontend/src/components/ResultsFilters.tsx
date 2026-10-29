// 결과 분석 상단 필터(잡·Resource 조합·상태·목적함수). 작업대와 결과 표가 같은 값을 쓴다.
import { Card, Group, MultiSelect, Select, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api/client';
import type { Job } from '../api/types';
import { ObjectivePicker } from './ObjectivePicker';
import { useVariants } from './ResourceGroupSection';

export type ResultsFilterState = {
  jobIds: string[];
  variantIds: string[];
  status: 'ok' | 'failed' | null;
  /** 결과 표에 열로 보여 줄 목적함수 (작업대는 전부 계산한다) */
  objectiveIds: string[];
};

const NO_TRANSITION = { transitionProps: { duration: 0 } };

export function ResultsFilters({ fmuId, value, onChange }: {
  fmuId: string;
  value: ResultsFilterState;
  onChange: (next: ResultsFilterState) => void;
}) {
  const api = useApi();
  const jobs = useQuery({ queryKey: ['jobs', fmuId], queryFn: () => api.listJobs({ fmuId }) });
  const variantList = useVariants(fmuId).data ?? [];
  const set = (patch: Partial<ResultsFilterState>) => onChange({ ...value, ...patch });
  return (
    <>
      <Group align="end">
        <MultiSelect label="잡 필터" placeholder="모든 잡" clearable w={360} value={value.jobIds}
          onChange={v => set({ jobIds: v })} comboboxProps={NO_TRANSITION}
          data={(jobs.data ?? []).map((j: Job) => ({ value: j.id, label: `${j.name} (${j.kind === 'batch' ? '배치' : '최적화'})` }))} />
        {variantList.length > 1 && (
          <MultiSelect label="Resource 조합" placeholder="모든 조합" clearable w={360} value={value.variantIds}
            onChange={v => set({ variantIds: v })} comboboxProps={NO_TRANSITION}
            data={variantList.map(v => ({ value: v.id, label: v.label }))} />
        )}
        <Select label="상태" placeholder="전체" clearable w={140} value={value.status} data={['ok', 'failed']}
          onChange={v => set({ status: v as ResultsFilterState['status'] })} comboboxProps={NO_TRANSITION} />
      </Group>
      <Card withBorder>
        <Text size="sm" fw={500} mb="xs">결과 표에 보일 목적함수</Text>
        <ObjectivePicker value={value.objectiveIds} onChange={ids => set({ objectiveIds: ids })} />
      </Card>
    </>
  );
}
