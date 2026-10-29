import { afterEach, describe, expect, test, vi } from 'vitest';
import { ApiError } from '../client';
import { createHttpClient } from './httpClient';

function mockFetch(body: unknown, status = 200) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('httpClient', () => {
  test('listVariables builds query string', async () => {
    const fetchFn = mockFetch({ total: 0, items: [] });
    await createHttpClient().listVariables('x', { q: 'a', offset: 0, limit: 100 });
    expect(fetchFn).toHaveBeenCalledWith('/api/fmus/x/variables?q=a&offset=0&limit=100', expect.anything());
  });

  test('listRuns joins list params with commas', async () => {
    const fetchFn = mockFetch({ total: 0, items: [], codeHashes: {} });
    await createHttpClient().listRuns({ jobIds: ['a', 'b'], objectiveIds: ['o'] });
    expect(fetchFn).toHaveBeenCalledWith('/api/runs?jobIds=a%2Cb&objectiveIds=o', expect.anything());
  });

  test('getTimeseries passes vars and maxPoints', async () => {
    const fetchFn = mockFetch({ time: [], series: {} });
    await createHttpClient().getTimeseries('r1', ['v1', 'v2'], 500);
    expect(fetchFn).toHaveBeenCalledWith('/api/runs/r1/timeseries?vars=v1%2Cv2&maxPoints=500', expect.anything());
  });

  test('JSON body for POST', async () => {
    const fetchFn = mockFetch({ id: 'o1' });
    await createHttpClient().createObjective({ name: 'n', code: 'c' });
    expect(fetchFn).toHaveBeenCalledWith('/api/objectives', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ name: 'n', code: 'c' }),
    }));
  });

  test('non-2xx throws ApiError with server detail', async () => {
    mockFetch({ detail: '같은 이름의 목적함수가 이미 있습니다' }, 409);
    const err = await createHttpClient().createObjective({ name: 'n', code: 'c' }).catch(e => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe('같은 이름의 목적함수가 이미 있습니다');
    expect(err.status).toBe(409);
  });

  test('validation error detail list is joined', async () => {
    mockFetch({ detail: [{ msg: 'field required', loc: ['body', 'name'] }] }, 422);
    const err = await createHttpClient().createObjective({ name: '', code: 'c' }).catch(e => e);
    expect(err.message).toBe('body.name: field required');
  });

  test('delete returns undefined on 204', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    await expect(createHttpClient().deleteObjective('o1')).resolves.toBeUndefined();
  });

  test('uploadFmu sends multipart form', async () => {
    const fetchFn = mockFetch({ id: 'f' });
    const file = new File(['x'], 'a.fmu');
    await createHttpClient().uploadFmu(file);
    const init = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.method).toBe('POST');
    expect((init.body as FormData).get('file')).toBeInstanceOf(File);
  });

  test('uploadCandidate posts path and file as multipart', async () => {
    const fetchFn = mockFetch({ id: 'c1', existing: false });
    await createHttpClient().uploadCandidate('x', 'sub/a.mat', new File(['1'], 'a.mat'));
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/fmus/x/resources/candidates');
    expect(init.method).toBe('POST');
    expect((init.body as FormData).get('path')).toBe('sub/a.mat');
    expect((init.body as FormData).get('file')).toBeInstanceOf(File);
  });

  test('resource and variant endpoints', async () => {
    const fetchFn = mockFetch([]);
    const c = createHttpClient();
    await c.listResources('x');
    await c.listVariants('x');
    await c.previewCandidate('x', 'c1', 'table');
    await c.listRuns({ variantIds: ['a', 'b'] });
    expect(fetchFn.mock.calls.map(c => (c as unknown as [string])[0])).toEqual([
      '/api/fmus/x/resources', '/api/fmus/x/variants', '/api/fmus/x/resources/candidates/c1/preview?var=table',
      '/api/runs?variantIds=a%2Cb',
    ]);
  });
});

