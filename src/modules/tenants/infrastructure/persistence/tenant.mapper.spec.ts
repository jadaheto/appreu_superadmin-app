import { TenantMapper } from './tenant.mapper.js';
import { TenantOrmEntity } from './tenant.orm-entity.js';

const row = (overrides: Partial<TenantOrmEntity> = {}): TenantOrmEntity =>
  Object.assign(new TenantOrmEntity(), {
    id: 7,
    slug: 'colegio-viejo',
    name: 'Colegio Viejo',
    adminEmail: 'mal-correo',
    adminPhone: null,
    status: 'trial',
    tablesCreated: true,
    dbName: null,
    trialEndsAt: '2026-04-30',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-02T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  });

describe('TenantMapper', () => {
  const fallback = (slug: string) => `apreu_${slug.replace(/-/g, '_')}`;

  it('restores legacy rows (no db_name, invalid e-mail)', () => {
    const tenant = TenantMapper.toDomain(row(), fallback);
    expect(tenant.databaseName).toBe('apreu_colegio_viejo');
    expect(tenant.adminEmail).toBeNull();
    expect(tenant.tablesCreated).toBe(true);
    expect(tenant.trialEndsAt).toBe('2026-04-30');
  });

  it('round-trips to the ORM row', () => {
    const tenant = TenantMapper.toDomain(row({ adminEmail: 'd@c.co', dbName: 'apreu_x' }), fallback);
    expect(TenantMapper.toOrm(tenant)).toMatchObject({
      id: 7,
      slug: 'colegio-viejo',
      adminEmail: 'd@c.co',
      tablesCreated: true,
      dbName: 'apreu_x',
      status: 'trial',
      deletedAt: null,
    });
  });

  it('accepts DATE values returned as Date objects', () => {
    const tenant = TenantMapper.toDomain(row({ trialEndsAt: new Date('2026-05-01T00:00:00Z') as any }), fallback);
    expect(tenant.trialEndsAt).toBe('2026-05-01');
  });
});
