import type { Environment } from '../../../../shared/infrastructure/config/environment.js';
import { type FetchFn, HttpTenantCacheInvalidator } from './http-tenant-cache-invalidator.js';

const envWith = (apreuApi: Partial<Environment['apreuApi']>): Environment =>
  ({
    apreuApi: {
      baseUrl: 'http://apreu-api:3000',
      internalToken: 'tok',
      timeoutMs: 50,
      ...apreuApi,
    },
  }) as Environment;

describe('HttpTenantCacheInvalidator', () => {
  it('posts to the internal endpoint with the shared token and a timeout', async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue(new Response(null, { status: 204 }));
    await new HttpTenantCacheInvalidator(envWith({}), fetchFn).invalidate('colegio norte');

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('http://apreu-api:3000/api/internal/tenants/colegio%20norte/invalidate');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'X-Internal-Token': 'tok' },
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([{ baseUrl: null }, { internalToken: null }])('is a no-op when disabled (%o)', async (config) => {
    const fetchFn = vi.fn<FetchFn>();
    await new HttpTenantCacheInvalidator(envWith(config), fetchFn).invalidate('norte');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('never rejects on non-2xx answers, network errors or timeouts', async () => {
    const answers: FetchFn[] = [
      async () => new Response(null, { status: 403 }),
      async () => {
        throw new TypeError('fetch failed');
      },
      (_url, init) =>
        new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason))),
    ];
    for (const answer of answers) {
      await expect(
        new HttpTenantCacheInvalidator(envWith({ timeoutMs: 5 }), answer).invalidate('norte'),
      ).resolves.toBeUndefined();
    }
  });
});
