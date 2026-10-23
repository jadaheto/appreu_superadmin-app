/** Lifecycle status stored in `tenants.status` (shared with `apreu-api`, which blocks `suspended`). */
export type TenantStatus = 'active' | 'suspended' | 'trial';

export const TENANT_STATUSES: readonly TenantStatus[] = ['active', 'suspended', 'trial'];

/** Statuses whose school is in use and therefore counted in the platform KPIs. */
export const OPERATIONAL_STATUSES: readonly TenantStatus[] = ['active', 'trial'];
