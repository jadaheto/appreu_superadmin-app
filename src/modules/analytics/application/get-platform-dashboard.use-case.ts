import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type ClockPort } from '../../../shared/application/ports/clock.port.js';
import type { UseCase } from '../../../shared/application/use-case.js';
import { localDate, monthKey } from '../../../shared/domain/calendar.js';
import { fromCents } from '../domain/amounts.js';
import { monthlySeries, type MonthlyPoint } from '../domain/monthly-series.js';
import { reportingPeriod } from '../domain/reporting-period.js';
import { settleWithConcurrency } from './concurrency.js';
import { ANALYTICS_SETTINGS, type AnalyticsSettings } from './ports/analytics-settings.port.js';
import {
  TENANT_CATALOG,
  type CatalogTenant,
  type TenantCatalogPort,
  type TenantCounts,
} from './ports/tenant-catalog.port.js';
import { TENANT_STATS_READER, type TenantStatsReaderPort } from './ports/tenant-stats-reader.port.js';

export interface PlatformDashboard {
  generatedAt: Date;
  tenants: TenantCounts;
  students: { active: number };
  revenue: { thisMonth: number };
  tenantsByMonth: MonthlyPoint[];
  recentTenants: CatalogTenant[];
  /** Which schools contributed to the cross-tenant KPIs (the legacy hid failures, bug #17). */
  coverage: { queried: number; reachable: number; unreachable: { slug: string; name: string; reason: string }[] };
}

const RECENT_LIMIT = 6;
const UNREACHABLE_REASON = 'No se pudo consultar la base de datos del colegio.';

/**
 * Global dashboard (legacy `dashboard.php`).
 *
 * - Counters from the master registry (deleted schools reported apart).
 * - Schools registered per month for the last 6 months, zero filled.
 * - Cross-tenant KPIs (active students, applied revenue of the month) over
 *   operational schools (`active` and `trial`), queried in parallel with a
 *   concurrency limit through read-only connections.
 */
@Injectable()
export class GetPlatformDashboardUseCase implements UseCase<void, PlatformDashboard> {
  constructor(
    @Inject(TENANT_CATALOG) private readonly catalog: TenantCatalogPort,
    @Inject(TENANT_STATS_READER) private readonly stats: TenantStatsReaderPort,
    @Inject(ANALYTICS_SETTINGS) private readonly settings: AnalyticsSettings,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(): Promise<PlatformDashboard> {
    const now = this.clock.now();
    const period = reportingPeriod(now, this.settings.timeZone);
    // 190 days back covers the 6 calendar months; exact bucketing happens below.
    const since = new Date(now.getTime() - 190 * 24 * 3600 * 1000);

    const [counts, createdDates, recentTenants, operational] = await Promise.all([
      this.catalog.counts(),
      this.catalog.createdSince(since),
      this.catalog.recent(RECENT_LIMIT),
      this.catalog.operational(),
    ]);

    const perMonth = new Map<string, number>();
    for (const created of createdDates) {
      const key = monthKey(localDate(created, this.settings.timeZone));
      perMonth.set(key, (perMonth.get(key) ?? 0) + 1);
    }

    const results = await settleWithConcurrency(operational, this.settings.concurrency, (tenant) =>
      this.stats.readContribution(tenant.databaseName, period),
    );

    let activeStudents = 0;
    let revenueCents = 0;
    const unreachable: PlatformDashboard['coverage']['unreachable'] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        activeStudents += result.value.activeStudents;
        revenueCents += result.value.revenueThisMonthCents;
      } else {
        const tenant = operational[index];
        unreachable.push({ slug: tenant.slug, name: tenant.name, reason: UNREACHABLE_REASON });
      }
    });

    return {
      generatedAt: now,
      tenants: counts,
      students: { active: activeStudents },
      revenue: { thisMonth: fromCents(revenueCents) },
      tenantsByMonth: monthlySeries(period.months, perMonth),
      recentTenants,
      coverage: { queried: operational.length, reachable: operational.length - unreachable.length, unreachable },
    };
  }
}
