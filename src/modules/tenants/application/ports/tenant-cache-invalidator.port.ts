/**
 * Outbound port that tells the school ERP (`apreu-api`) to drop its cached
 * copy of a school after its registry row changed (suspension, reactivation,
 * trial, logical deletion or contact edits), so the change applies at once
 * instead of after the ERP cache TTL.
 *
 * Contract: best effort. Implementations **never reject**; a failure is logged
 * and the ERP still converges within its `TENANT_STATUS_TTL_SECONDS`.
 */
export interface TenantCacheInvalidatorPort {
  invalidate(slug: string): Promise<void>;
}

export const TENANT_CACHE_INVALIDATOR = Symbol('TenantCacheInvalidatorPort');
