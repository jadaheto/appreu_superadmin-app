import { monthKey, monthLabel, type YearMonth } from '../../../shared/domain/calendar.js';

export interface MonthlyPoint {
  /** `YYYY-MM` */
  key: string;
  /** Spanish label, e.g. `may 2026` (the legacy used English `%b`). */
  label: string;
  value: number;
}

/**
 * Builds a continuous series for the given months; months without data are
 * filled with 0 (the legacy skipped them, distorting the bar charts).
 */
export const monthlySeries = (months: YearMonth[], values: ReadonlyMap<string, number>): MonthlyPoint[] =>
  months.map((month) => {
    const key = monthKey(month);
    return { key, label: monthLabel(month), value: values.get(key) ?? 0 };
  });
