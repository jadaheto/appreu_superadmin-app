import type { CatalogTenant, TenantCatalogPort, TenantCounts } from '../application/ports/tenant-catalog.port.js';
import type {
  TenantContribution,
  TenantMetricsSnapshot,
  TenantStatsReaderPort,
} from '../application/ports/tenant-stats-reader.port.js';

export const catalogTenant = (id: number, slug: string, overrides: Partial<CatalogTenant> = {}): CatalogTenant => ({
  id,
  slug,
  name: `Colegio ${slug}`,
  adminEmail: null,
  adminPhone: null,
  status: 'active',
  tablesCreated: true,
  databaseName: `apreu_${slug}`,
  trialEndsAt: null,
  publicUrl: `https://apreu.co/${slug}`,
  createdAt: new Date('2026-01-10T12:00:00Z'),
  updatedAt: null,
  deletedAt: null,
  isDeleted: false,
  ...overrides,
});

export class FakeTenantCatalog implements TenantCatalogPort {
  tenants: CatalogTenant[] = [];
  created: Date[] = [];
  countsValue: TenantCounts = { total: 0, active: 0, suspended: 0, trial: 0, deleted: 0, databasesInstalled: 0 };
  async counts() {
    return this.countsValue;
  }
  async createdSince(since: Date) {
    return this.created.filter((d) => d >= since);
  }
  async recent(limit: number) {
    return this.tenants.slice(0, limit);
  }
  async operational() {
    return this.tenants.filter((t) => !t.isDeleted && t.tablesCreated && t.status !== 'suspended');
  }
  async findById(id: number) {
    return this.tenants.find((t) => t.id === id) ?? null;
  }
}

export class FakeStatsReader implements TenantStatsReaderPort {
  contributions = new Map<string, TenantContribution | Error>();
  snapshot: TenantMetricsSnapshot | Error = new Error('sin datos');
  readonly calls: string[] = [];

  async readContribution(databaseName: string): Promise<TenantContribution> {
    this.calls.push(databaseName);
    const value = this.contributions.get(databaseName) ?? new Error('inaccesible');
    if (value instanceof Error) throw value;
    return value;
  }

  async readSnapshot(databaseName: string): Promise<TenantMetricsSnapshot> {
    this.calls.push(databaseName);
    if (this.snapshot instanceof Error) throw this.snapshot;
    return this.snapshot;
  }
}
