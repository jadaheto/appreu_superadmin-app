import { loadEnvironment } from '../../../../shared/infrastructure/config/environment.js';
import type { MasterDatabase } from '../../../../shared/infrastructure/persistence/master-database.js';
import { SqlTenantCatalog } from './sql-tenant-catalog.js';

const env = loadEnvironment({
  SUPERADMIN_JWT_SECRET: 's',
  MASTER_DB_HOST: 'm',
  MASTER_DB_USER: 'u',
  MASTER_DB_NAME: 'master',
  TENANT_DB_HOST: 't',
  TENANT_DB_ADMIN_USER: 'prov',
  TENANT_PUBLIC_URL_TEMPLATE: 'https://{slug}.apreu.co',
});

describe('SqlTenantCatalog', () => {
  const query = vi.fn();
  const catalog = new SqlTenantCatalog({ query } as unknown as MasterDatabase, env);

  beforeEach(() => query.mockReset());

  it('maps counters (deleted schools apart)', async () => {
    query.mockResolvedValue([{ total: 3, active: 1, suspended: 1, trial: 1, deleted: 2, databases_installed: 3 }]);
    await expect(catalog.counts()).resolves.toEqual({
      total: 3,
      active: 1,
      suspended: 1,
      trial: 1,
      deleted: 2,
      databasesInstalled: 3,
    });
  });

  it('counts with FILTER and int casts (pg returns bigint as strings)', async () => {
    query.mockResolvedValue([{}]);
    await catalog.counts();
    expect(query.mock.calls[0][0]).toContain("COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'active')::int");
  });

  it('returns zeros on an empty registry', async () => {
    query.mockResolvedValue([{ total: null }]);
    await expect(catalog.counts()).resolves.toMatchObject({ total: 0, deleted: 0 });
  });

  it('maps legacy rows without db_name', async () => {
    query.mockResolvedValue([
      {
        id: '5',
        slug: 'colegio-norte',
        name: 'Norte',
        admin_email: null,
        admin_phone: '300',
        status: 'trial',
        tables_created: true,
        db_name: null,
        trial_ends_at: '2026-04-30',
        created_at: new Date('2026-01-01T00:00:00Z'),
        updated_at: null,
        deleted_at: null,
      },
    ]);
    await expect(catalog.findById(5)).resolves.toMatchObject({
      id: 5,
      databaseName: 'apreu_colegio_norte',
      publicUrl: 'https://colegio-norte.apreu.co',
      tablesCreated: true,
      isDeleted: false,
      trialEndsAt: '2026-04-30',
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE id = $1'), [5]);
  });

  it('selects only operational schools for the KPIs', async () => {
    query.mockResolvedValue([]);
    await catalog.operational();
    expect(query.mock.calls[0][0]).toMatch(/deleted_at IS NULL AND tables_created AND status IN \('active', 'trial'\)/);
  });
});
