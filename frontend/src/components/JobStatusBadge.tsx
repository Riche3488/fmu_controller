import { Badge } from '@mantine/core';
import type { JobStatus } from '../api/types';

const LABEL: Record<JobStatus, [string, string]> = {
  queued: ['대기', 'gray'],
  running: ['실행 중', 'blue'],
  done: ['완료', 'green'],
  failed: ['실패', 'red'],
  cancelled: ['취소됨', 'orange'],
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const [label, color] = LABEL[status];
  return <Badge color={color} variant="light">{label}</Badge>;
}
