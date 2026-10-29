import { Alert, Badge, Group, Stack, Table, Text, Title } from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../api/client';

export function FmuListPage() {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const fmus = useQuery({ queryKey: ['fmus'], queryFn: () => api.listFmus() });
  const upload = useMutation({
    mutationFn: (file: File) => api.uploadFmu(file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fmus'] }),
    onError: (e: Error) => setError(e.message),
  });

  const onDrop = (files: File[]) => {
    setError(null);
    const bad = files.find(f => !f.name.toLowerCase().endsWith('.fmu'));
    if (bad) return setError('FMU 파일(.fmu)만 업로드할 수 있습니다');
    files.forEach(f => upload.mutate(f));
  };

  return (
    <Stack>
      <Title order={2}>FMU 라이브러리</Title>
      <Dropzone onDrop={onDrop} loading={upload.isPending} inputProps={{ 'data-testid': 'fmu-upload-input' } as object}>
        <Text ta="center" py="md">FMU 파일을 끌어다 놓거나 클릭해서 업로드하세요</Text>
      </Dropzone>
      {error && <Alert color="red">{error}</Alert>}
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>모델</Table.Th>
            <Table.Th>파일</Table.Th>
            <Table.Th>FMI</Table.Th>
            <Table.Th>파라미터</Table.Th>
            <Table.Th>출력</Table.Th>
            <Table.Th>누적 run</Table.Th>
            <Table.Th>업로드</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(fmus.data ?? []).map(f => (
            <Table.Tr key={f.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/fmus/${f.id}`)}>
              <Table.Td>{f.modelName}</Table.Td>
              <Table.Td>{f.fileName}</Table.Td>
              <Table.Td>
                <Group gap={4}>{f.fmiTypes.map(t => <Badge key={t} variant="light">{t}</Badge>)}</Group>
              </Table.Td>
              <Table.Td>{f.nParameters.toLocaleString()}</Table.Td>
              <Table.Td>{f.nOutputs.toLocaleString()}</Table.Td>
              <Table.Td>{f.nRuns.toLocaleString()}</Table.Td>
              <Table.Td>{new Date(f.uploadedAt).toLocaleString()}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {fmus.isSuccess && fmus.data.length === 0 && <Text c="dimmed">업로드된 FMU가 없습니다</Text>}
    </Stack>
  );
}
