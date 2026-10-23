import { BusinessRuleViolationError } from '../domain-error.js';
import { ValueObject } from '../value-object.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** A syntactically valid, lower-cased e-mail address. */
export class Email extends ValueObject<string> {
  private constructor(value: string) {
    super(value);
  }

  static create(raw: string): Email {
    const normalized = (raw ?? '').trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalized) || normalized.length > 150) {
      throw new BusinessRuleViolationError(`Correo electrónico inválido: "${raw}".`, 'INVALID_EMAIL');
    }
    return new Email(normalized);
  }

  toString(): string {
    return this.value;
  }
}
