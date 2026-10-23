import {
  addMonths,
  type CalendarDate,
  isoDate,
  lastMonths,
  localDate,
  monthStart,
  type YearMonth,
} from '../../../shared/domain/calendar.js';

/**
 * Time window of the analytics, computed in the platform time zone
 * (`America/Bogota`). The legacy used `MONTH(NOW())` of the database server,
 * whose time zone may differ from the schools'.
 *
 * Datetimes are naive local strings because `payments.payment_date` is a
 * `DATETIME` written in local time by the school ERP.
 */
export interface ReportingPeriod {
  today: string;
  /** `YYYY-MM-01 00:00:00` of the current month (inclusive). */
  monthStart: string;
  /** First instant of next month (exclusive). */
  nextMonthStart: string;
  /** The last six months, oldest first, current month included. */
  months: YearMonth[];
  /** First instant of the oldest month of {@link months}. */
  sixMonthsStart: string;
}

export const reportingPeriod = (now: Date, timeZone: string): ReportingPeriod => {
  const date: CalendarDate = localDate(now, timeZone);
  const months = lastMonths(date, 6);
  return {
    today: isoDate(date),
    monthStart: monthStart(date),
    nextMonthStart: monthStart(addMonths(date, 1)),
    months,
    sixMonthsStart: monthStart(months[0]),
  };
};
