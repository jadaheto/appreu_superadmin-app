import { BusinessRuleViolationError } from './domain-error.js';

/**
 * Small set of reusable invariant checks used by entities and value objects.
 * Each check throws a {@link BusinessRuleViolationError} when it fails, so
 * domain objects can never be constructed in an invalid state.
 */
export const Guard = {
  /** Fails when the value is null, undefined or a blank string. */
  againstEmpty(value: unknown, field: string): void {
    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
      throw new BusinessRuleViolationError(`El campo "${field}" es obligatorio.`, 'REQUIRED_FIELD', { field });
    }
  },

  /** Fails when the string is longer than `max` characters. */
  againstMaxLength(value: string | null | undefined, max: number, field: string): void {
    if (value && value.length > max) {
      throw new BusinessRuleViolationError(`El campo "${field}" no puede superar ${max} caracteres.`, 'MAX_LENGTH', {
        field,
        max,
      });
    }
  },

  /** Fails when the number is negative. */
  againstNegative(value: number, field: string): void {
    if (value < 0) {
      throw new BusinessRuleViolationError(`El campo "${field}" no puede ser negativo.`, 'NEGATIVE_VALUE', { field });
    }
  },

  /** Fails when the number is outside the inclusive range. */
  inRange(value: number, min: number, max: number, field: string): void {
    if (value < min || value > max) {
      throw new BusinessRuleViolationError(`El campo "${field}" debe estar entre ${min} y ${max}.`, 'OUT_OF_RANGE', {
        field,
        min,
        max,
      });
    }
  },

  /** Fails when the value is not one of the allowed literals. */
  oneOf<T>(value: T, allowed: readonly T[], field: string): void {
    if (!allowed.includes(value)) {
      throw new BusinessRuleViolationError(
        `Valor inválido para "${field}". Permitidos: ${allowed.join(', ')}.`,
        'INVALID_OPTION',
        { field, allowed },
      );
    }
  },

  /** Fails when `end` is before `start`. */
  againstInvertedDates(start: Date, end: Date, field: string): void {
    if (end.getTime() < start.getTime()) {
      throw new BusinessRuleViolationError(
        `La fecha final de "${field}" no puede ser anterior a la inicial.`,
        'INVERTED_DATES',
        { field },
      );
    }
  },
};
