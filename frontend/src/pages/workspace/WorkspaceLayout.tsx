import { Button, Group, Stack } from '@mantine/core';
import { Link, Outlet, useLocation, useParams } from 'react-router-dom';
import { useWorkflowInput } from '../../components/useWorkflowInput';
import { STEPS } from '../../lib/workflow';
import { StepBar, currentStep } from './StepBar';

export function WorkspaceLayout() {
  const { fmuId = '' } = useParams();
  const { pathname } = useLocation();
  const input = useWorkflowInput(fmuId);
  const idx = STEPS.findIndex(s => s.key === currentStep(pathname, fmuId));
  const next = STEPS[idx + 1];
  return (
    <Stack>
      <StepBar fmuId={fmuId} input={input} />
      <Outlet />
      {next && (
        <Group justify="flex-end">
          <Button component={Link} to={`/fmus/${fmuId}/${next.path}`} variant="light">다음: {next.label}</Button>
        </Group>
      )}
    </Stack>
  );
}
