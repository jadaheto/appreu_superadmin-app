import type { TenantCacheInvalidatorPort } from '../application/ports/tenant-cache-invalidator.port.js';

/** Records the slugs whose ERP cache was invalidated. */
export class RecordingTenantCacheInvalidator implements TenantCacheInvalidatorPort {
  readonly slugs: string[] = [];

  async invalidate(slug: string): Promise<void> {
    this.slugs.push(slug);
  }
}
