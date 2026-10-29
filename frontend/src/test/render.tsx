import { render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ApiProvider, type ApiClient } from '../api/client';
import { createMockClient } from '../api/mock/mockClient';
import { AppRoutes } from '../App';
import { theme } from '../theme';

export function Providers({ client, route, children }: { client: ApiClient; route: string; children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return (
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <QueryClientProvider client={qc}>
        <ApiProvider client={client}>
          <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
        </ApiProvider>
      </QueryClientProvider>
    </MantineProvider>
  );
}

/** 전체 앱을 mock client로 렌더. client를 넘기면 그것을 사용. */
export function renderApp({ route = '/', client = createMockClient({ tickMs: 10 }) }: { route?: string; client?: ApiClient } = {}) {
  const result = render(<Providers client={client} route={route}><AppRoutes /></Providers>);
  return { ...result, client };
}

/** 단일 요소를 Provider로 감싸 렌더 (라우트 파라미터 필요 없을 때). */
export function renderWith(ui: ReactNode, { route = '/', client = createMockClient({ tickMs: 10 }) }: { route?: string; client?: ApiClient } = {}) {
  const result = render(<Providers client={client} route={route}>{ui}</Providers>);
  return { ...result, client };
}
