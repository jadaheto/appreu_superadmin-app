// Orquestación: preflight -> conflictos -> copia en una transacción -> secuencias -> FK -> verificación.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import pg from 'pg';
import {
  DEFAULT, FIELD_SEP, ISSUES, Digest, canonicalSource, canonicalTarget, convertValue, isBlocking,
  looseKey, normalizeDecimal, pgRenderExpr, planColumn, quoteIdent, rowsPerInsert, topoSort,
} from './convert.js';
import { MASTER_MARKERS, TENANT_MARKERS, mariaSchema, missingMigrations, pgCounts, pgSchema } from './introspect.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_DATABASE_DIR = path.resolve(HERE, '../../..');

/** Tablas que tenant-schema.sql siembra: su contenido no cuenta como "BD con datos" y se reemplaza por el del origen. */
export const SEED_TABLES = new Set(['settings', 'payroll_parameters', 'hr_sequences']);

class Abort extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const bq = (n) => `\`${String(n).replace(/`/g, '``')}\``;

function connInfo(url, database) {
  const u = new URL(url);
  return { host: u.hostname, port: u.port ? Number(u.port) : undefined, user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database };
}

async function* streamRows(conn, sql) {
  const stream = conn.connection.query({ sql, rowsAsArray: true }).stream({ highWaterMark: 500 });
  for await (const row of stream) yield row;
}

// ------------------------------------------------------------ reporte ---

function newReport(opts) {
  return {
    tool: 'apreu mariadb-to-postgres',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    mode: opts.master ? 'master' : 'tenant',
    tenant: opts.tenant ?? null,
    source: { db: opts.sourceDb },
    target: { db: opts.targetDb, created: false },
    options: { fix: !!opts.fix, dryRun: !!opts.dryRun, verifyOnly: !!opts.verifyOnly, truncate: !!opts.truncate, batch: opts.batch, datetimeZone: opts.datetimeZone },
    status: 'running',
    message: null,
    migrationsMissing: [],
    warnings: [],
    skippedColumns: [],
    conflicts: [],
    fkOrphans: [],
    replicationRole: null,
    sequences: [],
    verification: [],
    totals: null,
  };
}

// ---------------------------------------------------------------- main ---

/**
 * @param {object} opts  ver src/args.js
 * @param {(msg:string)=>void} log
 */
export async function migrate(opts, log = () => {}) {
  const report = newReport(opts);
  let src; let admin; let tgt; let inTx = false;
  try {
    // ---------------------------------------------------- (a) preflight ---
    src = await mysql.createConnection({
      ...connInfo(opts.source, opts.sourceDb),
      dateStrings: true, supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false,
      timezone: 'Z', charset: 'utf8mb4',
    });
    await src.query("SET time_zone = '+00:00'");
    await src.query('SET SESSION group_concat_max_len = 1048576');
    await src.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await src.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    const mSchema = await mariaSchema(src);
    if (!mSchema.size) throw new Abort('preflight_failed', `La BD origen ${opts.sourceDb} no tiene tablas`);
    report.migrationsMissing = missingMigrations(mSchema, opts.master ? MASTER_MARKERS : TENANT_MARKERS);
    if (report.migrationsMissing.length) {
      throw new Abort('preflight_failed', 'La BD origen no tiene aplicadas todas las migraciones MariaDB de la v2 (database/mariadb/migrations); aplíquelas sobre la copia antes de importar');
    }
    log(`origen ${opts.sourceDb}: ${mSchema.size} tablas, migraciones v2 presentes`);

    const tInfo = connInfo(opts.target, opts.targetDb);
    admin = new pg.Client({ ...tInfo, database: new URL(opts.target).pathname.slice(1) || 'postgres' });
    await admin.connect();
    const exists = (await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [opts.targetDb])).rowCount > 0;
    if (!exists) {
      if (!opts.createDb) throw new Abort('preflight_failed', `La BD destino ${opts.targetDb} no existe (use --create-db)`);
      if (opts.dryRun) throw new Abort('preflight_failed', `La BD destino ${opts.targetDb} no existe; --dry-run no la crea (ejecute sin --dry-run o créela antes)`);
      await admin.query(`CREATE DATABASE ${quoteIdent(opts.targetDb)}`);
      report.target.created = true;
      log(`BD ${opts.targetDb} creada`);
    }
    await admin.end(); admin = null;

    tgt = new pg.Client({ ...tInfo, database: opts.targetDb });
    await tgt.connect();
    await tgt.query("SET TimeZone = 'UTC'");
    if (report.target.created) {
      const schemaFile = opts.schemaFile ?? path.join(REPO_DATABASE_DIR, 'postgres', opts.master ? 'master-schema.sql' : 'tenant-schema.sql');
      await tgt.query(await readFile(schemaFile, 'utf8')); // archivo completo en una sola query (tiene $func$ ... ; ... $func$)
      const migDir = opts.migrationsDir ?? path.join(REPO_DATABASE_DIR, 'postgres', opts.master ? 'master-migrations' : 'migrations');
      const files = (await readdir(migDir).catch(() => [])).filter((f) => /^\d+.*\.sql$/.test(f)).sort();
      for (const f of files) await tgt.query(await readFile(path.join(migDir, f), 'utf8'));
      report.target.schemaApplied = [path.relative(REPO_DATABASE_DIR, schemaFile), ...files.map((f) => path.relative(REPO_DATABASE_DIR, path.join(migDir, f)))];
      log(`esquema aplicado: ${report.target.schemaApplied.join(', ')}`);
    }
    const { tables: pTables, fks } = await pgSchema(tgt);
    if (!pTables.size) throw new Abort('preflight_failed', `La BD destino ${opts.targetDb} no tiene el esquema (aplique database/postgres/${opts.master ? 'master' : 'tenant'}-schema.sql o use --create-db sobre una BD inexistente)`);

    const missingTables = [...mSchema.keys()].filter((t) => !pTables.has(t));
    if (missingTables.length) throw new Abort('preflight_failed', `Tablas del origen que no existen en el destino: ${missingTables.join(', ')}`);
    for (const t of pTables.keys()) if (!mSchema.has(t)) report.warnings.push(`Tabla ${t} solo existe en el destino: queda como la deja el esquema`);

    // Plan de columnas por tabla
    const tables = topoSort([...mSchema.keys()], fks);
    const plans = new Map();
    const missingCols = [];
    for (const t of tables) {
      const m = mSchema.get(t); const p = pTables.get(t);
      for (const [name, c] of m.columns) {
        if (!p.columns.has(name)) { if (!c.generated) missingCols.push(`${t}.${name}`); }
      }
      const cols = [];
      for (const [name, pc] of p.columns) {
        const mc = m.columns.get(name);
        if (!mc) { if (!pc.generated) report.warnings.push(`Columna ${t}.${name} solo existe en el destino: toma su DEFAULT`); continue; }
        if (mc.generated || pc.generated) { report.skippedColumns.push({ table: t, column: name, reason: 'columna generada: PG la recalcula' }); continue; }
        cols.push(planColumn(name, mc, pc, { datetimeZone: opts.datetimeZone }));
      }
      const byName = new Map(cols.map((c) => [c.name, c]));
      const uniques = [];
      for (const u of p.uniques) {
        if (u.partial || u.parts.some((x) => !x || !byName.has(x.column))) {
          report.warnings.push(`Índice único ${u.name} (${u.exprs.join(', ')}) no se revisa en origen: ${u.partial ? 'parcial' : 'expresión o columna generada'}; PG lo valida al insertar`);
          continue;
        }
        for (const part of u.parts) {
          const c = byName.get(part.column);
          if (c.kind === 'text' || c.kind === 'enum') { c.unique = true; if (part.lower) c.lowerUnique = true; }
        }
        uniques.push({ ...u, idx: u.parts.map((x) => ({ i: cols.indexOf(byName.get(x.column)), lower: x.lower })) });
      }
      for (const def of p.otherChecks) report.warnings.push(`CHECK no de enum en ${t}: ${def} (PG lo valida al insertar)`);
      const pkIdx = (p.pk.length ? p.pk : m.pk).map((n) => cols.findIndex((c) => c.name === n)).filter((i) => i >= 0);
      plans.set(t, { table: t, cols, uniques, pkIdx, identity: [...p.columns.values()].filter((c) => c.identity).map((c) => c.name) });
    }
    if (missingCols.length) throw new Abort('preflight_failed', `Columnas del origen que no existen en el destino (se perderían): ${missingCols.join(', ')}`);

    // Idempotencia
    const counts = await pgCounts(tgt, tables);
    const nonEmpty = Object.entries(counts).filter(([t, n]) => n > 0 && !SEED_TABLES.has(t));
    if (nonEmpty.length && !opts.truncate && !opts.dryRun && !opts.verifyOnly) {
      throw new Abort('target_not_empty', `La BD destino ya tiene datos (${nonEmpty.map(([t, n]) => `${t}=${n}`).join(', ')}); use --truncate para reemplazarlos`);
    }
    if (nonEmpty.length && !opts.verifyOnly) report.warnings.push(`El destino tenía datos que se reemplazarán: ${nonEmpty.map(([t, n]) => `${t}=${n}`).join(', ')}`);

    // ------------------------------------------- (b) detección de conflictos ---
    const orphans = await findOrphans(src, fks, plans, report);
    const conflicts = new Map();
    const addConflict = (t, colName, iss, pkVal, raw) => {
      const key = `${iss.code}|${t}|${colName}`;
      let c = conflicts.get(key);
      if (!c) {
        c = { code: iss.code, severity: iss.severity, table: t, column: colName, description: ISSUES[iss.code].text, fixRule: ISSUES[iss.code].fix, count: 0, fixed: 0, unfixable: 0, appliedRule: null, samples: [] };
        conflicts.set(key, c);
      }
      c.count++;
      if (iss.fixed) { c.fixed++; c.appliedRule = iss.rule; }
      if (!iss.rule && iss.severity === 'error') c.unfixable++;
      if (c.samples.length < 5) c.samples.push({ pk: pkVal, value: raw === undefined ? undefined : (typeof raw === 'string' && raw.length > 80 ? `${raw.slice(0, 80)}…` : raw) });
    };
    for (const t of tables) {
      const plan = plans.get(t);
      const exact = plan.uniques.map(() => new Map());
      const loose = plan.uniques.map(() => new Map());
      const sql = `SELECT ${plan.cols.map((c) => bq(c.name)).join(', ')} FROM ${bq(t)}`;
      for await (const row of streamRows(src, sql)) {
        const pkVal = plan.pkIdx.map((i) => row[i]).join(',');
        const values = new Array(plan.cols.length);
        plan.cols.forEach((col, i) => {
          const r = convertValue(col, row[i], { fix: opts.fix, orphans: orphans.get(`${t}.${col.name}`) });
          for (const iss of r.issues) addConflict(t, col.name, iss, pkVal, row[i]);
          values[i] = r.value;
        });
        plan.uniques.forEach((u, k) => {
          const vals = u.idx.map(({ i }) => values[i]);
          if (vals.some((v) => v === null || v === DEFAULT)) return;
          const ex = u.idx.map(({ i, lower }) => (lower ? String(values[i]).toLowerCase() : String(values[i]))).join(FIELD_SEP);
          const lo = u.idx.map(({ i }) => looseKey(values[i])).join(FIELD_SEP);
          if (exact[k].has(ex)) addConflict(t, u.name, { code: 'UNIQUE_DUP', severity: 'error', fixed: false }, `${exact[k].get(ex)} y ${pkVal}`, ex);
          else if (loose[k].has(lo)) addConflict(t, u.name, { code: 'UNIQUE_CI_DUP', severity: 'error', fixed: false }, `${loose[k].get(lo).pk} y ${pkVal}`, `${loose[k].get(lo).v} / ${ex}`);
          exact[k].set(ex, pkVal);
          if (!loose[k].has(lo)) loose[k].set(lo, { pk: pkVal, v: ex });
        });
      }
    }
    report.conflicts = [...conflicts.values()];
    const blocking = report.conflicts.filter((c) => c.severity === 'error' && c.fixed < c.count);
    const fixedCols = new Set(report.conflicts.filter((c) => c.fixed > 0).map((c) => `${c.table}.${c.column}`));
    log(`conflictos: ${report.conflicts.length} tipos (${blocking.length} bloqueantes)`);
    if (opts.verifyOnly) {
      await runVerification(src, tgt, tables, plans, orphans, opts, fixedCols, report);
      report.status = report.totals.tablesOk === report.totals.tables ? 'ok' : 'verification_failed';
      report.message = report.status === 'ok' ? 'Solo verificación: origen y destino coinciden' : 'Solo verificación: hay diferencias entre origen y destino';
      return report;
    }
    if (blocking.length) {
      throw new Abort('conflicts', `Hay ${blocking.length} conflicto(s) que fallarían en PostgreSQL${opts.fix ? ' y no tienen corrección automática' : ' (revise el reporte; use --fix para aplicar las correcciones registradas)'}`);
    }
    if (opts.dryRun) throw new Abort('dry_run', 'Ensayo (--dry-run): sin conflictos bloqueantes; no se escribió nada');

    // ------------------------------------------------------- (c) copia ---
    await tgt.query('BEGIN');
    inTx = true;
    await tgt.query('SAVEPOINT replica');
    try {
      await tgt.query('SET LOCAL session_replication_role = replica');
      await tgt.query('RELEASE SAVEPOINT replica');
      report.replicationRole = 'replica (FK y triggers desactivados durante la carga; FK validadas al final)';
    } catch (e) {
      await tgt.query('ROLLBACK TO SAVEPOINT replica');
      report.replicationRole = `origin (sin permiso para replica: ${e.message}); carga en orden de FK`;
    }
    await tgt.query(`TRUNCATE ${tables.map(quoteIdent).join(', ')} RESTART IDENTITY CASCADE`);
    for (const t of tables) {
      const plan = plans.get(t);
      if (!plan.cols.length) continue;
      const perStmt = rowsPerInsert(opts.batch, plan.cols.length);
      const head = `INSERT INTO ${quoteIdent(t)} (${plan.cols.map((c) => quoteIdent(c.name)).join(', ')}) VALUES `;
      let buf = []; let n = 0;
      const flush = async () => {
        if (!buf.length) return;
        const params = []; const tuples = [];
        for (const vals of buf) {
          tuples.push(`(${vals.map((v, i) => {
            if (v === DEFAULT) return 'DEFAULT';
            params.push(v);
            return `$${params.length}::${plan.cols[i].pgType}`;
          }).join(', ')})`);
        }
        await tgt.query(head + tuples.join(', '), params);
        n += buf.length; buf = [];
      };
      const sql = `SELECT ${plan.cols.map((c) => bq(c.name)).join(', ')} FROM ${bq(t)}${plan.pkIdx.length ? ` ORDER BY ${plan.pkIdx.map((i) => bq(plan.cols[i].name)).join(', ')}` : ''}`;
      for await (const row of streamRows(src, sql)) {
        buf.push(plan.cols.map((col, i) => convertValue(col, row[i], { fix: opts.fix, orphans: orphans.get(`${t}.${col.name}`) }).value));
        if (buf.length >= perStmt) await flush();
      }
      await flush();
      log(`  ${t}: ${n} filas`);
    }

    // -------------------------------------------- (d) secuencias de identidad ---
    for (const t of tables) {
      for (const c of plans.get(t).identity) {
        const r = await tgt.query(
          `SELECT setval(pg_get_serial_sequence($1, $2), COALESCE(MAX(${quoteIdent(c)}), 1), MAX(${quoteIdent(c)}) IS NOT NULL)::text AS v,
                  MAX(${quoteIdent(c)})::text AS max FROM ${quoteIdent(t)}`,
          [quoteIdent(t), c],
        );
        report.sequences.push({ table: t, column: c, max: r.rows[0].max, next: r.rows[0].max === null ? '1' : String(BigInt(r.rows[0].max) + 1n) });
      }
    }
    await tgt.query('SET LOCAL session_replication_role = origin').catch(() => {});

    // Validación de FK (la carga con replica no las comprobó)
    const fkErrors = [];
    for (const fk of fks.filter((f) => plans.has(f.table) && plans.has(f.refTable))) {
      const cond = fk.cols.map((c, i) => `p.${quoteIdent(fk.refCols[i])} = c.${quoteIdent(c)}`).join(' AND ');
      const notNull = fk.cols.map((c) => `c.${quoteIdent(c)} IS NOT NULL`).join(' AND ');
      const r = await tgt.query(`SELECT count(*)::int AS n FROM ${quoteIdent(fk.table)} c WHERE ${notNull} AND NOT EXISTS (SELECT 1 FROM ${quoteIdent(fk.refTable)} p WHERE ${cond})`);
      if (r.rows[0].n > 0) fkErrors.push(`${fk.name}: ${r.rows[0].n} fila(s) huérfanas`);
    }
    if (fkErrors.length) throw new Abort('fk_failed', `FK inválidas tras la carga: ${fkErrors.join('; ')}`);

    // --------------------------------------------------- (e) verificación ---
    const allOk = await runVerification(src, tgt, tables, plans, orphans, opts, fixedCols, report);
    if (!allOk) throw new Abort('verification_failed', 'La verificación no coincide; se hizo ROLLBACK (el destino quedó como estaba)');
    await tgt.query('COMMIT');
    inTx = false;
    for (const t of tables) await tgt.query(`ANALYZE ${quoteIdent(t)}`);
    report.status = 'ok';
    report.message = `Importación completa y verificada: ${report.totals.tables} tablas, ${report.totals.targetRows} filas`;
  } catch (e) {
    if (inTx) { await tgt.query('ROLLBACK').catch(() => {}); inTx = false; }
    if (e instanceof Abort) { report.status = e.status; report.message = e.message; } else { report.status = 'error'; report.message = e.stack || String(e); }
    if (report.target.created && report.status !== 'ok') report.warnings.push(`La BD ${opts.targetDb} se creó con el esquema y quedó sin datos; puede reintentarse o borrarse (DROP DATABASE)`);
  } finally {
    await src?.query('ROLLBACK').catch(() => {});
    await src?.end().catch(() => {});
    await admin?.end().catch(() => {});
    await tgt?.end().catch(() => {});
    report.finishedAt = new Date().toISOString();
  }
  return report;
}

// ------------------------------------------------------------ huérfanos ---

async function findOrphans(src, fks, plans, report) {
  const out = new Map();
  for (const fk of fks) {
    if (!plans.has(fk.table) || !plans.has(fk.refTable)) continue;
    const cond = fk.cols.map((c, i) => `p.${bq(fk.refCols[i])} = c.${bq(c)}`).join(' AND ');
    const notNull = fk.cols.map((c) => `c.${bq(c)} IS NOT NULL`).join(' AND ');
    const [rows] = await src.query(
      `SELECT DISTINCT ${fk.cols.map((c) => `c.${bq(c)}`).join(', ')} FROM ${bq(fk.table)} c
        WHERE ${notNull} AND NOT EXISTS (SELECT 1 FROM ${bq(fk.refTable)} p WHERE ${cond}) LIMIT 10000`,
    );
    if (!rows.length) continue;
    report.fkOrphans.push({ fk: fk.name, table: fk.table, columns: fk.cols, refTable: fk.refTable, distinctValues: rows.length, samples: rows.slice(0, 5) });
    if (fk.cols.length === 1) {
      const key = `${fk.table}.${fk.cols[0]}`;
      const set = out.get(key) ?? new Set();
      for (const r of rows) set.add(String(r[fk.cols[0]]));
      out.set(key, set);
    } else {
      report.conflicts.push({ code: 'FK_ORPHAN', severity: 'error', table: fk.table, column: fk.cols.join(','), description: ISSUES.FK_ORPHAN.text, fixRule: null, count: rows.length, fixed: 0, unfixable: rows.length, samples: rows.slice(0, 5) });
    }
  }
  return out;
}

// --------------------------------------------------------- verificación ---

async function runVerification(src, tgt, tables, plans, orphans, opts, fixedCols, report) {
  for (const t of tables) report.verification.push(await verifyTable(src, tgt, plans.get(t), orphans, opts, fixedCols));
  report.totals = {
    tables: report.verification.length,
    sourceRows: report.verification.reduce((a, v) => a + v.sourceRows, 0),
    targetRows: report.verification.reduce((a, v) => a + v.targetRows, 0),
    tablesOk: report.verification.filter((v) => v.ok).length,
  };
  return report.totals.tablesOk === report.totals.tables;
}

async function verifyTable(src, tgt, plan, orphans, opts, fixedCols) {
  const t = plan.table;
  // Columnas corregidas a DEFAULT no son comparables (el valor lo decide PG); las demás correcciones se aplican al origen.
  const excluded = new Set();
  const srcIds = new Digest(); const srcRows = new Digest();
  const sql = `SELECT ${plan.cols.map((c) => bq(c.name)).join(', ')} FROM ${bq(t)}`;
  for await (const row of streamRows(src, sql)) {
    const parts = plan.cols.map((col, i) => {
      if (!fixedCols.has(`${t}.${col.name}`)) return canonicalSource(col, row[i]);
      const r = convertValue(col, row[i], { fix: opts.fix, orphans: orphans.get(`${t}.${col.name}`) });
      if (r.value === DEFAULT) { excluded.add(i); return ''; }
      return r.issues.some((x) => x.fixed) ? canonicalSource(col, r.value) : canonicalSource(col, row[i]);
    });
    srcIds.add(plan.pkIdx.map((i) => parts[i]).join(FIELD_SEP));
    srcRows.add(parts.map((p, i) => (excluded.has(i) ? '' : p)).join(FIELD_SEP));
  }
  if (excluded.size) {
    // Recalcular sin las columnas excluidas para que ambos lados usen el mismo conjunto
    srcRows.acc = 0n; srcRows.count = 0;
    for await (const row of streamRows(src, sql)) {
      const parts = plan.cols.map((col, i) => {
        if (excluded.has(i)) return '';
        if (!fixedCols.has(`${t}.${col.name}`)) return canonicalSource(col, row[i]);
        const r = convertValue(col, row[i], { fix: opts.fix, orphans: orphans.get(`${t}.${col.name}`) });
        return r.issues.some((x) => x.fixed) ? canonicalSource(col, r.value) : canonicalSource(col, row[i]);
      });
      srcRows.add(parts.join(FIELD_SEP));
    }
  }

  const tgtIds = new Digest(); const tgtRows = new Digest();
  const pkNames = plan.pkIdx.map((i) => plan.cols[i].name);
  const select = plan.cols.map((c, i) => `${pgRenderExpr(c)} AS c${i}`).concat(pkNames.map((n, i) => `${quoteIdent(n)} AS k${i}`)).join(', ');
  const order = pkNames.map((n) => `${quoteIdent(t)}.${quoteIdent(n)}`).join(', ');
  let last = null;
  const pageSize = Math.max(opts.batch, 1000);
  for (;;) {
    const params = [];
    let where = '';
    if (last && pkNames.length) {
      where = ` WHERE (${order}) > (${last.map((v) => { params.push(v); return `$${params.length}`; }).join(', ')})`;
    }
    const q = `SELECT ${select} FROM ${quoteIdent(t)}${where}${pkNames.length ? ` ORDER BY ${order} LIMIT ${pageSize}` : ''}`;
    const res = await tgt.query({ text: q, values: params, rowMode: 'array' });
    for (const row of res.rows) {
      const parts = plan.cols.map((col, i) => (excluded.has(i) ? '' : canonicalTarget(col, row[i])));
      tgtIds.add(plan.pkIdx.map((i) => canonicalTarget(plan.cols[i], row[i])).join(FIELD_SEP));
      tgtRows.add(parts.join(FIELD_SEP));
    }
    if (!pkNames.length || res.rows.length < pageSize) break;
    last = res.rows[res.rows.length - 1].slice(plan.cols.length);
  }

  // Sumas de columnas numeric/decimal (en SQL de cada motor, aritmética exacta)
  const numCols = plan.cols.filter((c) => c.kind === 'numeric' && !fixedCols.has(`${t}.${c.name}`));
  const sums = [];
  if (numCols.length) {
    const [[ms]] = await src.query({ sql: `SELECT ${numCols.map((c) => `CAST(SUM(${bq(c.name)}) AS CHAR)`).join(', ')} FROM ${bq(t)}`, rowsAsArray: true });
    const ps = (await tgt.query({ text: `SELECT ${numCols.map((c) => `SUM(${quoteIdent(c.name)})::text`).join(', ')} FROM ${quoteIdent(t)}`, rowMode: 'array' })).rows[0];
    numCols.forEach((c, i) => sums.push({ column: c.name, source: normalizeDecimal(ms[i]), target: normalizeDecimal(ps[i]) }));
  }
  const sumsOk = sums.every((s) => s.source === s.target);
  const v = {
    table: t,
    sourceRows: srcRows.count,
    targetRows: tgtRows.count,
    idsDigest: { source: srcIds.hex(), target: tgtIds.hex() },
    rowsDigest: { source: srcRows.hex(), target: tgtRows.hex() },
    numericSums: sums,
    excludedColumns: [...excluded].map((i) => plan.cols[i].name),
  };
  v.ok = v.sourceRows === v.targetRows && v.idsDigest.source === v.idsDigest.target && v.rowsDigest.source === v.rowsDigest.target && sumsOk;
  return v;
}
