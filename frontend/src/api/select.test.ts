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
    const modes = { FMUS: 'mock', OBJECTIVES: 'mock', RUNS: 'mock', JOBS: 'http' } as const;
    expect(() => composeClient(modes, { mock: createMockClient() })).toThrow('VITE_API_JOBS=http');
  });

  test('defaults to http when a domain is not specified', async () => {
    const http = { ...createMockClient(), listJobs: vi.fn(async () => []) } as unknown as ApiClient;
    await composeClient({}, { mock: createMockClient(), http }).listJobs();
    expect(http.listJobs).toHaveBeenCalled();
  });
});
