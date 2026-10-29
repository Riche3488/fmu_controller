import { Group, Progress, Select, Stack, Table, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../api/client';
import { JobStatusBadge } from '../components/JobStatusBadge';

/** 잡 표. fmuId가 있으면 그 FMU 잡만 보여 준다. */
export function JobsTable({ fmuId }: { fmuId: string | null }) {
  const api = useApi();
  const navigate = useNavigate();
  const fmus = useQuery({ queryKey: ['fmus'], queryFn: () => api.listFmus() });
  const jobs = useQuery({
    queryKey: ['jobs', fmuId], queryFn: () => api.listJobs(fmuId ? { fmuId } : {}), refetchInterval: 3000,
  });
  const fmuName = (id: string) => fmus.data?.find(f => f.id === id)?.modelName ?? id;

  return (
    <>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>이름</Table.Th><Table.Th>종류</Table.Th><Table.Th>FMU</Table.Th>
            <Table.Th>상태</Table.Th><Table.Th>진행</Table.Th><Table.Th>생성</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(jobs.data ?? []).map(j => {
            const done = j.completed + j.failed;
            return (
              <Table.Tr key={j.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/jobs/${j.id}`)}>
                <Table.Td>{j.name}</Table.Td>
                <Table.Td>{j.kind === 'batch' ? '배치' : '최적화'}</Table.Td>
                <Table.Td>{fmuName(j.fmuId)}</Table.Td>
                <Table.Td><JobStatusBadge status={j.status} /></Table.Td>
                <Table.Td w={200}>
                  <Progress value={j.total ? (100 * done) / j.total : 0} size="sm" />
                  <Text size="xs" c="dimmed">{done} / {j.total}{j.failed ? ` (실패 ${j.failed})` : ''}</Text>
                </Table.Td>
                <Table.Td>{new Date(j.createdAt).toLocaleString()}</Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
      {jobs.isSuccess && jobs.data.length === 0 && <Text c="dimmed">잡이 없습니다</Text>}
    </>
  );
}

export function JobListPage() {
  const api = useApi();
  const [fmuId, setFmuId] = useState<string | null>(null);
  const fmus = useQuery({ queryKey: ['fmus'], queryFn: () => api.listFmus() });
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>잡 목록</Title>
        <Select placeholder="모든 FMU" clearable value={fmuId} onChange={setFmuId} w={280}
          data={(fmus.data ?? []).map(f => ({ value: f.id, label: `${f.modelName} (${f.fileName})` }))} />
      </Group>
      <JobsTable fmuId={fmuId} />
    </Stack>
  );
}
