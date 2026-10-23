import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ENVIRONMENT, type Environment } from '../../../../shared/infrastructure/config/environment.js';
import type { TenantCacheInvalidatorPort } from '../../application/ports/tenant-cache-invalidator.port.js';

/** Header expected by `apreu-api` (`InternalTokenGuard`). */
export const INTERNAL_TOKEN_HEADER = 'X-Internal-Token';

/** Minimal `fetch` signature, injectable for tests. */
export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

/** Optional provider overriding the global `fetch` (tests). */
export const HTTP_FETCH = Symbol('HttpFetch');

/**
 * Calls `POST {APREU_API_URL}/api/internal/tenants/{slug}/invalidate` with the
 * shared `X-Internal-Token`. Disabled (no-op) when the URL or the token is not
 * configured. Network errors, timeouts and non-2xx answers only log a warning:
 * the superadmin operation already succeeded and must not fail because the ERP
 * is unreachable.
 */
@Injectable()
export class HttpTenantCacheInvalidator implements TenantCacheInvalidatorPort {
  private readonly logger = new Logger(HttpTenantCacheInvalidator.name);
  private readonly fetchFn: FetchFn;

  constructor(
    @Inject(ENVIRONMENT) private readonly env: Environment,
    @Optional() @Inject(HTTP_FETCH) fetchFn?: FetchFn,
  ) {
    this.fetchFn = fetchFn ?? ((input, init) => fetch(input, init));
  }

  async invalidate(slug: string): Promise<void> {
    const { baseUrl, internalToken, timeoutMs } = this.env.apreuApi;
    if (!baseUrl || !internalToken) return;

    const url = `${baseUrl}/api/internal/tenants/${encodeURIComponent(slug)}/invalidate`;
    try {
      const response = await this.fetchFn(url, {
        method: 'POST',
        headers: { [INTERNAL_TOKEN_HEADER]: internalToken },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        this.logger.warn(`apreu-api no invalidó la caché del colegio "${slug}": HTTP ${response.status}.`);
      }
    } catch (error) {
      const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      this.logger.warn(`No se pudo invalidar la caché del colegio "${slug}" en apreu-api (${reason}).`);
    }
  }
}
