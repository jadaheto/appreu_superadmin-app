/**
 * Converts a `DECIMAL(12,2)` value (string from the driver) into integer
 * cents, so sums across schools do not accumulate floating point errors.
 */
export const toCents = (value: unknown): number => {
  if (value === null || value === undefined || value === '') return 0;
  const text = String(value).trim();
  const match = /^(-)?(\d+)(?:\.(\d{1,2})\d*)?$/.exec(text);
  if (!match) {
    const parsed = Number(text);
    return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
  }
  const [, sign, whole, fraction = ''] = match;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return sign ? -cents : cents;
};

/** Cents → pesos with two decimals. */
export const fromCents = (cents: number): number => Math.round(cents) / 100;
