import { BusinessRuleViolationError } from '../../../shared/domain/domain-error.js';
import { ValueObject } from '../../../shared/domain/value-object.js';

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 60;

/**
 * Slugs that would collide with platform routes, sub-domains or technical
 * names. The legacy only blocked them by accident (existing folders).
 */
export const RESERVED_SLUGS: readonly string[] = [
  'admin',
  'api',
  'app',
  'apreu',
  'assets',
  'auth',
  'dashboard',
  'docs',
  'health',
  'login',
  'mail',
  'master',
  'platform',
  'root',
  'static',
  'superadmin',
  'support',
  'system',
  'test',
  'vendor',
  'www',
];

/**
 * Public identifier of a school (RN-SA-02): lower-case letters, digits and
 * single dashes, 3–60 characters, not reserved. It defines the public URL and
 * the database name.
 */
export class TenantSlug extends ValueObject<string> {
  private constructor(value: string) {
    super(value);
  }

  /** Lower-cases and trims; does not repair invalid characters. */
  static normalize(raw: string): string {
    return (raw ?? '').trim().toLowerCase();
  }

  static create(raw: string): TenantSlug {
    const slug = TenantSlug.normalize(raw);
    if (slug.length < SLUG_MIN_LENGTH || slug.length > SLUG_MAX_LENGTH) {
      throw new BusinessRuleViolationError(
        `El slug debe tener entre ${SLUG_MIN_LENGTH} y ${SLUG_MAX_LENGTH} caracteres.`,
        'INVALID_SLUG',
        { slug },
      );
    }
    if (!SLUG_PATTERN.test(slug)) {
      throw new BusinessRuleViolationError(
        'Slug inválido: solo letras minúsculas, números y guiones simples (sin guion al inicio ni al final).',
        'INVALID_SLUG',
        { slug },
      );
    }
    if (RESERVED_SLUGS.includes(slug)) {
      throw new BusinessRuleViolationError(`El slug "${slug}" está reservado por la plataforma.`, 'RESERVED_SLUG', {
        slug,
      });
    }
    return new TenantSlug(slug);
  }

  /** Rebuilds a persisted slug (legacy rows may not satisfy the stricter v2 rules). */
  static restore(value: string): TenantSlug {
    return new TenantSlug(value);
  }

  toString(): string {
    return this.value;
  }
}
