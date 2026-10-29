import { AppShell, Badge, Group, NavLink, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { Navigate, NavLink as RouterNavLink, Outlet, Route, Routes } from 'react-router-dom';
import { useApi } from './api/client';
import { BatchSetupPage } from './pages/BatchSetupPage';
import { FmuDetailPage } from './pages/FmuDetailPage';
import { FmuListPage } from './pages/FmuListPage';
import { JobListPage } from './pages/JobListPage';
import { JobMonitorPage } from './pages/JobMonitorPage';
import { ObjectiveEditorPage } from './pages/ObjectiveEditorPage';
import { OptimizationSetupPage } from './pages/OptimizationSetupPage';
import { PresetsPage } from './pages/PresetsPage';
import { ResultsPage } from './pages/ResultsPage';

const NAV = [
  { to: '/fmus', label: 'FMU' },
  { to: '/objectives', label: '목적함수' },
  { to: '/presets', label: '프리셋' },
  { to: '/jobs', label: '잡' },
];

function Layout() {
  const api = useApi();
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.health() });
  return (
    <AppShell header={{ height: 52 }} navbar={{ width: 180, breakpoint: 'sm' }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Title order={4}>FMU Controller</Title>
          {health.data && <Badge variant="light">병렬: {health.data.parallelBackend}</Badge>}
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs">
        {NAV.map(n => (
          <NavLink key={n.to} component={RouterNavLink} to={n.to} label={n.label} />
        ))}
      </AppShell.Navbar>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/fmus" replace />} />
        <Route path="/fmus" element={<FmuListPage />} />
        <Route path="/fmus/:fmuId" element={<FmuDetailPage />} />
        <Route path="/fmus/:fmuId/batch" element={<BatchSetupPage />} />
        <Route path="/fmus/:fmuId/optimize" element={<OptimizationSetupPage />} />
        <Route path="/fmus/:fmuId/results" element={<ResultsPage />} />
        <Route path="/objectives" element={<ObjectiveEditorPage />} />
        <Route path="/objectives/:objectiveId" element={<ObjectiveEditorPage />} />
        <Route path="/presets" element={<PresetsPage />} />
        <Route path="/jobs" element={<JobListPage />} />
        <Route path="/jobs/:jobId" element={<JobMonitorPage />} />
      </Route>
    </Routes>
  );
}
