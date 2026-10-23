import type { PageRequest, Paginated } from '../../../shared/domain/pagination.js';
import type { Tenant } from './tenant.js';
import type { TenantStatus } from './tenant-status.js';

export interface TenantSearchCriteria {
  /** Matches slug, name or director e-mail. */
  search?: string;
  status?: TenantStatus;
  /** Logically deleted schools are hidden unless requested. */
  includeDeleted?: boolean;
}

/** Output port over the `tenants` table of the master database. */
export interface MasterTenantRepository {
  findById(id: number): Promise<Tenant | null>;
  /** Includes logically deleted tenants (their slug stays reserved). */
  findBySlug(slug: string): Promise<Tenant | null>;
  search(criteria: TenantSearchCriteria, page: PageRequest): Promise<Paginated<Tenant>>;
  /** Inserts or updates; assigns the id to new tenants. Throws `ConflictError` on duplicated slug. */
  save(tenant: Tenant): Promise<void>;
}

export const MASTER_TENANT_REPOSITORY = Symbol('MasterTenantRepository');
