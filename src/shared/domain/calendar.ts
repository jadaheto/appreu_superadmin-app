/**
 * Calendar helpers working on civil dates of a given IANA time zone
 * (`America/Bogota` by default). Pure functions: no system clock access.
 */

export interface YearMonth {
  year: number;
  /** 1–12 */
  month: number;
}

export interface CalendarDate extends YearMonth {
  day: number;
}

const SPANISH_MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const pad = (value: number, size = 2): string => String(value).padStart(size, '0');

/** Civil date of `instant` in `timeZone`. */
export const localDate = (instant: Date, timeZone: string): CalendarDate => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
};

/** `YYYY-MM-DD` */
export const isoDate = ({ year, month, day }: CalendarDate): string => `${year}-${pad(month)}-${pad(day)}`;

/** `YYYY-MM` */
export const monthKey = ({ year, month }: YearMonth): string => `${year}-${pad(month)}`;

/** Spanish short label, e.g. `may 2026`. */
export const monthLabel = ({ year, month }: YearMonth): string => `${SPANISH_MONTHS[month - 1]} ${year}`;

export const addMonths = ({ year, month }: YearMonth, delta: number): YearMonth => {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
};

/** First day of the month as `YYYY-MM-DD 00:00:00` (naive local datetime, as stored by the schools). */
export const monthStart = (ym: YearMonth): string => `${monthKey(ym)}-01 00:00:00`;

/** The `count` months ending at `last` (inclusive), oldest first. */
export const lastMonths = (last: YearMonth, count: number): YearMonth[] =>
  Array.from({ length: count }, (_, i) => addMonths(last, i - (count - 1)));
