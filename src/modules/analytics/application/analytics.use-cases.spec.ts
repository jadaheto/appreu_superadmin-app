import { NotFoundError } from '../../../shared/domain/domain-error.js';
import { FixedClock } from '../../../shared/testing/fakes.js';
import { catalogTenant, FakeStatsReader, FakeTenantCatalog } from '../testing/fakes.js';
import { GetPlatformDashboardUseCase } from './get-platform-dashboard.use-case.js';
import { GetTenantAnalyticsUseCase } from './get-tenant-analytics.use-case.js';

const settings = { concurrency: 2, timeZone: 'America/Bogota' };

describe('GetPlatformDashboardUseCase', () => {
  let catalog: FakeTenantCatalog;
  let stats: FakeStatsReader;
  let clock: FixedClock;

  beforeEach(() => {
    catalog = new FakeTenantCatalog();
    stats = new FakeStatsReader();
    clock = new FixedClock(new Date('2026-03-15T15:00:00Z'));
  });

  it('aggregates cross-tenant KPIs over active and trial schools and reports unreachable ones', async () => {
    catalog.tenants = [
      catalogTenant(1, 'norte'),
      catalogTenant(2, 'sur', { status: 'trial' }),
      catalogTenant(3, 'este', { status: 'suspended' }),
      catalogTenant(4, 'caido'),
    ];
    catalog.countsValue = { total: 4, active: 2, suspended: 1, trial: 1, deleted: 0, databasesInstalled: 4 };
    stats.contributions.set('apreu_norte', { activeStudents: 120, revenueThisMonthCents: 150_000_010 });
    stats.contributions.set('apreu_sur', { activeStudents: 30, revenueThisMonthCents: 20 });

    const dashboard = await new GetPlatformDashboardUseCase(catalog, stats, settings, clock).execute();

    expect(stats.calls.sort()).toEqual(['apreu_caido', 'apreu_norte', 'apreu_sur']);
    expect(dashboard.students.active).toBe(150);
    expect(dashboard.revenue.thisMonth).toBe(1_500_000.3);
    expect(dashboard.coverage).toEqual({
      queried: 3,
      reachable: 2,
      unreachable: [{ slug: 'caido', name: 'Colegio caido', reason: expect.any(String) }],
    });
    expect(dashboard.tenants).toBe(catalog.countsValue);
    expect(dashboard.recentTenants).toHaveLength(4);
  });

  it('counts registrations per Bogotá month with zero filled gaps', async () => {
    catalog.created = [
      new Date('2026-03-01T03:00:00Z'), // Feb 28th in Bogotá
      new Date('2026-03-10T12:00:00Z'),
      new Date('2025-12-24T12:00:00Z'),
    ];
    const dashboard = await new GetPlatformDashboardUseCase(catalog, stats, settings, clock).execute();
    expect(dashboard.tenantsByMonth).toEqual([
      { key: '2025-10', label: 'oct 2025', value: 0 },
      { key: '2025-11', label: 'nov 2025', value: 0 },
      { key: '2025-12', label: 'dic 2025', value: 1 },
      { key: '2026-01', label: 'ene 2026', value: 0 },
      { key: '2026-02', label: 'feb 2026', value: 1 },
      { key: '2026-03', label: 'mar 2026', value: 1 },
    ]);
    expect(dashboard.coverage).toEqual({ queried: 0, reachable: 0, unreachable: [] });
  });
});

describe('GetTenantAnalyticsUseCase', () => {
  let catalog: FakeTenantCatalog;
  let stats: FakeStatsReader;
  let useCase: GetTenantAnalyticsUseCase;

  beforeEach(() => {
    catalog = new FakeTenantCatalog();
    stats = new FakeStatsReader();
    useCase = new GetTenantAnalyticsUseCase(catalog, stats, settings, new FixedClock());
  });

  it('returns metrics, a zero filled six month series and latest payments', async () => {
    catalog.tenants = [catalogTenant(1, 'norte', { status: 'suspended' })];
    stats.snapshot = {
      activeStudents: 10,
      totalStudents: 12,
      revenueThisMonthCents: 250_000_00,
      paymentsThisMonth: 3,
      receivablesCents: 900_000_50,
      overdueReceivablesCents: 300_000_00,
      debtors: 4,
      revenueByMonthCents: new Map([['2026-03', 250_000_00]]),
      latestPayments: [
        { studentName: 'Ana Pérez', amountCents: 120_000_00, method: 'nequi', paidAt: '2026-03-14 10:00:00' },
      ],
    };

    const result = await useCase.execute(1);

    expect(result.available).toBe(true);
    expect(result.metrics).toEqual({
      activeStudents: 10,
      totalStudents: 12,
      revenueThisMonth: 250000,
      paymentsThisMonth: 3,
      receivables: 900000.5,
      overdueReceivables: 300000,
      debtors: 4,
    });
    expect(result.revenueLastSixMonths).toHaveLength(6);
    expect(result.revenueLastSixMonths.at(-1)).toEqual({ key: '2026-03', label: 'mar 2026', value: 250000 });
    expect(result.revenueLastSixMonths[0].value).toBe(0);
    expect(result.latestPayments).toEqual([
      { studentName: 'Ana Pérez', amount: 120000, method: 'nequi', paidAt: '2026-03-14 10:00:00' },
    ]);
  });

  it('reports schools without database', async () => {
    catalog.tenants = [catalogTenant(1, 'norte', { tablesCreated: false })];
    const result = await useCase.execute(1);
    expect(result).toMatchObject({
      available: false,
      metrics: null,
      unavailableReason: expect.stringMatching(/no tiene/),
    });
    expect(stats.calls).toEqual([]);
  });

  it('hides connection errors details', async () => {
    catalog.tenants = [catalogTenant(1, 'norte')];
    stats.snapshot = new Error('Access denied for user root@10.0.0.5');
    const result = await useCase.execute(1);
    expect(result.available).toBe(false);
    expect(result.unavailableReason).toBe('No se pudo consultar la base de datos apreu_norte.');
  });

  it('fails with 404 for unknown schools', async () => {
    await expect(useCase.execute(99)).rejects.toBeInstanceOf(NotFoundError);
  });
});
