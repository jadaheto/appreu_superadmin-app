/** Tuning of the cross-tenant queries. */
export interface AnalyticsSettings {
  concurrency: number;
  timeZone: string;
}

export const ANALYTICS_SETTINGS = Symbol('AnalyticsSettings');
