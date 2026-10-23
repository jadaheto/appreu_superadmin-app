// Lectura de catálogos de MariaDB (information_schema) y PostgreSQL (pg_catalog).
import { parseDefaultLiteral, parseEnumCheck, parseIndexColumn } from './convert.js';

// --------------------------------------------------------------- MariaDB ---

export async function mariaSchema(conn) {
  const [tables] = await conn.query(
    `SELECT table_name AS name FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name`,
  );
  const [cols] = await conn.query(
    `SELECT table_name AS t, column_name AS name, data_type AS dataType, column_type AS columnType,
            is_nullable = 'YES' AS nullable, datetime_precision AS \`precision\`,
            (is_generated = 'ALWAYS' OR extra LIKE '%GENERATED%') AS \`generated\`
       FROM information_schema.columns WHERE table_schema = DATABASE()
      ORDER BY table_name, ordinal_position`,
  );
  const [pks] = await conn.query(
    `SELECT table_name AS t, column_name AS name FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND index_name = 'PRIMARY' ORDER BY table_name, seq_in_index`,
  );
  const [idx] = await conn.query(
    `SELECT DISTINCT table_name AS t, index_name AS name FROM information_schema.statistics WHERE table_schema = DATABASE()`,
  );
  const out = new Map();
  for (const { name } of tables) out.set(name, { name, columns: new Map(), pk: [], indexes: new Set() });
  for (const c of cols) {
    const t = out.get(c.t);
    if (!t) continue;
    t.columns.set(c.name, {
      name: c.name,
      dataType: c.dataType,
      columnType: c.columnType,
      nullable: !!Number(c.nullable),
      precision: c.precision === null ? 0 : Number(c.precision),
      generated: !!Number(c.generated),
    });
  }
  for (const p of pks) out.get(p.t)?.pk.push(p.name);
  for (const i of idx) out.get(i.t)?.indexes.add(i.name);
  return out;
}

/**
 * Marcas de las 11 migraciones MariaDB de la v2 (database/mariadb/migrations) y de la
 * migración de la BD maestra. Cada una se comprueba por tablas/columnas/índices que crea.
 */
export const TENANT_MARKERS = [
  { migration: '001-identity-001', checks: [['users', 'must_change_password']] },
  { migration: '002-students-001', checks: [['student_code_sequences'], ['certificates', 'verification_code'], ['certificates', 'snapshot'], ['guardians', 'user_id']] },
  { migration: '003-finance-001', checks: [['finance_receipt_sequences']] },
  { migration: '004-finance-002', checks: [['student_charges', 'billing_period']] },
  { migration: '005-finance-003', checks: [['payments', 'voided_at'], ['payments', 'void_reason']] },
  { migration: '006-accounting-001', checks: [['accounting_posting_rules'], ['accounting_sequences'], ['accounting_journal_entries', 'posted_at'], ['accounting_periods', 'reopened_at']] },
  { migration: '007-inventory-001', checks: [['inventory_movements']] },
  { migration: '008-communications-001', checks: [['whatsapp_log', null, 'idx_wa_message_id'], ['notifications', null, 'idx_user_read']] },
  { migration: '009-academic-001', checks: [['group_directors', 'active_classroom_id'], ['attendance_records', 'source']] },
  { migration: '010-hr-001', checks: [['hr_sequences'], ['employees', 'integral_salary'], ['payroll_payments', 'worked_days'], ['employee_leaves', 'decided_at']] },
  { migration: '011-e-invoicing-001', checks: [['dian_document_submissions'], ['dian_invoices', 'numbering_cycle'], ['dian_consecutives', 'technical_key']] },
];

export const MASTER_MARKERS = [
  { migration: 'master-001-tenants-lifecycle', checks: [['tenants', 'db_name'], ['tenants', 'trial_ends_at'], ['tenants', 'deleted_at']] },
  { migration: 'users (superadmin-api)', checks: [['users', 'must_change_password']] },
];

/** Devuelve las migraciones cuya marca no está en el esquema MariaDB. */
export function missingMigrations(schema, markers) {
  const missing = [];
  for (const m of markers) {
    const failed = m.checks.filter(([t, c, i]) => {
      const tab = schema.get(t);
      if (!tab) return true;
      if (c && !tab.columns.has(c)) return true;
      if (i && !tab.indexes.has(i)) return true;
      return false;
    });
    if (failed.length) missing.push({ migration: m.migration, missing: failed.map(([t, c, i]) => [t, c ?? i].filter(Boolean).join('.')) });
  }
  return missing;
}

// ------------------------------------------------------------ PostgreSQL ---

export async function pgSchema(client) {
  const tables = (await client.query(
    `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r','p') ORDER BY 1`,
  )).rows;
  const cols = (await client.query(
    `SELECT c.table_name AS t, c.column_name AS name, c.data_type AS "dataType",
            format_type(a.atttypid, a.atttypmod) AS "formatType",
            c.is_nullable = 'YES' AS nullable, c.character_maximum_length AS "maxLength",
            (c.column_default IS NOT NULL OR c.is_identity = 'YES') AS "hasDefault",
            c.column_default AS "columnDefault", c.is_identity = 'YES' AS identity, a.attgenerated <> '' AS generated
       FROM information_schema.columns c
       JOIN pg_attribute a ON a.attrelid = format('public.%I', c.table_name)::regclass AND a.attname = c.column_name
      WHERE c.table_schema = 'public' ORDER BY c.table_name, c.ordinal_position`,
  )).rows;
  const checks = (await client.query(
    `SELECT cl.relname AS t, a.attname AS col, pg_get_constraintdef(co.oid) AS def
       FROM pg_constraint co JOIN pg_class cl ON cl.oid = co.conrelid
       JOIN pg_namespace n ON n.oid = cl.relnamespace
       JOIN pg_attribute a ON a.attrelid = co.conrelid AND a.attnum = co.conkey[1]
      WHERE n.nspname = 'public' AND co.contype = 'c' AND array_length(co.conkey, 1) = 1`,
  )).rows;
  const idx = (await client.query(
    `SELECT cl.relname AS t, ic.relname AS name, i.indisprimary AS primary, i.indpred IS NOT NULL AS partial,
            array(SELECT pg_get_indexdef(i.indexrelid, k, true) FROM generate_series(1, i.indnkeyatts) k ORDER BY k) AS exprs
       FROM pg_index i JOIN pg_class cl ON cl.oid = i.indrelid JOIN pg_class ic ON ic.oid = i.indexrelid
       JOIN pg_namespace n ON n.oid = cl.relnamespace
      WHERE n.nspname = 'public' AND i.indisunique ORDER BY 1, 2`,
  )).rows;
  const fks = (await client.query(
    `SELECT co.conname AS name, cl.relname AS "table", rf.relname AS "refTable",
            array(SELECT a.attname FROM unnest(co.conkey) WITH ORDINALITY k(n, o) JOIN pg_attribute a ON a.attrelid = co.conrelid AND a.attnum = k.n ORDER BY k.o)::text[] AS cols,
            array(SELECT a.attname FROM unnest(co.confkey) WITH ORDINALITY k(n, o) JOIN pg_attribute a ON a.attrelid = co.confrelid AND a.attnum = k.n ORDER BY k.o)::text[] AS "refCols"
       FROM pg_constraint co JOIN pg_class cl ON cl.oid = co.conrelid JOIN pg_class rf ON rf.oid = co.confrelid
       JOIN pg_namespace n ON n.oid = cl.relnamespace
      WHERE n.nspname = 'public' AND co.contype = 'f' ORDER BY 2, 1`,
  )).rows;

  const out = new Map();
  for (const { name } of tables) out.set(name, { name, columns: new Map(), pk: [], uniques: [], otherChecks: [] });
  for (const c of cols) {
    out.get(c.t)?.columns.set(c.name, { ...c, maxLength: c.maxLength === null ? null : Number(c.maxLength), enumValues: null, defaultLiteral: c.identity ? undefined : parseDefaultLiteral(c.columnDefault) });
  }
  for (const ch of checks) {
    const t = out.get(ch.t);
    if (!t) continue;
    const values = parseEnumCheck(ch.def);
    if (values && t.columns.has(ch.col)) t.columns.get(ch.col).enumValues = values;
    else t.otherChecks.push(ch.def);
  }
  for (const i of idx) {
    const t = out.get(i.t);
    if (!t) continue;
    const parts = i.exprs.map(parseIndexColumn);
    if (i.primary) t.pk = parts.map((p) => p.column);
    t.uniques.push({ name: i.name, primary: i.primary, partial: i.partial, parts, exprs: i.exprs });
  }
  return { tables: out, fks };
}

/** Filas por tabla en PG (count exacto). */
export async function pgCounts(client, tables) {
  const counts = {};
  for (const t of tables) {
    counts[t] = Number((await client.query(`SELECT count(*)::bigint AS n FROM "${t}"`)).rows[0].n);
  }
  return counts;
}
