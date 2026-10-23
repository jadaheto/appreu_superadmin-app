import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { prepareTenantScript, splitSqlStatements } from './sql-script.js';

describe('splitSqlStatements', () => {
  it('splits on top-level semicolons only', () => {
    const sql = `CREATE TABLE a (x integer);\nINSERT INTO settings VALUES ('k', 'uno; dos', 'it''s; ok');\nSELECT "a;""b" FROM t;`;
    expect(splitSqlStatements(sql)).toEqual([
      'CREATE TABLE a (x integer)',
      "INSERT INTO settings VALUES ('k', 'uno; dos', 'it''s; ok')",
      'SELECT "a;""b" FROM t',
    ]);
  });

  it('honours backslash escapes only in E strings', () => {
    expect(splitSqlStatements("SELECT E'a\\';b'; SELECT 'c\\'; SELECT 2;")).toEqual([
      "SELECT E'a\\';b'",
      "SELECT 'c\\'",
      'SELECT 2',
    ]);
  });

  it('keeps dollar-quoted function bodies whole', () => {
    const sql = [
      'CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$',
      'BEGIN NEW.updated_at := now(); RETURN NEW; END;',
      '$$;',
      "DO $body$ BEGIN PERFORM 1; RAISE NOTICE '$$;'; END $body$;",
      'SELECT $1::int;',
    ].join('\n');
    const statements = splitSqlStatements(sql);
    expect(statements).toHaveLength(3);
    expect(statements[0]).toMatch(/^CREATE FUNCTION[\s\S]+RETURN NEW; END;\n\$\$$/);
    expect(statements[1]).toBe("DO $body$ BEGIN PERFORM 1; RAISE NOTICE '$$;'; END $body$");
    expect(statements[2]).toBe('SELECT $1::int');
  });

  it('drops line and nested block comments', () => {
    const sql = [
      '-- comentario; con punto y coma',
      '/* bloque; /* anidado; */ sigue; */',
      'CREATE TABLE b (id integer) /* inline; */;',
      'SELECT 1; -- final;',
    ].join('\n');
    expect(splitSqlStatements(sql)).toEqual(['CREATE TABLE b (id integer)', 'SELECT 1']);
  });

  it('rejects psql meta-commands', () => {
    expect(() => splitSqlStatements('\\connect apreu_otro\nCREATE TABLE x (id integer);')).toThrow(/psql/);
  });
});

describe('prepareTenantScript', () => {
  it('skips any insertion into users, ownership changes and transaction control', () => {
    const sql = [
      'BEGIN;',
      'CREATE TABLE users (id integer);',
      "INSERT INTO users (name, role) VALUES ('Root', 'superadmin') ON CONFLICT DO NOTHING;",
      "insert into public.users values (2, 'x');",
      'INSERT INTO "users" (id) VALUES (3);',
      "INSERT INTO settings (key, value) VALUES ('a', 'b');",
      'INSERT INTO users_log VALUES (1);',
      'ALTER TABLE users OWNER TO postgres;',
      'COMMIT;',
    ].join('\n');
    const prepared = prepareTenantScript(sql, 'tenant-schema.sql');
    expect(prepared.statements).toEqual([
      'CREATE TABLE users (id integer)',
      "INSERT INTO settings (key, value) VALUES ('a', 'b')",
      'INSERT INTO users_log VALUES (1)',
    ]);
    expect(prepared.skipped).toHaveLength(4);
  });

  it('allows the extensions of ADR-0008', () => {
    const prepared = prepareTenantScript(
      'CREATE EXTENSION IF NOT EXISTS unaccent; CREATE EXTENSION IF NOT EXISTS pg_trgm;',
      'x.sql',
    );
    expect(prepared.statements).toHaveLength(2);
  });

  it.each([
    'CREATE DATABASE otra',
    'DROP DATABASE apreu_x',
    'ALTER DATABASE apreu_x OWNER TO y',
    'GRANT ALL ON ALL TABLES IN SCHEMA public TO x',
    "CREATE ROLE x LOGIN PASSWORD 'x'",
    'CREATE USER x',
    'SET ROLE postgres',
    'SET SESSION AUTHORIZATION postgres',
    "ALTER SYSTEM SET log_statement = 'all'",
    "COPY t FROM '/etc/passwd'",
    "COPY t TO PROGRAM 'rm -rf /'",
    'CREATE EXTENSION dblink',
    'CREATE EXTENSION IF NOT EXISTS file_fdw',
    "SELECT pg_read_file('/etc/passwd')",
    "CREATE TABLESPACE x LOCATION '/tmp'",
  ])('aborts on forbidden statement: %s', (sql) => {
    expect(() => prepareTenantScript(`${sql};`, 'x.sql')).toThrow(expect.objectContaining({ code: 'FORBIDDEN_SQL' }));
  });
});

describe('database/postgres (real files)', () => {
  const root = resolve(__dirname, '../../../../../database/postgres');
  const schema = join(root, 'tenant-schema.sql');

  it.skipIf(!existsSync(schema))('tenant-schema.sql parses without seeded users or forbidden SQL', () => {
    const prepared = prepareTenantScript(readFileSync(schema, 'utf8'), 'tenant-schema.sql');
    const tables = prepared.statements.filter((s) => /^CREATE TABLE/i.test(s));
    expect(tables.length).toBeGreaterThanOrEqual(50);
    expect(prepared.statements.some((s) => /^INSERT\s+INTO\s+"?users"?/i.test(s))).toBe(false);
  });

  it.skipIf(!existsSync(join(root, 'migrations')))('every migration parses under the safety policy', () => {
    const dir = join(root, 'migrations');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
      expect(() => prepareTenantScript(readFileSync(join(dir, file), 'utf8'), file)).not.toThrow();
    }
  });
});
