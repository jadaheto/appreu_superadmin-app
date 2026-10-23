import { fromCents, toCents } from './amounts.js';
import { monthlySeries } from './monthly-series.js';
import { reportingPeriod } from './reporting-period.js';

describe('reportingPeriod', () => {
  it('uses the Bogotá calendar month', () => {
    // 2026-05-01 02:00 UTC is still April 30th in Bogotá.
    const period = reportingPeriod(new Date('2026-05-01T02:00:00Z'), 'America/Bogota');
    expect(period).toMatchObject({
      today: '2026-04-30',
      monthStart: '2026-04-01 00:00:00',
      nextMonthStart: '2026-05-01 00:00:00',
      sixMonthsStart: '2025-11-01 00:00:00',
    });
    expect(period.months).toHaveLength(6);
  });

  it('rolls over the year in December', () => {
    expect(reportingPeriod(new Date('2026-12-15T12:00:00Z'), 'America/Bogota').nextMonthStart).toBe(
      '2027-01-01 00:00:00',
    );
  });
});

describe('monthlySeries', () => {
  it('fills missing months with zero and labels them in Spanish', () => {
    const months = [
      { year: 2026, month: 1 },
      { year: 2026, month: 2 },
      { year: 2026, month: 3 },
    ];
    expect(monthlySeries(months, new Map([['2026-02', 5]]))).toEqual([
      { key: '2026-01', label: 'ene 2026', value: 0 },
      { key: '2026-02', label: 'feb 2026', value: 5 },
      { key: '2026-03', label: 'mar 2026', value: 0 },
    ]);
  });
});

describe('amounts', () => {
  it.each([
    ['1234567.89', 123456789],
    ['0.10', 10],
    ['15', 1500],
    ['-20.5', -2050],
    [null, 0],
    [12.3, 1230],
  ])('converts %s to %i cents', (value, cents) => {
    expect(toCents(value)).toBe(cents);
  });

  it('sums without floating point drift', () => {
    const total = ['0.10', '0.20', '0.70'].reduce((sum, v) => sum + toCents(v), 0);
    expect(fromCents(total)).toBe(1);
  });
});
