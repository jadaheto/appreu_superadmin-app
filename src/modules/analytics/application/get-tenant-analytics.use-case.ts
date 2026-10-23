import { Inject, Injectable, Logger } from '@nestjs/common';
import { CLOCK, type ClockPort } from '../../../shared/application/ports/clock.port.js';
import type { UseCase } from '../../../shared/application/use-case.js';
import { NotFoundError } from '../../../shared/domain/domain-error.js';
import { fromCents } from '../domain/amounts.js';
import { monthlySeries, type MonthlyPoint } from '../domain/monthly-series.js';
import { reportingPeriod } from '../domain/reporting-period.js';
import { ANALYTICS_SETTINGS, type AnalyticsSettings } from './ports/analytics-settings.port.js';
import { TENANT_CATALOG, type CatalogTenant, type TenantCatalogPort } from './ports/tenant-catalog.port.js';
import { TENANT_STATS_READER, type TenantStatsReaderPort } from './ports/tenant-stats-reader.port.js';

export interface TenantAnalytics {
  tenant: CatalogTenant;
  generatedAt: Date;
  available: boolean;
  unavailableReason: string | null;
  metrics: {
    activeStudents: number;
    totalStudents: number;
    revenueThisMonth: number;
    paymentsThisMonth: number;
    receivables: number;
    overdueReceivables: number;
    debtors: number;
  } | null;
  revenueLastSixMonths: MonthlyPoint[];
  latestPayments: { studentName: string; amount: number; method: string | null; paidAt: string }[];
}

/**
 * Metrics of one school (legacy `analytics.php`), allowed for any status
 * (RN-SA-10). Connection errors are reported without driver details
 * (the legacy printed the PDO message).
 */
@Injectable()
export class GetTenantAnalyticsUseCase implements UseCase<number, TenantAnalytics> {
  private readonly logger = new Logger(GetTenantAnalyticsUseCase.name);

  constructor(
    @Inject(TENANT_CATALOG) private readonly catalog: TenantCatalogPort,
    @Inject(TENANT_STATS_READER) private readonly stats: TenantStatsReaderPort,
    @Inject(ANALYTICS_SETTINGS) private readonly settings: AnalyticsSettings,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(id: number): Promise<TenantAnalytics> {
    const tenant = await this.catalog.findById(id);
    if (!tenant) throw new NotFoundError('Colegio', id);

    const now = this.clock.now();
    const period = reportingPeriod(now, this.settings.timeZone);
    const empty: TenantAnalytics = {
      tenant,
      generatedAt: now,
      available: false,
      unavailableReason: null,
      metrics: null,
      revenueLastSixMonths: monthlySeries(period.months, new Map()),
      latestPayments: [],
    };

    if (!tenant.tablesCreated) {
      return { ...empty, unavailableReason: 'Este colegio no tiene la base de datos instalada.' };
    }

    try {
      const snapshot = await this.stats.readSnapshot(tenant.databaseName, period);
      const revenueByMonth = new Map([...snapshot.revenueByMonthCents].map(([key, cents]) => [key, fromCents(cents)]));
      return {
        ...empty,
        available: true,
        metrics: {
          activeStudents: snapshot.activeStudents,
          totalStudents: snapshot.totalStudents,
          revenueThisMonth: fromCents(snapshot.revenueThisMonthCents),
          paymentsThisMonth: snapshot.paymentsThisMonth,
          receivables: fromCents(snapshot.receivablesCents),
          overdueReceivables: fromCents(snapshot.overdueReceivablesCents),
          debtors: snapshot.debtors,
        },
        revenueLastSixMonths: monthlySeries(period.months, revenueByMonth),
        latestPayments: snapshot.latestPayments.map(({ amountCents, ...payment }) => ({
          ...payment,
          amount: fromCents(amountCents),
        })),
      };
    } catch (error) {
      this.logger.warn(`Analítica de ${tenant.slug} no disponible: ${error instanceof Error ? error.message : error}`);
      return { ...empty, unavailableReason: `No se pudo consultar la base de datos ${tenant.databaseName}.` };
    }
  }
}
