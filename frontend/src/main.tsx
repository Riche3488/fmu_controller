import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import '@mantine/core/styles.css';
import '@mantine/dropzone/styles.css';
import '@mantine/notifications/styles.css';
import { ApiProvider } from './api/client';
import { createClient } from './api/select';
import { AppRoutes } from './App';
import { cssVariablesResolver, registerEchartsThemes, theme } from './theme';

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });
const api = createClient();
registerEchartsThemes();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} defaultColorScheme="dark">
      <Notifications />
      <QueryClientProvider client={queryClient}>
        <ApiProvider client={api}>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </ApiProvider>
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>,
);
