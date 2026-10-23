import type { Tenant } from '../domain/tenant.js';
import type { TenantStatus } from '../domain/tenant-status.js';
import type { TenantNamingPort } from './ports/tenant-naming.port.js';

/** Read model of a school returned to the HTTP layer. */
export interface TenantView {
  id: number;
  slug: string;
  name: string;
  adminEmail: string | null;
  adminPhone: string | null;
  status: TenantStatus;
  tablesCreated: boolean;
  databaseName: string;
  trialEndsAt: string | null;
  publicUrl: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  deletedAt: Date | null;
  isDeleted: boolean;
}

export const toTenantView = (tenant: Tenant, naming: TenantNamingPort): TenantView => ({
  id: tenant.id as number,
  slug: tenant.slug.toString(),
  name: tenant.name,
  adminEmail: tenant.adminEmail?.toString() ?? null,
  adminPhone: tenant.adminPhone,
  status: tenant.status,
  tablesCreated: tenant.tablesCreated,
  databaseName: tenant.databaseName,
  trialEndsAt: tenant.trialEndsAt,
  publicUrl: naming.publicUrlFor(tenant.slug.toString()),
  createdAt: tenant.createdAt,
  updatedAt: tenant.updatedAt,
  deletedAt: tenant.deletedAt,
  isDeleted: tenant.isDeleted,
});
