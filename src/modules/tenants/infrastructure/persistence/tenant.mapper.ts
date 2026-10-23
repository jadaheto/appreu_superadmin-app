import { Email } from '../../../../shared/domain/value-objects/email.vo.js';
import { Tenant } from '../../domain/tenant.js';
import { TenantSlug } from '../../domain/tenant-slug.vo.js';
import { TenantOrmEntity } from './tenant.orm-entity.js';

/** Legacy rows may hold e-mails that no longer pass validation; they are shown as absent rather than crashing. */
const safeEmail = (raw: string | null): Email | null => {
  if (!raw) return null;
  try {
    return Email.create(raw);
  } catch {
    return null;
  }
};

const toDateString = (value: unknown): string | null => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
};

export const TenantMapper = {
  /** `defaultDatabaseName` resolves legacy rows without `db_name` (`apreu_<slug>`). */
  toDomain(row: TenantOrmEntity, defaultDatabaseName: (slug: string) => string): Tenant {
    return Tenant.restore(row.id, {
      slug: TenantSlug.restore(row.slug),
      name: row.name,
      adminEmail: safeEmail(row.adminEmail),
      adminPhone: row.adminPhone,
      status: row.status,
      tablesCreated: row.tablesCreated === true,
      databaseName: row.dbName ?? defaultDatabaseName(row.slug),
      trialEndsAt: toDateString(row.trialEndsAt),
      createdAt: row.createdAt ?? null,
      updatedAt: row.updatedAt ?? null,
      deletedAt: row.deletedAt ?? null,
    });
  },

  toOrm(tenant: Tenant): TenantOrmEntity {
    const row = new TenantOrmEntity();
    if (tenant.id !== null) row.id = tenant.id;
    row.slug = tenant.slug.toString();
    row.name = tenant.name;
    row.adminEmail = tenant.adminEmail?.toString() ?? null;
    row.adminPhone = tenant.adminPhone;
    row.status = tenant.status;
    row.tablesCreated = tenant.tablesCreated;
    row.dbName = tenant.databaseName;
    row.trialEndsAt = tenant.trialEndsAt;
    row.deletedAt = tenant.deletedAt;
    return row;
  },
};
