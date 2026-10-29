// run이 없을 때 FMU 기본값으로 run 1개짜리 배치를 돌려 미리보기 run을 만든다
import { Button, Group, Text, Tooltip } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useApi } from '../../api/client';
import type { Job, Variable } from '../../api/types';
import { defaultSimSettings } from '../SimSettingsForm';

const NO_PARAM = '시험 실행에 쓸 수치 파라미터가 없습니다';

function clock(d = new Date()): string {
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
}

// 배치는 스윕 파라미터가 하나 이상 필요하므로 기본값 그대로인 수치 파라미터 하나를 값 1개로 넣는다
function trialParam(vars: Variable[]): Variable | null {
  return vars.find(v => v.type === 'Real' && typeof v.start === 'number' && Number.isFinite(v.start)) ?? null;
}

export function TrialRunButton({ fmuId, columns, onDone }: {
  fmuId: string; columns: string[]; onDone: (runId: string) => void;
}) {
  const api = useApi();
  const qc = useQueryClient();
  const fmu = useQuery({ queryKey: ['fmu', fmuId], queryFn: () => api.getFmu(fmuId) });
  const params = useQuery({
    queryKey: ['variables', fmuId, 'parameter', 'trial-run'],
    queryFn: () => api.listVariables(fmuId, { causality: 'parameter', offset: 0, limit: 500 }),
  });
  const param = params.data ? trialParam(params.data.items) : null;
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: () => api.createBatch({
      name: `시험 실행 ${clock()}`, fmuId,
      params: [{ name: param!.name, mode: 'list', values: [param!.start as number] }],
      sampling: 'grid', nSamples: null, fixedParams: {},
      sim: defaultSimSettings(fmu.data!.defaultExperiment),
      recordVariables: columns.filter(c => c !== 'time'),
      plotVariables: [], workers: 1, runTimeoutSec: 600,
    }),
    onSuccess: j => { setError(null); setJob(j); },
    onError: e => setError((e as Error).message),
  });

  const jobId = job?.id;
  useEffect(() => {
    if (!jobId) return;
    let done = false;
    const unsub = api.subscribeJob(jobId, e => {
      if (e.type !== 'end' || done) return;
      done = true;
      setJob(null);
      qc.invalidateQueries({ queryKey: ['runs'] });
      qc.invalidateQueries({ queryKey: ['jobs'] });
      api.listRuns({ jobIds: [jobId], status: 'ok', limit: 1 })
        .then(page => {
          if (page.items[0]) onDone(page.items[0].id);
          else setError(e.job.error ?? '시험 실행에서 성공한 run이 없습니다');
        })
        .catch(err => setError((err as Error).message));
    });
    return unsub;
  }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  const running = !!job || submit.isPending;
  const disabled = !param || !fmu.data || running;
  return (
    <Group gap="sm">
      <Tooltip label={NO_PARAM} disabled={!params.isSuccess || !!param}>
        {/* 비활성 버튼에도 툴팁이 뜨도록 감싼다 */}
        <span>
          <Button variant="light" loading={running} disabled={disabled} onClick={() => submit.mutate()}>
            기본값으로 시험 실행
          </Button>
        </span>
      </Tooltip>
      {job && <Text size="sm" c="dimmed">{job.name} 진행 중…</Text>}
      {error && <Text size="sm" c="red">{error}</Text>}
    </Group>
  );
}
