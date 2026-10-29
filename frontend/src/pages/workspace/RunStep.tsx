import { Tabs } from '@mantine/core';
import { useParams, useSearchParams } from 'react-router-dom';
import { BatchSetupPage } from '../BatchSetupPage';
import { JobsTable } from '../JobListPage';
import { OptimizationSetupPage } from '../OptimizationSetupPage';

const TABS = ['batch', 'optimize', 'jobs'] as const;

export function RunStep() {
  const { fmuId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = TABS.find(t => t === params.get('tab')) ?? 'batch';
  return (
    <Tabs value={tab} onChange={v => v && setParams({ tab: v }, { replace: true })} keepMounted={false}>
      <Tabs.List>
        <Tabs.Tab value="batch">배치 해석</Tabs.Tab>
        <Tabs.Tab value="optimize">최적화</Tabs.Tab>
        <Tabs.Tab value="jobs">잡</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="batch" pt="sm"><BatchSetupPage /></Tabs.Panel>
      <Tabs.Panel value="optimize" pt="sm"><OptimizationSetupPage /></Tabs.Panel>
      <Tabs.Panel value="jobs" pt="sm"><JobsTable fmuId={fmuId} /></Tabs.Panel>
    </Tabs>
  );
}
