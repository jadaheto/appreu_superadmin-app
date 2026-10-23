import { Inject, Injectable } from '@nestjs/common';
import { ENVIRONMENT, type Environment } from '../../../../shared/infrastructure/config/environment.js';
import { MasterDatabase } from '../../../../shared/infrastructure/persistence/master-database.js';
import type { CatalogTenant, TenantCatalogPort, TenantCounts } from '../../application/ports/tenant-catalog.port.js';

interface TenantRow {
  id: number | string;
  slug: string;
  name: string;
  admin_email: string | null;
  admin_phone: string | null;
  status: CatalogTenant['status'];
  tables_created: boolean;
  db_name: string | null;
  trial_ends_at: string | Date | null;
  created_at: Date | null;
  updated_at: Date | null;
  deleted_at: Date | null;
}

const COLUMNS =
  'id, slug, name, admin_email, admin_phone, status, tables_created, db_name, trial_ends_at, created_at, updated_at, deleted_at';

/**
 * Read-only SQL adapter of {@link TenantCatalogPort} over the master
 * `tenants` table (own read model: no classes of the tenants context are
 * imported, per the backend guide).
 */
@Injectable()
export class SqlTenantCatalog implements TenantCatalogPort {
  constructor(
    private readonly db: MasterDatabase,
    @Inject(ENVIRONMENT) private readonly env: Environment,
  ) {}

  async counts(): Promise<TenantCounts> {
    const [row] = await this.db.query<Record<string, string | number | null>>(
      `SELECT
         COUNT(*) FILTER (WHERE deleted_at IS NULL)::int AS total,
         COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'active')::int AS active,
         COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'suspended')::int AS suspended,
         COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'trial')::int AS trial,
         COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS deleted,
         COUNT(*) FILTER (WHERE deleted_at IS NULL AND tables_created)::int AS databases_installed
       FROM tenants`,
    );
    const n = (key: string) => Number(row?.[key] ?? 0);
    return {
      total: n('total'),
      active: n('active'),
      suspended: n('suspended'),
      trial: n('trial'),
      deleted: n('deleted'),
      databasesInstalled: n('databases_installed'),
    };
  }

  async createdSince(since: Date): Promise<Date[]> {
    const rows = await this.db.query<{ created_at: Date }>(
      'SELECT created_at FROM tenants WHERE deleted_at IS NULL AND created_at >= $1',
      [since],
    );
    return rows.map((row) => new Date(row.created_at));
  }

  async recent(limit: number): Promise<CatalogTenant[]> {
    const rows = await this.db.query<TenantRow>(
      `SELECT ${COLUMNS} FROM tenants WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT $1`,
      [limit],
    );
    return rows.map((row) => this.toTenant(row));
  }

  async operational(): Promise<CatalogTenant[]> {
    const rows = await this.db.query<TenantRow>(
      `SELECT ${COLUMNS} FROM tenants
       WHERE deleted_at IS NULL AND tables_created AND status IN ('active', 'trial')
       ORDER BY name`,
    );
    return rows.map((row) => this.toTenant(row));
  }

  async findById(id: number): Promise<CatalogTenant | null> {
    const [row] = await this.db.query<TenantRow>(`SELECT ${COLUMNS} FROM tenants WHERE id = $1 LIMIT 1`, [id]);
    return row ? this.toTenant(row) : null;
  }

  /** Visible for tests. */
  toTenant(row: TenantRow): CatalogTenant {
    const { databasePrefix } = this.env.tenantDb;
    const trialEndsAt =
      row.trial_ends_at instanceof Date
        ? row.trial_ends_at.toISOString().slice(0, 10)
        : (row.trial_ends_at?.slice(0, 10) ?? null);
    return {
      id: Number(row.id),
      slug: row.slug,
      name: row.name,
      adminEmail: row.admin_email,
      adminPhone: row.admin_phone,
      status: row.status,
      tablesCreated: row.tables_created === true,
      databaseName: row.db_name ?? `${databasePrefix}${row.slug.replace(/-/g, '_')}`,
      trialEndsAt,
      publicUrl: this.env.provisioning.publicUrlTemplate.replaceAll('{slug}', encodeURIComponent(row.slug)),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
      isDeleted: row.deleted_at !== null,
    };
  }
}
