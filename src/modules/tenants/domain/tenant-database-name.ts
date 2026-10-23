import { BusinessRuleViolationError } from '../../../shared/domain/domain-error.js';

/** PostgreSQL truncates identifiers longer than 63 bytes (NAMEDATALEN − 1). */
const MAX_DATABASE_NAME = 63;

/**
 * Legacy naming rule (RN-SA-02): `<prefix>` + slug with dashes replaced by
 * underscores, e.g. `colegio-san-jose` → `apreu_colegio_san_jose`.
 */
export const databaseNameFor = (prefix: string, slug: string): string => {
  const name = `${prefix}${slug.replace(/-/g, '_')}`;
  if (name.length > MAX_DATABASE_NAME) {
    throw new BusinessRuleViolationError(
      `El nombre de la base de datos (${name}) supera ${MAX_DATABASE_NAME} caracteres; use un slug más corto.`,
      'DATABASE_NAME_TOO_LONG',
      { name },
    );
  }
  return name;
};
