import { loadEnvironment } from '../../../../shared/infrastructure/config/environment.js';
import { FakeTenantDatabaseConnector } from '../../../../shared/testing/fake-sql.js';
import { reportingPeriod } from '../../domain/reporting-period.js';
import { PostgresTenantStatsReader, STATS_SQL } from './postgres-tenant-stats-reader.js';

const env = loadEnvironment({
  SUPERADMIN_JWT_SECRET: 's',
  MASTER_DB_HOST: 'm',
  MASTER_DB_USER: 'u',
  MASTER_DB_NAME: 'master',
  TENANT_DB_HOST: 't',
  TENANT_DB_ADMIN_USER: 'prov',
});
const period = reportingPeriod(new Date('2026-03-15T15:00:00Z'), 'America/Bogota');

describe('PostgresTenantStatsReader', () => {
  let connector: FakeTenantDatabaseConnector;
  let reader: PostgresTenantStatsReader;

  beforeEach(() => {
    connector = new FakeTenantDatabaseConnector();
    reader = new PostgresTenantStatsReader(connector, env);
  });

  it('only counts applied payments as revenue', () => {
    expect(STATS_SQL.revenueOfMonth).toContain("status = 'applied'");
    expect(STATS_SQL.revenueByMonth).toContain("status = 'applied'");
    expect(STATS_SQL.receivables).toContain("p.status = 'applied'");
    expect(STATS_SQL.receivables).toContain("'pending', 'partial', 'overdue'");
  });

  it('uses PostgreSQL placeholders and casts counters to int', () => {
    const all = Object.values(STATS_SQL).join('\n');
    expect(all).not.toMatch(/\?|`|DATE_FORMAT|IFNULL/);
    expect(STATS_SQL.revenueOfMonth).toContain('payment_date >= $1 AND payment_date < $2');
    expect(STATS_SQL.students).toContain('COUNT(*)::int AS total');
    expect(STATS_SQL.revenueByMonth).toContain("to_char(payment_date, 'YYYY-MM')");
  });

  it('reads the contribution of a school on a read-only session', async () => {
    connector.respond = (sql) =>
      sql === STATS_SQL.activeStudents ? [{ active: 42 }] : [{ total: '1500000.50', payments: 3 }];

    await expect(reader.readContribution('apreu_norte', period)).resolves.toEqual({
      activeStudents: 42,
      revenueThisMonthCents: 150000050,
    });
    expect(connector.opened).toEqual(['readonly:apreu_norte']);
    expect(connector.queries[1].params).toEqual(['2026-03-01 00:00:00', '2026-04-01 00:00:00']);
    expect(connector.closed).toBe(1);
  });

  it('builds the snapshot of one school', async () => {
    connector.respond = (sql) => {
      if (sql === STATS_SQL.students) return [{ active: '10', total: 12 }];
      if (sql === STATS_SQL.revenueOfMonth) return [{ total: '250000.00', payments: 2 }];
      if (sql === STATS_SQL.receivables) return [{ receivables: '900000.50', overdue: '300000', debtors: 4 }];
      if (sql === STATS_SQL.revenueByMonth) return [{ ym: '2026-02', total: '100.10' }];
      return [
        { student: 'Ana Pérez ', amount: '120000.00', payment_method: 'nequi', payment_date: '2026-03-14 10:00:00' },
      ];
    };

    const snapshot = await reader.readSnapshot('apreu_norte', period);

    expect(snapshot).toMatchObject({
      activeStudents: 10,
      totalStudents: 12,
      revenueThisMonthCents: 25000000,
      paymentsThisMonth: 2,
      receivablesCents: 90000050,
      overdueReceivablesCents: 30000000,
      debtors: 4,
      latestPayments: [
        { studentName: 'Ana Pérez', amountCents: 12000000, method: 'nequi', paidAt: '2026-03-14 10:00:00' },
      ],
    });
    expect(snapshot.revenueByMonthCents.get('2026-02')).toBe(10010);
    const receivablesQuery = connector.queries.find((q) => q.sql === STATS_SQL.receivables);
    expect(receivablesQuery?.params).toEqual(['2026-03-15']);
  });

  it('closes the session when a query fails', async () => {
    connector.respond = () => new Error('timeout');
    await expect(reader.readContribution('apreu_norte', period)).rejects.toThrow('timeout');
    expect(connector.closed).toBe(1);
  });
});
