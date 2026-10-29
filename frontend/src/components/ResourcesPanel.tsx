import { Alert, Badge, Button, FileButton, Group, Modal, Table, Text, UnstyledButton } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { useApi } from '../api/client';
import type { ResourceCandidate, ResourceFile } from '../api/types';
import { CandidatePreview } from './CandidatePreview';

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

function extOf(path: string): string {
  const i = path.lastIndexOf('.');
  return i < 0 ? '' : path.slice(i);
}

function CandidateRows({ fmuId, res, onPreview }: {
  fmuId: string; res: ResourceFile; onPreview: (c: ResourceCandidate) => void;
}) {
  const api = useApi();
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ color: string; text: string } | null>(null);
  // 후보 삭제는 그 후보를 쓰던 variant도 지운다
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['resources', fmuId] });
    qc.invalidateQueries({ queryKey: ['variants', fmuId] });
  };
  const upload = useMutation({
    mutationFn: (file: File) => api.uploadCandidate(fmuId, res.path, file),
    onSuccess: c => {
      setNotice(c.existing ? { color: 'yellow', text: `같은 내용의 후보가 이미 있습니다: ${c.name}` } : null);
      refresh();
    },
    onError: (e: Error) => setNotice({ color: 'red', text: e.message }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteCandidate(fmuId, id),
    onSuccess: () => { setNotice(null); refresh(); },
    onError: (e: Error) => setNotice({ color: 'red', text: e.message }),
  });

  return (
    <div data-testid={`candidates-${res.path}`}>
      <Table fz="xs" withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>후보</Table.Th><Table.Th>크기</Table.Th><Table.Th>해시</Table.Th><Table.Th>run</Table.Th><Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {res.candidates.map(c => (
            <Table.Tr key={c.id} data-testid="candidate-row">
              <Table.Td>
                <Group gap={6}>{c.name}{c.isOriginal && <Badge size="xs" variant="light">원본</Badge>}</Group>
              </Table.Td>
              <Table.Td>{formatSize(c.size)}</Table.Td>
              <Table.Td><Text ff="monospace" size="xs">{c.sha256.slice(0, 8)}</Text></Table.Td>
              <Table.Td>{c.nRuns.toLocaleString()}</Table.Td>
              <Table.Td>
                <Group gap={4} justify="flex-end">
                  <Button size="compact-xs" variant="default" onClick={() => onPreview(c)}>미리보기</Button>
                  {!c.isOriginal && (
                    <Button size="compact-xs" color="red" variant="subtle" loading={remove.isPending && remove.variables === c.id}
                      onClick={() => remove.mutate(c.id)}>삭제</Button>
                  )}
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Group mt={6} gap="xs">
        <FileButton onChange={f => { setNotice(null); if (f) upload.mutate(f); }} accept={extOf(res.path)}
          inputProps={{ 'data-testid': `upload-${res.path}` } as object}>
          {props => <Button {...props} size="compact-xs" variant="light" loading={upload.isPending}>후보 업로드 ({extOf(res.path)})</Button>}
        </FileButton>
        <Text size="xs" c="dimmed">밖에서 수정한 파일을 올리면 이 자리에 바꿔 넣어 해석할 수 있습니다</Text>
      </Group>
      {notice && <Alert color={notice.color} mt={6} py={6}>{notice.text}</Alert>}
    </div>
  );
}

/** FMU resources/ 파일 목록과 후보 관리 */
export function ResourcesPanel({ fmuId }: { fmuId: string }) {
  const api = useApi();
  const resources = useQuery({ queryKey: ['resources', fmuId], queryFn: () => api.listResources(fmuId) });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<ResourceCandidate | null>(null);
  const toggle = (path: string) => setOpen(s => {
    const n = new Set(s);
    if (n.has(path)) n.delete(path); else n.add(path);
    return n;
  });

  if (resources.isError) return <Alert color="red">{(resources.error as Error).message}</Alert>;
  const list = resources.data ?? [];
  return (
    <>
      {resources.isSuccess && list.length === 0 && <Text c="dimmed" size="sm">이 FMU에는 resource 파일이 없습니다</Text>}
      {list.length > 0 && (
        <Table fz="sm" highlightOnHover>
          <Table.Thead>
            <Table.Tr><Table.Th>경로 (resources/)</Table.Th><Table.Th>크기</Table.Th><Table.Th>후보</Table.Th></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {list.map(r => (
              <Fragment key={r.path}>
                <Table.Tr>
                  <Table.Td>
                    <UnstyledButton onClick={() => toggle(r.path)} aria-label={r.path} aria-expanded={open.has(r.path)}>
                      <Text size="sm" ff="monospace">{open.has(r.path) ? '▾' : '▸'} {r.path}</Text>
                    </UnstyledButton>
                  </Table.Td>
                  <Table.Td>{formatSize(r.size)}</Table.Td>
                  <Table.Td>{r.candidates.length}</Table.Td>
                </Table.Tr>
                {open.has(r.path) && (
                  <Table.Tr>
                    <Table.Td colSpan={3}>
                      <CandidateRows fmuId={fmuId} res={r} onPreview={setPreview} />
                    </Table.Td>
                  </Table.Tr>
                )}
              </Fragment>
            ))}
          </Table.Tbody>
        </Table>
      )}
      <Modal opened={!!preview} onClose={() => setPreview(null)} size="xl" closeButtonProps={{ 'aria-label': '닫기' }}
        title={preview ? `${preview.path} — ${preview.name}` : ''} transitionProps={{ duration: 0 }}>
        {preview && <CandidatePreview fmuId={fmuId} candidateId={preview.id} />}
      </Modal>
    </>
  );
}
