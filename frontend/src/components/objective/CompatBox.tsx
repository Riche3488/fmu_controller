// 목적함수가 읽는 컬럼이 이 FMU의 잡(또는 잡이 없으면 FMU 변수)과 맞는지
import { Anchor, Badge, Group, Stack, Text } from '@mantine/core';
import { Link } from 'react-router-dom';
import type { Job } from '../../api/types';
import { fmuCompat, jobCompat, recordParam, summarize } from '../../lib/compat';

export function CompatBox({ fmuId, required, estimated, jobs, outputNames, fmuVarNames }: {
  fmuId: string;
  required: string[];
  estimated: boolean;
  jobs: Job[] | undefined;
  outputNames: string[] | undefined;
  fmuVarNames: string[] | undefined;
}) {
  if (!jobs || !outputNames) return <Text size="sm" c="dimmed">호환성 확인 중…</Text>;
  const tag = estimated && <Badge size="xs" variant="outline" color="gray">추정</Badge>;

  if (jobs.length === 0) {
    if (!fmuVarNames) return <Text size="sm" c="dimmed">호환성 확인 중…</Text>;
    const f = fmuCompat(required, fmuVarNames);
    return (
      <Group gap="xs">
        <Text size="sm" c={f.recordable ? undefined : 'red'}>
          {f.recordable ? '기록 가능' : `FMU에 없는 변수: ${f.unknown.join(', ')}`}
        </Text>
        {tag}
      </Group>
    );
  }

  const c = jobCompat(required, jobs, outputNames);
  const s = summarize(c);
  const missing = [...new Set(c.flatMap(x => x.missing))];
  return (
    <Stack gap={4}>
      <Group gap="xs">
        <Text size="sm" c={s.okJobs === 0 ? 'red' : undefined}>
          이 FMU 잡 {s.totalJobs}개 중 {s.okJobs}개 호환
        </Text>
        {tag}
      </Group>
      {missing.length > 0 && (
        <>
          <Text size="xs" c="dimmed">일부 잡에 기록되지 않은 컬럼: {missing.join(', ')}</Text>
          <Anchor component={Link} size="sm"
            to={`/fmus/${fmuId}/run?tab=batch&record=${encodeURIComponent(recordParam(missing))}`}>
            ④ 실행에서 기록 변수에 추가
          </Anchor>
        </>
      )}
    </Stack>
  );
}
