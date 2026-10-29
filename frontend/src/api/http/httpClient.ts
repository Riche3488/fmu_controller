import { ApiError, type ApiClient } from '../client';
import type { JobEvent } from '../types';

type Query = Record<string, string | number | boolean | string[] | undefined | null>;

function qs(q: Query): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      if (v.length) p.set(k, v.join(','));
    } else {
      p.set(k, String(v));
    }
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

function detailMessage(detail: unknown, fallback: string): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail.map((d: { msg?: string; loc?: unknown[] }) => (d.loc ? `${d.loc.join('.')}: ${d.msg}` : String(d.msg))).join('; ');
  }
  return fallback;
}

export function createHttpClient(baseUrl = '/api'): ApiClient {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const init: RequestInit = { method, headers: {} };
    if (body instanceof FormData) {
      init.body = body;
    } else if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers = { 'Content-Type': 'application/json' };
    }
    const res = await fetch(`${baseUrl}${path}`, init);
    if (!res.ok) {
      let detail: unknown = null;
      try {
        detail = (await res.json()).detail;
      } catch {
        // 본문 없음
      }
      throw new ApiError(detailMessage(detail, `${res.status} ${res.statusText}`), res.status);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
  const get = <T>(path: string) => request<T>('GET', path);

  return {
    health: () => get('/health'),

    listFmus: () => get('/fmus'),
    uploadFmu: file => {
      const form = new FormData();
      form.append('file', file);
      return request('POST', '/fmus', form);
    },
    getFmu: id => get(`/fmus/${id}`),
    deleteFmu: id => request('DELETE', `/fmus/${id}`),
    listVariables: (fmuId, q) => get(`/fmus/${fmuId}/variables${qs(q)}`),

    listResources: fmuId => get(`/fmus/${fmuId}/resources`),
    uploadCandidate: (fmuId, path, file) => {
      const form = new FormData();
      form.append('path', path);
      form.append('file', file);
      return request('POST', `/fmus/${fmuId}/resources/candidates`, form);
    },
    deleteCandidate: (fmuId, candidateId) => request('DELETE', `/fmus/${fmuId}/resources/candidates/${candidateId}`),
    previewCandidate: (fmuId, candidateId, varName) =>
      get(`/fmus/${fmuId}/resources/candidates/${candidateId}/preview${qs({ var: varName })}`),
    listVariants: fmuId => get(`/fmus/${fmuId}/variants`),

    listObjectives: () => get('/objectives'),
    getObjective: id => get(`/objectives/${id}`),
    createObjective: input => request('POST', '/objectives', input),
    updateObjective: (id, input) => request('PUT', `/objectives/${id}`, input),
    deleteObjective: id => request('DELETE', `/objectives/${id}`),
    testObjective: req => request('POST', '/objectives/test', req),

    createBatch: req => request('POST', '/jobs/batch', req),
    createOptimization: req => request('POST', '/jobs/optimization', req),
    listJobs: (q = {}) => get(`/jobs${qs(q)}`),
    getJob: id => get(`/jobs/${id}`),
    cancelJob: id => request('POST', `/jobs/${id}/cancel`),
    subscribeJob(id, onEvent) {
      const es = new EventSource(`${baseUrl}/jobs/${id}/events`);
      const handle = (e: MessageEvent) => onEvent(JSON.parse(e.data) as JobEvent);
      for (const t of ['progress', 'run', 'end']) es.addEventListener(t, handle as EventListener);
      es.addEventListener('end', () => es.close());
      return () => es.close();
    },

    listPresets: (q = {}) => get(`/presets${qs(q)}`),
    createPreset: input => request('POST', '/presets', input),
    updatePreset: (id, input) => request('PUT', `/presets/${id}`, input),
    deletePreset: id => request('DELETE', `/presets/${id}`),

    listRuns: q => get(`/runs${qs(q)}`),
    getTimeseries: (runId, vars, maxPoints = 2000) => get(`/runs/${runId}/timeseries${qs({ vars, maxPoints })}`),
  };
}
