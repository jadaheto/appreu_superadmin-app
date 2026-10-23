import { BusinessRuleViolationError } from '../../../../shared/domain/domain-error.js';

const IDENTIFIER_CHAR = /[A-Za-z0-9_$]/;
const DOLLAR_TAG = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

/**
 * Splits a PostgreSQL script into individual statements.
 *
 * Unlike the legacy `explode(';')` (bug #8) it respects string literals
 * (`'…'` with `''`, `E'…'` with backslash escapes), quoted identifiers
 * (`"…"`), dollar-quoted bodies (`$$…$$`, `$fn$…$fn$`, used by functions and
 * `DO` blocks) and comments (`--` and nested `/* … *\/`, which are removed).
 * psql meta-commands (`\connect`, `\i`, `\copy`…) are not SQL and are rejected.
 * SQL-standard bodies (`BEGIN ATOMIC … END`) are not supported: use `$$`.
 */
export const splitSqlStatements = (script: string): string[] => {
  const statements: string[] = [];
  let current = '';
  let i = 0;
  let atLineStart = true;

  const push = () => {
    const statement = current.trim();
    if (statement) statements.push(statement);
    current = '';
  };

  while (i < script.length) {
    const char = script[i];
    const next = script[i + 1];

    if (atLineStart && /^[ \t]*\\/.test(script.slice(i, i + 64))) {
      throw new BusinessRuleViolationError(
        'El script SQL contiene meta-comandos de psql (\\connect, \\i, …), que no están soportados en el aprovisionamiento.',
        'UNSUPPORTED_SQL',
      );
    }
    atLineStart = false;

    // String literals and quoted identifiers.
    if (char === "'" || char === '"') {
      const previous = script[i - 1] ?? '';
      const escapes =
        char === "'" &&
        /[eE]/.test(previous) &&
        !IDENTIFIER_CHAR.test(script[i - 2] ?? '') &&
        current.endsWith(previous);
      let j = i + 1;
      while (j < script.length) {
        if (escapes && script[j] === '\\') {
          j += 2;
          continue;
        }
        if (script[j] === char) {
          if (script[j + 1] === char) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      current += script.slice(i, j + 1);
      i = j + 1;
      continue;
    }

    // Dollar-quoted strings ($$…$$ or $tag$…$tag$); `$1` placeholders never match.
    if (char === '$' && !IDENTIFIER_CHAR.test(script[i - 1] ?? '')) {
      const tag = DOLLAR_TAG.exec(script.slice(i, i + 66))?.[0];
      if (tag) {
        const end = script.indexOf(tag, i + tag.length);
        const stop = end === -1 ? script.length : end + tag.length;
        current += script.slice(i, stop);
        i = stop;
        continue;
      }
    }

    // Block comments (nested, as in PostgreSQL).
    if (char === '/' && next === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < script.length && depth > 0) {
        if (script[j] === '/' && script[j + 1] === '*') {
          depth++;
          j += 2;
        } else if (script[j] === '*' && script[j + 1] === '/') {
          depth--;
          j += 2;
        } else {
          j++;
        }
      }
      current += ' ';
      i = j;
      continue;
    }

    // Line comments.
    if (char === '-' && next === '-') {
      const end = script.indexOf('\n', i);
      i = end === -1 ? script.length : end;
      continue;
    }

    if (char === ';') {
      push();
      i++;
      continue;
    }

    if (char === '\n') atLineStart = true;
    current += char;
    i++;
  }
  push();
  return statements;
};

/** Rows of `users` are never seeded (any schema qualifier or quoting). */
const USER_INSERT = /^(?:INSERT\s+INTO|MERGE\s+INTO)\s+(?:"?public"?\.)?"?users"?[\s(]/i;
/** The provisioner wraps every script in its own transaction. */
const TRANSACTION_CONTROL = /^(?:BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK)(?:\s+(?:WORK|TRANSACTION))?$/i;
/** Ownership is decided by the provisioner (`TENANT_DB_OWNER`), not by the script. */
const OWNER_CHANGE = /^ALTER\s+[\s\S]+\s+OWNER\s+TO\s+/i;
/** Extensions a school database may install (ADR-0008: `unaccent` + `pg_trgm`). */
const ALLOWED_EXTENSIONS = new Set(['unaccent', 'pg_trgm', 'pgcrypto', 'citext', 'btree_gin', 'btree_gist', 'plpgsql']);
const CREATE_EXTENSION = /^CREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z0-9_]+)"?/i;

const FORBIDDEN = [
  /^(?:CREATE|DROP|ALTER)\s+DATABASE\b/i,
  /^(?:CREATE|DROP|ALTER)\s+(?:ROLE|USER|GROUP)\b/i,
  /^(?:GRANT|REVOKE)\s/i,
  /^(?:SET|RESET)\s+(?:SESSION\s+|LOCAL\s+)?(?:ROLE|SESSION\s+AUTHORIZATION)\b/i,
  /^ALTER\s+SYSTEM\b/i,
  /^COPY\b/i,
  /^LOAD\s/i,
  /^(?:CREATE|ALTER|DROP)\s+(?:SERVER|FOREIGN\s+DATA\s+WRAPPER|USER\s+MAPPING|SUBSCRIPTION|PUBLICATION|TABLESPACE)\b/i,
  /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:TRUSTED\s+)?(?:PROCEDURAL\s+)?LANGUAGE\b/i,
  /\b(?:pg_read_file|pg_read_binary_file|pg_ls_dir|lo_import|lo_export|pg_terminate_backend|dblink\w*)\s*\(/i,
];

export interface PreparedScript {
  statements: string[];
  /** Notes about statements intentionally not executed. */
  skipped: string[];
}

/**
 * Applies the safety policy to the statements of the school schema:
 * - Rows inserted into `users` are skipped: a school must never be born with
 *   seeded accounts (legacy bug #3, the `INSERT IGNORE` that created a
 *   superadmin with a public hash in every tenant).
 * - `ALTER … OWNER TO` is skipped (the provisioner decides the owner) and
 *   transaction control (`BEGIN`/`COMMIT`) is dropped (each script already
 *   runs in its own transaction).
 * - Statements that could escape the target database or the server
 *   (`CREATE DATABASE`, roles, `GRANT`, `SET ROLE`, `COPY`, `ALTER SYSTEM`,
 *   extensions outside the allow-list, file access functions…) abort the
 *   provisioning.
 */
export const prepareTenantScript = (script: string, source: string): PreparedScript => {
  const prepared: PreparedScript = { statements: [], skipped: [] };
  for (const statement of splitSqlStatements(script)) {
    if (TRANSACTION_CONTROL.test(statement)) continue;
    const extension = CREATE_EXTENSION.exec(statement)?.[1]?.toLowerCase();
    const forbidden =
      (extension !== undefined && !ALLOWED_EXTENSIONS.has(extension)) ||
      FORBIDDEN.some((pattern) => pattern.test(statement));
    if (forbidden) {
      throw new BusinessRuleViolationError(
        `${source} contiene una sentencia no permitida: ${statement.slice(0, 60)}…`,
        'FORBIDDEN_SQL',
        { source },
      );
    }
    if (USER_INSERT.test(statement)) {
      prepared.skipped.push(`${source}: se omitió una inserción en "users" (no se siembran usuarios).`);
      continue;
    }
    if (OWNER_CHANGE.test(statement)) {
      prepared.skipped.push(`${source}: se omitió un cambio de propietario (lo define el aprovisionamiento).`);
      continue;
    }
    prepared.statements.push(statement);
  }
  return prepared;
};
