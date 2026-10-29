import { AppShell, Badge, Group, NavLink, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { Navigate, NavLink as RouterNavLink, Outlet, Route, Routes, useLocation, useMatch } from 'react-router-dom';
import { useApi } from './api/client';
import { ColorSchemeToggle } from './components/ColorSchemeToggle';
import { FmuListPage } from './pages/FmuListPage';
import { JobListPage } from './pages/JobListPage';
import { JobMonitorPage } from './pages/JobMonitorPage';
import { ObjectiveEditorPage } from './pages/ObjectiveEditorPage';
import { PresetsPage } from './pages/PresetsPage';
import { ModelStep } from './pages/workspace/ModelStep';
import { ObjectivesStep } from './pages/workspace/ObjectivesStep';
import { ResourcesStep } from './pages/workspace/ResourcesStep';
import { ResultsStep } from './pages/workspace/ResultsStep';
import { RunStep } from './pages/workspace/RunStep';
import { WorkspaceLayout } from './pages/workspace/WorkspaceLayout';

const COMMON = [
  { to: '/objectives', label: '목적함수 라이브러리' },
  { to: '/presets', label: '프리셋' },
  { to: '/jobs', label: '잡 전체' },
];

function Layout() {
  const api = useApi();
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.health() });
  const fmus = useQuery({ queryKey: ['fmus'], queryFn: () => api.listFmus() });
  const current = useMatch('/fmus/:fmuId/*')?.params.fmuId;
  return (
    <AppShell header={{ height: 52 }} navbar={{ width: 220, breakpoint: 'sm' }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Title order={4}>FMU Controller</Title>
          <Group gap="sm">
            {health.data && <Badge variant="light">병렬: {health.data.parallelBackend}</Badge>}
            <ColorSchemeToggle />
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs">
        <NavLink component={RouterNavLink} to="/fmus" end label="홈" />
        <Text size="xs" c="dimmed" fw={700} mt="sm" px="xs">FMU</Text>
        {(fmus.data ?? []).map(f => (
          <NavLink
            key={f.id} component={RouterNavLink} to={`/fmus/${f.id}`} label={f.modelName}
            active={f.id === current}
          />
        ))}
        <Text size="xs" c="dimmed" fw={700} mt="sm" px="xs">공용</Text>
        {COMMON.map(n => (
          <NavLink key={n.to} component={RouterNavLink} to={n.to} end label={n.label} />
        ))}
      </AppShell.Navbar>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}

// 옛 주소 리다이렉트. ?preset=, ?fromJob= 과 location state를 유지한다.
function RunRedirect({ tab }: { tab: 'batch' | 'optimize' }) {
  const { state, search } = useLocation();
  const params = new URLSearchParams(search);
  params.set('tab', tab);
  return <Navigate to={`../run?${params}`} replace state={state} />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/fmus" replace />} />
        <Route path="/fmus" element={<FmuListPage />} />
        <Route path="/fmus/:fmuId" element={<WorkspaceLayout />}>
          <Route index element={<ModelStep />} />
          <Route path="resources" element={<ResourcesStep />} />
          <Route path="objectives" element={<ObjectivesStep />} />
          <Route path="objectives/new" element={<ObjectivesStep />} />
          <Route path="objectives/:objectiveId" element={<ObjectivesStep />} />
          <Route path="run" element={<RunStep />} />
          <Route path="results" element={<ResultsStep />} />
          <Route path="batch" element={<RunRedirect tab="batch" />} />
          <Route path="optimize" element={<RunRedirect tab="optimize" />} />
        </Route>
        <Route path="/objectives" element={<ObjectiveEditorPage />} />
        <Route path="/objectives/:objectiveId" element={<ObjectiveEditorPage />} />
        <Route path="/presets" element={<PresetsPage />} />
        <Route path="/jobs" element={<JobListPage />} />
        <Route path="/jobs/:jobId" element={<JobMonitorPage />} />
      </Route>
    </Routes>
  );
}
