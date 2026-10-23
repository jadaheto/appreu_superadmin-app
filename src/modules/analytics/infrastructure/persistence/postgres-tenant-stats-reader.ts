import { Inject, Injectable } from '@nestjs/common';
import { ENVIRONMENT, type Environment } from '../../../../shared/infrastructure/config/environment.js';
import {
  type SqlSession,
  TENANT_DATABASE_CONNECTOR,
  type TenantDatabaseConnector,
} from '../../../../shared/infrastructure/persistence/tenant-database-connector.js';
import type {
  TenantContribution,
  TenantMetricsSnapshot,
  TenantStatsReaderPort,
} from '../../application/ports/tenant-stats-reader.port.js';
import { toCents } from '../../domain/amounts.js';
import type { ReportingPeriod } from '../../domain/reporting-period.js';

type Row = Record<string, unknown>;

/**
 * KPI queries (PostgreSQL). The read-only session runs with
 * `TimeZone = America/Bogota`, so the naive boundaries of the
 * {@link ReportingPeriod} (`2026-03-01 00:00:00`) and `to_char` over
 * `timestamptz` columns are interpreted in the school time zone.
 * Counters are cast to `int` (`pg` returns `bigint` as strings); sums of
 * `numeric` stay strings and are converted to cents.
 */
export const STATS_SQL = {
  students: "SELECT COUNT(*) FILTER (WHERE status = 'active')::int AS active, COUNT(*)::int AS total FROM students",
  activeStudents: "SELECT COUNT(*)::int AS active FROM students WHERE status = 'active'",
  revenueOfMonth:
    'SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*)::int AS payments FROM payments ' +
    "WHERE status = 'applied' AND payment_date >= $1 AND payment_date < $2",
  /**
   * Pending balance per charge = net amount − applications of *applied*
   * payments. Debtors and overdue balance use the same set of charges
   * (`pending | partial | overdue`), fixing the legacy inconsistency (#18).
   */
  receivables: `SELECT
      COALESCE(SUM(b.balance), 0) AS receivables,
      COALESCE(SUM(b.balance) FILTER (WHERE b.due_date < $1), 0) AS overdue,
      COUNT(DISTINCT b.student_id) FILTER (WHERE b.due_date < $1)::int AS debtors
    FROM (
      SELECT sc.student_id, sc.due_date, sc.net_amount - COALESCE(pa.paid, 0) AS balance
      FROM student_charges sc
      LEFT JOIN (
        SELECT a.charge_id, SUM(a.amount_applied) AS paid
        FROM payment_applications a
        JOIN payments p ON p.id = a.payment_id AND p.status = 'applied'
        GROUP BY a.charge_id
      ) pa ON pa.charge_id = sc.id
      WHERE sc.status IN ('pending', 'partial', 'overdue')
    ) b
    WHERE b.balance > 0`,
  revenueByMonth:
    "SELECT to_char(payment_date, 'YYYY-MM') AS ym, COALESCE(SUM(amount), 0) AS total FROM payments " +
    "WHERE status = 'applied' AND payment_date >= $1 AND payment_date < $2 GROUP BY ym",
  latestPayments:
    "SELECT concat_ws(' ', s.first_name, s.last_name) AS student, p.amount, p.payment_method, " +
    "to_char(p.payment_date, 'YYYY-MM-DD HH24:MI:SS') AS payment_date " +
    "FROM payments p JOIN students s ON s.id = p.student_id WHERE p.status = 'applied' " +
    'ORDER BY p.payment_date DESC, p.id DESC LIMIT 8',
};

/**
 * Runs the KPI queries of doc 09 §4 on a school database through a
 * read-only session (READ ONLY transaction, reader account, `statement_timeout`).
 */
@Injectable()
export class PostgresTenantStatsReader implements TenantStatsReaderPort {
  constructor(
    @Inject(TENANT_DATABASE_CONNECTOR) private readonly connector: TenantDatabaseConnector,
    @Inject(ENVIRONMENT) private readonly env: Environment,
  ) {}

  readContribution(databaseName: string, period: ReportingPeriod): Promise<TenantContribution> {
    return this.withSession(databaseName, async (db) => {
      const [students] = await db.query<Row>(STATS_SQL.activeStudents);
      const [revenue] = await db.query<Row>(STATS_SQL.revenueOfMonth, [period.monthStart, period.nextMonthStart]);
      return { activeStudents: Number(students?.active ?? 0), revenueThisMonthCents: toCents(revenue?.total) };
    });
  }

  readSnapshot(databaseName: string, period: ReportingPeriod): Promise<TenantMetricsSnapshot> {
    return this.withSession(databaseName, async (db) => {
      const [students] = await db.query<Row>(STATS_SQL.students);
      const [revenue] = await db.query<Row>(STATS_SQL.revenueOfMonth, [period.monthStart, period.nextMonthStart]);
      const [receivables] = await db.query<Row>(STATS_SQL.receivables, [period.today]);
      const months = await db.query<Row>(STATS_SQL.revenueByMonth, [period.sixMonthsStart, period.nextMonthStart]);
      const payments = await db.query<Row>(STATS_SQL.latestPayments);
      return {
        activeStudents: Number(students?.active ?? 0),
        totalStudents: Number(students?.total ?? 0),
        revenueThisMonthCents: toCents(revenue?.total),
        paymentsThisMonth: Number(revenue?.payments ?? 0),
        receivablesCents: toCents(receivables?.receivables),
        overdueReceivablesCents: toCents(receivables?.overdue),
        debtors: Number(receivables?.debtors ?? 0),
        revenueByMonthCents: new Map(months.map((row) => [String(row.ym), toCents(row.total)])),
        latestPayments: payments.map((row) => ({
          studentName: String(row.student ?? '').trim(),
          amountCents: toCents(row.amount),
          method: (row.payment_method as string | null) ?? null,
          paidAt: String(row.payment_date ?? ''),
        })),
      };
    });
  }

  private async withSession<T>(databaseName: string, work: (db: SqlSession) => Promise<T>): Promise<T> {
    const session = await this.connector.openReadOnlySession(databaseName, this.env.analytics.queryTimeoutMs);
    try {
      return await work(session);
    } finally {
      await session.close();
    }
  }
}
