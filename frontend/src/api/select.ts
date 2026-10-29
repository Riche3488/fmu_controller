// 도메인별 mock/http 선택. VITE_API_<DOMAIN>=mock|http (기본 http, UI 단독 개발 시 mock)
import type { ApiClient } from './client';
import { createHttpClient } from './http/httpClient';
import { createMockClient } from './mock/mockClient';

export type Domain = 'FMUS' | 'RESOURCES' | 'OBJECTIVES' | 'JOBS' | 'PRESETS' | 'RUNS';

type Method = keyof ApiClient;

const DOMAIN_METHODS: Record<Domain, Method[]> = {
  FMUS: ['health', 'listFmus', 'uploadFmu', 'getFmu', 'deleteFmu', 'listVariables'],
  RESOURCES: ['listResources', 'uploadCandidate', 'deleteCandidate', 'previewCandidate', 'listVariants'],
  OBJECTIVES: ['listObjectives', 'getObjective', 'createObjective', 'updateObjective', 'deleteObjective', 'testObjective'],
  JOBS: ['createBatch', 'createOptimization', 'listJobs', 'getJob', 'cancelJob', 'subscribeJob'],
  PRESETS: ['listPresets', 'createPreset', 'updatePreset', 'deletePreset'],
  RUNS: ['listRuns', 'getTimeseries'],
};

export function composeClient(
  modes: Partial<Record<Domain, 'mock' | 'http'>>,
  impls: { mock: ApiClient; http?: ApiClient },
): ApiClient {
  const out: Partial<Record<Method, unknown>> = {};
  for (const [domain, methods] of Object.entries(DOMAIN_METHODS) as [Domain, Method[]][]) {
    const mode = modes[domain] ?? 'http';
    const impl = mode === 'http' ? impls.http : impls.mock;
    if (!impl) throw new Error(`VITE_API_${domain}=http 이지만 http 클라이언트가 없습니다`);
    for (const m of methods) out[m] = (impl[m] as (...a: unknown[]) => unknown).bind(impl);
  }
  return out as ApiClient;
}

export function createClient(): ApiClient {
  const env = import.meta.env;
  const modes = Object.fromEntries(
    (Object.keys(DOMAIN_METHODS) as Domain[]).map(d => [d, env[`VITE_API_${d}`] === 'mock' ? 'mock' : 'http']),
  ) as Record<Domain, 'mock' | 'http'>;
  return composeClient(modes, { mock: createMockClient(), http: createHttpClient() });
}
