/** Summary of a school as seen by the analytics context (read from the master database). */
export interface CatalogTenant {
  id: number;
  slug: string;
  name: string;
  adminEmail: string | null;
  adminPhone: string | null;
  status: 'active' | 'suspended' | 'trial';
  tablesCreated: boolean;
  databaseName: string;
  trialEndsAt: string | null;
  publicUrl: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  deletedAt: Date | null;
  isDeleted: boolean;
}

export interface TenantCounts {
  /** Registered schools, excluding logically deleted ones. */
  total: number;
  active: number;
  suspended: number;
  trial: number;
  deleted: number;
  /** Non-deleted schools with their database installed. */
  databasesInstalled: number;
}

/** Read-only port over the master `tenants` registry. */
export interface TenantCatalogPort {
  counts(): Promise<TenantCounts>;
  /** Creation instants of non-deleted schools registered since `since`. */
  createdSince(since: Date): Promise<Date[]>;
  recent(limit: number): Promise<CatalogTenant[]>;
  /** Non-deleted schools in `active`/`trial` with their database installed. */
  operational(): Promise<CatalogTenant[]>;
  findById(id: number): Promise<CatalogTenant | null>;
}

export const TENANT_CATALOG = Symbol('TenantCatalogPort');
