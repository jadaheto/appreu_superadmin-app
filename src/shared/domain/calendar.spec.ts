import { addMonths, isoDate, lastMonths, localDate, monthKey, monthLabel, monthStart } from './calendar.js';

describe('calendar', () => {
  it('computes the civil date in Bogotá (UTC-5)', () => {
    // 2026-04-01 03:00 UTC is still March 31st in Bogotá.
    expect(localDate(new Date('2026-04-01T03:00:00Z'), 'America/Bogota')).toEqual({ year: 2026, month: 3, day: 31 });
    expect(isoDate({ year: 2026, month: 3, day: 5 })).toBe('2026-03-05');
  });

  it('adds months across years', () => {
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(addMonths({ year: 2025, month: 12 }, 1)).toEqual({ year: 2026, month: 1 });
  });

  it('lists the last months oldest first', () => {
    expect(lastMonths({ year: 2026, month: 2 }, 3).map(monthKey)).toEqual(['2025-12', '2026-01', '2026-02']);
  });

  it('formats labels in Spanish and month starts', () => {
    expect(monthLabel({ year: 2026, month: 5 })).toBe('may 2026');
    expect(monthStart({ year: 2026, month: 5 })).toBe('2026-05-01 00:00:00');
  });
});
