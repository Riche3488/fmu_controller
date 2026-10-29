import { Stack, Text, Title } from '@mantine/core';
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { ResourcesPanel } from '../../components/ResourcesPanel';
import { markResourcesVisited } from '../../lib/workflow';

export function ResourcesStep() {
  const { fmuId = '' } = useParams();
  useEffect(() => { markResourcesVisited(fmuId); }, [fmuId]);
  return (
    <Stack>
      <Title order={2}>변수·리소스</Title>
      <Text size="sm" c="dimmed">기록할 변수는 ④ 실행에서 고릅니다. 여기서는 resources/ 후보 파일을 관리합니다.</Text>
      <ResourcesPanel fmuId={fmuId} />
    </Stack>
  );
}
