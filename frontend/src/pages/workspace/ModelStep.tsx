import { Card, SimpleGrid, Stack, Tabs, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { useApi } from '../../api/client';
import { VariablePicker } from '../../components/VariablePicker';

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Text size="xs" c="dimmed">{label}</Text>
      <Text size="sm">{value}</Text>
    </div>
  );
}

export function ModelStep() {
  const { fmuId = '' } = useParams();
  const api = useApi();
  const fmu = useQuery({ queryKey: ['fmu', fmuId], queryFn: () => api.getFmu(fmuId) });
  if (!fmu.data) return fmu.isError ? <Text c="red">{(fmu.error as Error).message}</Text> : null;
  const f = fmu.data;
  const exp = f.defaultExperiment;

  return (
    <Stack>
      <Title order={2}>{f.modelName}</Title>
      <Card withBorder>
        <SimpleGrid cols={{ base: 2, md: 4 }}>
          <Field label="파일" value={f.fileName} />
          <Field label="GUID" value={f.guid} />
          <Field label="FMI" value={`${f.fmiVersion} · ${f.fmiTypes.join(', ')}`} />
          <Field label="생성 도구" value={f.generationTool} />
          <Field label="기본 실험" value={`${exp.startTime} – ${exp.stopTime} s, tol ${exp.tolerance ?? '-'}`} />
          <Field label="변수" value={`${f.nVariables.toLocaleString()} (파라미터 ${f.nParameters.toLocaleString()}, 출력 ${f.nOutputs.toLocaleString()})`} />
          <Field label="누적 run" value={f.nRuns.toLocaleString()} />
          <Field label="ID" value={f.id} />
        </SimpleGrid>
      </Card>
      <Tabs defaultValue="parameter" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="parameter">파라미터</Tabs.Tab>
          <Tabs.Tab value="output">출력</Tabs.Tab>
          <Tabs.Tab value="all">전체</Tabs.Tab>
        </Tabs.List>
        {(['parameter', 'output', 'all'] as const).map(c => (
          <Tabs.Panel key={c} value={c} pt="sm">
            <VariablePicker fmuId={f.id} causality={c} mode="view" />
          </Tabs.Panel>
        ))}
      </Tabs>
    </Stack>
  );
}
