import { Alert, Anchor, Badge, Card, Checkbox, Grid, Group, Loader, Progress, Stack, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useApi } from '../api/client';
import type { FmuSummary, Job } from '../api/types';
import { FmuUpload } from '../components/FmuUpload';
import { useWorkflowInput } from '../components/useWorkflowInput';
import { nextAction, STEPS, stepDone } from '../lib/workflow';

function FmuCard({ fmu }: { fmu: FmuSummary }) {
  const input = useWorkflowInput(fmu.id);
  const next = input ? nextAction(input) : undefined;
  const nextPath = next ? STEPS.find(s => s.key === next.step)!.path : '';
  return (
    <Card withBorder data-testid={`fmu-card-${fmu.id}`}>
      <Stack gap="xs">
        <Anchor component={Link} to={`/fmus/${fmu.id}`} fw={600}>{fmu.modelName}</Anchor>
        <Group gap={4} aria-label="단계 진행">
          {STEPS.map(s => (
            <Badge
              key={s.key} size="xs" circle variant={input && stepDone(s.key, input) ? 'filled' : 'outline'}
              title={s.label}
            />
          ))}
        </Group>
        <Group gap={6}>
          <Text className="fmuc-num" size="lg">{fmu.nRuns.toLocaleString()}</Text>
          <Text size="xs" c="dimmed">run</Text>
        </Group>
        {next && (
          <Anchor component={Link} to={`/fmus/${fmu.id}/${nextPath}`} size="sm">{next.label}</Anchor>
        )}
      </Stack>
    </Card>
  );
}

function JobRow({ job }: { job: Job }) {
  const pct = job.total > 0 ? Math.round((job.completed / job.total) * 100) : 0;
  return (
    <Stack gap={2}>
      <Group justify="space-between" wrap="nowrap">
        <Anchor component={Link} to={`/jobs/${job.id}`} size="sm" truncate>{job.name}</Anchor>
        <Badge size="xs" variant="light">{job.status}</Badge>
      </Group>
      <Group gap="xs" wrap="nowrap">
        <Progress value={pct} flex={1} size="sm" />
        <Text size="xs" className="fmuc-num">{pct}%</Text>
      </Group>
    </Stack>
  );
}

function StartGuide() {
  return (
    <Card withBorder>
      <Stack gap="sm">
        <Title order={3}>시작하기</Title>
        <Stack gap={4}>
          {STEPS.map(s => <Checkbox key={s.key} readOnly checked={false} label={s.label} />)}
        </Stack>
        <FmuUpload />
      </Stack>
    </Card>
  );
}

export function HomePage() {
  const api = useApi();
  const fmus = useQuery({ queryKey: ['fmus'], queryFn: () => api.listFmus() });
  const jobs = useQuery({ queryKey: ['jobs'], queryFn: () => api.listJobs(), refetchInterval: 3000 });
  if (fmus.isError) return <Alert color="red">{fmus.error.message}</Alert>;
  if (!fmus.data) return <Loader size="sm" />;
  const recent = (jobs.data ?? []).slice(0, 5);
  return (
    <Stack>
      <Text className="fmuc-label">WORKSPACE</Text>
      {fmus.data.length === 0 ? <StartGuide /> : (
        <Grid>
          <Grid.Col span={{ base: 12, md: 8 }}>
            <Stack>
              <Grid>
                {fmus.data.map(f => (
                  <Grid.Col key={f.id} span={{ base: 12, sm: 6 }}><FmuCard fmu={f} /></Grid.Col>
                ))}
              </Grid>
              <FmuUpload />
            </Stack>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Card withBorder>
              <Stack gap="sm">
                <Text className="fmuc-label">실행 중 / 최근 잡</Text>
                {recent.length === 0 && <Text size="sm" c="dimmed">잡이 없습니다</Text>}
                {recent.map(j => <JobRow key={j.id} job={j} />)}
              </Stack>
            </Card>
          </Grid.Col>
        </Grid>
      )}
    </Stack>
  );
}
