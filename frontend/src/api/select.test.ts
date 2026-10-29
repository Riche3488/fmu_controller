import { describe, expect, test, vi } from 'vitest';
import { composeClient } from './select';
import { createMockClient } from './mock/mockClient';
import type { ApiClient } from './client';

describe('composeClient', () => {
  test('routes each domain to its chosen implementation', async () => {
    const mock = createMockClient();
    const http = { ...createMockClient(), listFmus: vi.fn(async () => []), listRuns: vi.fn() } as unknown as ApiClient;
    const c = composeClient({ FMUS: 'http' }, { mock, http });
    await c.listFmus();
    expect(http.listFmus).toHaveBeenCalled();
    expect((await c.listObjectives())).toEqual([]);
    expect(http.listRuns).not.toHaveBeenCalled();
  });

  test('http mode without http client throws', () => {
    expect(() => composeClient({ JOBS: 'http' }, { mock: createMockClient() })).toThrow('VITE_API_JOBS=http');
  });
});
