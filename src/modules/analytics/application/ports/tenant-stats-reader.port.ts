import type { ReportingPeriod } from '../../domain/reporting-period.js';

/** Amounts are integer cents (COP). */
export interface TenantContribution {
  activeStudents: number;
  revenueThisMonthCents: number;
}

export interface TenantMetricsSnapshot {
  activeStudents: number;
  totalStudents: number;
  revenueThisMonthCents: number;
  paymentsThisMonth: number;
  /** Pending balance of charges `pending | partial | overdue`. */
  receivablesCents: number;
  /** Part of {@link receivablesCents} already past its due date. */
  overdueReceivablesCents: number;
  /** Students with an overdue balance (includes `partial`, consistent with the receivables; legacy bug #18). */
  debtors: number;
  /** Applied revenue per month `YYYY-MM` → cents. */
  revenueByMonthCents: Map<string, number>;
  latestPayments: { studentName: string; amountCents: number; method: string | null; paidAt: string }[];
}

/**
 * Read-only queries on the database of one school (legacy `dashboard.php`
 * and `analytics.php`). Only `payments.status = 'applied'` counts as revenue
 * (the legacy also added reversed payments, bug #17).
 */
export interface TenantStatsReaderPort {
  readContribution(databaseName: string, period: ReportingPeriod): Promise<TenantContribution>;
  readSnapshot(databaseName: string, period: ReportingPeriod): Promise<TenantMetricsSnapshot>;
}

export const TENANT_STATS_READER = Symbol('TenantStatsReaderPort');
