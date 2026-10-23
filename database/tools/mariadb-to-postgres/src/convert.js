// Funciones puras de conversión MariaDB -> PostgreSQL (sin E/S; cubiertas por test/).
// Reglas: database/postgres/TYPE-MAP.md y ADR-0008.
import { createHash } from 'node:crypto';

/** Marcador: insertar la palabra clave DEFAULT en lugar de un valor. */
export const DEFAULT = Symbol('DEFAULT');

export const SEVERITY = { ERROR: 'error', WARNING: 'warning' };

/**
 * Catálogo de conflictos. `severity: error` aborta salvo que sea corregible y se use --fix;
 * `warning` nunca aborta (la corrección solo se aplica con --fix).
 */
export const ISSUES = {
  ZERO_DATE: { severity: 'error', text: 'fecha cero o incompleta (PG la rechaza)', fix: 'NULL si la columna admite NULL; si no, DEFAULT de la columna' },
  ENUM_EMPTY: { severity: 'error', text: "valor '' en enum (MariaDB no estricto)", fix: 'DEFAULT de la columna; si no tiene, NULL si admite NULL' },
  ENUM_CASE: { severity: 'error', text: 'valor de enum que solo coincide ignorando mayúsculas/espacios', fix: 'se reemplaza por el valor canónico del CHECK' },
  ENUM_INVALID: { severity: 'error', text: 'valor fuera de la lista del CHECK', fix: null },
  JSON_INVALID: { severity: 'error', text: 'JSON inválido o vacío en columna jsonb', fix: "NULL si admite NULL; si no, '{}'" },
  NUL_CHAR: { severity: 'error', text: 'carácter NUL (\\0 o \\u0000) que PG no admite en text/jsonb', fix: 'se elimina el carácter' },
  BOOL_RANGE: { severity: 'error', text: 'bandera tinyint distinta de 0/1', fix: 'distinto de 0 -> true' },
  INT_RANGE: { severity: 'error', text: 'entero fuera del rango del tipo PG', fix: null },
  TIME_RANGE: { severity: 'error', text: 'time fuera de 00:00:00-24:00:00', fix: null },
  TOO_LONG: { severity: 'error', text: 'texto más largo que el varchar destino', fix: null },
  NOT_NULL: { severity: 'error', text: 'NULL en columna NOT NULL del destino', fix: 'DEFAULT de la columna si tiene' },
  FK_ORPHAN: { severity: 'error', text: 'referencia a una fila inexistente (FK)', fix: 'NULL si la columna admite NULL' },
  UNIQUE_DUP: { severity: 'error', text: 'duplicado exacto en un índice único de PG', fix: null },
  UNIQUE_CI_DUP: { severity: 'error', text: 'valores de un índice único que solo difieren en mayúsculas/tildes/espacios finales', fix: null },
  UNIQUE_TRAILING_SPACE: { severity: 'warning', text: 'clave única con espacios al final (MariaDB los ignoraba al comparar)', fix: 'se quitan los espacios finales' },
  EMAIL_CASE: { severity: 'warning', text: 'correo con mayúsculas en columna con índice único lower(email)', fix: 'se guarda en minúscula' },
};

// ---------------------------------------------------------------- tipos ---

const INT_RANGES = {
  smallint: [-32768n, 32767n],
  integer: [-2147483648n, 2147483647n],
  bigint: [-9223372036854775808n, 9223372036854775807n],
};

/**
 * Decide cómo convertir una columna a partir de su tipo en ambos motores.
 * @param {{dataType:string, columnType:string, precision?:number}} src  information_schema de MariaDB
 * @param {{dataType:string, formatType:string, nullable:boolean, hasDefault:boolean, defaultLiteral?:any, maxLength?:number|null, enumValues?:string[]|null}} tgt
 * @param {{datetimeZone?:string}} [opts]
 */
export function planColumn(name, src, tgt, opts = {}) {
  const datetimeZone = opts.datetimeZone ?? 'America/Bogota';
  const base = {
    name,
    pgType: tgt.formatType,
    nullable: tgt.nullable,
    hasDefault: tgt.hasDefault,
    defaultLiteral: tgt.defaultLiteral,
    srcType: src.columnType,
    unique: false,
    lowerUnique: false,
  };
  const s = src.dataType.toLowerCase();
  const t = tgt.dataType.toLowerCase();
  if (t === 'boolean') return { ...base, kind: 'bool' };
  if (t in INT_RANGES) return { ...base, kind: s === 'year' ? 'year' : 'int', range: INT_RANGES[t] };
  if (t === 'numeric') return { ...base, kind: 'numeric' };
  if (t === 'timestamp with time zone') {
    if (s === 'timestamp') return { ...base, kind: 'timestamp', zone: 'UTC', fsp: src.precision ?? 0 };
    return { ...base, kind: 'timestamp', zone: datetimeZone, fsp: src.precision ?? 0 };
  }
  if (t === 'timestamp without time zone') return { ...base, kind: 'timestamp', zone: null, fsp: src.precision ?? 0 };
  if (t === 'date') return { ...base, kind: 'date' };
  if (t.startsWith('time')) return { ...base, kind: 'time' };
  if (t === 'jsonb' || t === 'json') return { ...base, kind: 'json' };
  if (t === 'bytea') return { ...base, kind: 'bytes' };
  if (tgt.enumValues && tgt.enumValues.length) return { ...base, kind: 'enum', enumValues: tgt.enumValues, maxLength: tgt.maxLength ?? null };
  return { ...base, kind: 'text', maxLength: tgt.maxLength ?? null };
}

// --------------------------------------------------------------- fechas ---

/** true para 0000-00-00, meses/días 00 o año 0000 (MariaDB los permite, PG no). */
export function isZeroDate(raw) {
  if (typeof raw !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!m) return false;
  return m[1] === '0000' || m[2] === '00' || m[3] === '00';
}

/**
 * Literal timestamptz para un valor leído con `dateStrings: true`.
 * `datetime` del legacy = hora local de `zone` (America/Bogota); `timestamp` = UTC.
 * Se usa el nombre de zona IANA (PG aplica el desfase histórico correcto, p. ej. el
 * horario de verano de Colombia 1992-1993) en lugar de un desfase fijo.
 */
export function toTimestamptzLiteral(raw, zone) {
  if (zone === 'UTC') return `${raw}+00`;
  return `${raw} ${zone}`;
}

// ---------------------------------------------------------------- enum ---

/** Valores de un CHECK de enum, tal como lo devuelve pg_get_constraintdef. */
export function parseEnumCheck(def) {
  if (typeof def !== 'string') return null;
  if (/ANY\s*\(/i.test(def)) {
    const arr = /ARRAY\[(.*)\]/s.exec(def);
    if (!arr) return null;
    return [...arr[1].matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
  }
  const single = /^CHECK \(\(\(?[a-z_"]+\)?(?:::text)? = '((?:[^']|'')*)'/i.exec(def);
  if (single) return [single[1].replace(/''/g, "'")];
  return null;
}

// --------------------------------------------------------------- textos ---

/** Longitud en caracteres (puntos de código), como cuentan MariaDB y PG. */
export function charLength(s) {
  let n = 0;
  for (const _ of s) n++; // eslint-disable-line no-unused-vars
  return n;
}

/** Clave "laxa" con la semántica de utf8mb4_general_ci: sin mayúsculas, tildes ni espacios finales. */
export function looseKey(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ +$/, '');
}

// ----------------------------------------------------------------- JSON ---

export function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
}

// ----------------------------------------------------------- conversión ---

/**
 * Valor literal de un DEFAULT de PG ('TI'::character varying, 0, true, '2'::character varying...).
 * Devuelve undefined si es una expresión (now(), identidad...).
 */
export function parseDefaultLiteral(def) {
  if (def === null || def === undefined) return undefined;
  const d = String(def).trim();
  let m = /^'((?:[^']|'')*)'(?:::[a-z ]+(?:\(\d+(?:,\d+)?\))?)?$/i.exec(d);
  if (m) return m[1].replace(/''/g, "'");
  m = /^\(?(-?\d+(?:\.\d+)?)\)?(?:::[a-z ]+)?$/i.exec(d);
  if (m) return m[1];
  if (d === 'true' || d === 'false') return d === 'true';
  return undefined;
}

function defaultValue(col) {
  return col.defaultLiteral !== undefined ? col.defaultLiteral : DEFAULT;
}

function defaultRule(col) {
  return col.defaultLiteral !== undefined ? `DEFAULT (${JSON.stringify(col.defaultLiteral)})` : 'DEFAULT';
}

function fixNullOrDefault(col, preferDefault) {
  if (preferDefault && col.hasDefault) return { ok: true, value: defaultValue(col), rule: defaultRule(col) };
  if (col.nullable) return { ok: true, value: null, rule: 'NULL' };
  if (col.hasDefault) return { ok: true, value: defaultValue(col), rule: defaultRule(col) };
  return { ok: false };
}

function issue(code, fixed, rule) {
  return { code, severity: ISSUES[code].severity, fixed, rule: rule ?? null };
}

/**
 * Convierte un valor crudo de mysql2 (dateStrings, bigNumberStrings, decimales como string)
 * al parámetro que se envía a PG.
 * @returns {{value:any, issues:Array<{code:string,severity:string,fixed:boolean,rule:string|null}>}}
 *   Si hay un issue de error no corregido, `value` es el valor sin corregir (no se debe insertar).
 */
export function convertValue(col, raw, opts = {}) {
  const fix = !!opts.fix;
  const issues = [];
  if (raw === null || raw === undefined) {
    if (!col.nullable) {
      if (col.hasDefault) {
        issues.push(issue('NOT_NULL', fix, defaultRule(col)));
        return { value: fix ? defaultValue(col) : null, issues };
      }
      issues.push(issue('NOT_NULL', false));
    }
    return { value: null, issues };
  }

  if (opts.orphans && opts.orphans.has(String(raw))) {
    if (col.nullable) { issues.push(issue('FK_ORPHAN', fix, 'NULL')); if (fix) return { value: null, issues }; }
    else issues.push(issue('FK_ORPHAN', false));
  }

  switch (col.kind) {
    case 'bool': {
      const n = Number(raw);
      if (n === 0) return { value: false, issues };
      if (n === 1) return { value: true, issues };
      issues.push(issue('BOOL_RANGE', fix, 'true'));
      return { value: fix ? true : raw, issues };
    }
    case 'year':
    case 'int': {
      if (col.kind === 'year' && Number(raw) === 0) {
        const f = fixNullOrDefault(col, false);
        issues.push(issue('ZERO_DATE', fix && f.ok, f.rule));
        return { value: fix && f.ok ? f.value : raw, issues };
      }
      const b = BigInt(raw);
      if (col.range && (b < col.range[0] || b > col.range[1])) issues.push(issue('INT_RANGE', false));
      return { value: String(raw), issues };
    }
    case 'numeric':
      return { value: String(raw), issues };
    case 'date':
    case 'timestamp': {
      const s = String(raw);
      if (isZeroDate(s)) {
        const f = fixNullOrDefault(col, false);
        issues.push(issue('ZERO_DATE', fix && f.ok, f.rule));
        return { value: fix && f.ok ? f.value : s, issues };
      }
      if (col.kind === 'date') return { value: s, issues };
      return { value: col.zone ? toTimestamptzLiteral(s, col.zone) : s, issues };
    }
    case 'time': {
      const s = String(raw);
      const m = /^(-?)(\d+):(\d{2}):(\d{2})(\.\d+)?$/.exec(s);
      if (!m || m[1] === '-' || Number(m[2]) > 24 || (Number(m[2]) === 24 && (m[3] !== '00' || m[4] !== '00'))) {
        issues.push(issue('TIME_RANGE', false));
      }
      return { value: s, issues };
    }
    case 'json': {
      let s = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
      if (/\u0000|\\u0000/.test(s)) {
        issues.push(issue('NUL_CHAR', fix, 'strip'));
        if (fix) s = s.replace(/\u0000/g, '').replace(/\\u0000/g, '');
      }
      try {
        if (s.trim() === '') throw new Error('empty');
        JSON.parse(s);
        return { value: s, issues };
      } catch {
        const rule = col.nullable ? 'NULL' : "'{}'";
        issues.push(issue('JSON_INVALID', fix, rule));
        return { value: fix ? (col.nullable ? null : '{}') : s, issues };
      }
    }
    case 'bytes':
      return { value: Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw)), issues };
    case 'enum': {
      const s = String(raw);
      if (col.enumValues.includes(s)) return { value: s, issues };
      if (s.trim() === '') {
        const f = fixNullOrDefault(col, true);
        issues.push(issue('ENUM_EMPTY', fix && f.ok, f.rule));
        return { value: fix && f.ok ? f.value : s, issues };
      }
      const canon = col.enumValues.find((v) => v.toLowerCase() === s.trim().toLowerCase());
      if (canon !== undefined) {
        issues.push(issue('ENUM_CASE', fix, canon));
        return { value: fix ? canon : s, issues };
      }
      issues.push(issue('ENUM_INVALID', false));
      return { value: s, issues };
    }
    default: {
      let s = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
      if (s.includes('\u0000')) {
        issues.push(issue('NUL_CHAR', fix, 'strip'));
        if (fix) s = s.replace(/\u0000/g, '');
      }
      if (col.unique && / +$/.test(s)) {
        issues.push(issue('UNIQUE_TRAILING_SPACE', fix, 'rtrim'));
        if (fix) s = s.replace(/ +$/, '');
      }
      if (col.lowerUnique && s !== s.toLowerCase()) {
        issues.push(issue('EMAIL_CASE', fix, 'lower'));
        if (fix) s = s.toLowerCase();
      }
      if (col.maxLength && s.length > col.maxLength && charLength(s) > col.maxLength) issues.push(issue('TOO_LONG', false));
      return { value: s, issues };
    }
  }
}

/** true si el issue impide continuar (error no corregido). */
export function isBlocking(i) {
  return i.severity === 'error' && !i.fixed;
}

// -------------------------------------------- representación canónica ---
// Para la suma de control por fila: el valor de origen (crudo de mysql2) y el de destino
// (renderizado a texto en el SELECT de PG, ver pgRenderExpr) deben producir la misma cadena.

export const NULL_TOKEN = '\\N';

export function normalizeDecimal(s) {
  if (s === null || s === undefined) return NULL_TOKEN;
  let str = String(s).trim();
  let neg = false;
  if (str.startsWith('-')) { neg = true; str = str.slice(1); } else if (str.startsWith('+')) str = str.slice(1);
  let [int, frac = ''] = str.split('.');
  int = int.replace(/^0+(?=\d)/, '') || '0';
  frac = frac.replace(/0+$/, '');
  const out = frac ? `${int}.${frac}` : int;
  return neg && out !== '0' ? `-${out}` : out;
}

/** Cadena canónica de un valor de origen (MariaDB) ya convertido/corregido o crudo. */
export function canonicalSource(col, raw) {
  if (raw === null || raw === undefined) return NULL_TOKEN;
  switch (col.kind) {
    case 'bool': return Number(raw) === 0 || raw === false ? '0' : '1';
    case 'int': case 'year': return String(raw);
    case 'numeric': return normalizeDecimal(raw);
    case 'json': return canonicalJson(JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)));
    case 'bytes': return (Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw))).toString('hex');
    default: return Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
  }
}

/** Cadena canónica de un valor leído de PG con pgRenderExpr. */
export function canonicalTarget(col, v) {
  if (v === null || v === undefined) return NULL_TOKEN;
  switch (col.kind) {
    case 'numeric': return normalizeDecimal(v);
    case 'json': return canonicalJson(typeof v === 'string' ? JSON.parse(v) : v);
    default: return String(v);
  }
}

export function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/** Expresión SQL de PG que renderiza la columna en el formato textual de MariaDB. */
export function pgRenderExpr(col) {
  const c = quoteIdent(col.name);
  switch (col.kind) {
    case 'bool': return `CASE WHEN ${c} THEN '1' WHEN NOT ${c} THEN '0' END`;
    case 'int': case 'year': case 'numeric': case 'time': return `${c}::text`;
    case 'date': return `to_char(${c}, 'YYYY-MM-DD')`;
    case 'timestamp': {
      const fmt = col.fsp > 0 ? 'YYYY-MM-DD HH24:MI:SS.US' : 'YYYY-MM-DD HH24:MI:SS';
      const expr = col.zone ? `${c} AT TIME ZONE '${col.zone}'` : c;
      const base = `to_char(${expr}, '${fmt}')`;
      return col.fsp > 0 && col.fsp < 6 ? `left(${base}, ${20 + col.fsp})` : base;
    }
    case 'json': return `${c}::text`;
    case 'bytes': return `encode(${c}, 'hex')`;
    default: return `${c}::text`;
  }
}

// ------------------------------------------------------ sumas de control ---

const MOD = 1n << 128n;

/**
 * Resumen independiente del orden: suma (mod 2^128) del md5 de cada elemento.
 * Equivale a "md5 de los ids ordenados" sin depender de la colación de cada motor
 * (hay PK de texto: settings.key, hr_sequences.name, ...).
 */
export class Digest {
  constructor() { this.acc = 0n; this.count = 0; }
  add(str) {
    this.acc = (this.acc + BigInt(`0x${createHash('md5').update(str).digest('hex')}`)) % MOD;
    this.count++;
  }
  hex() { return this.acc.toString(16).padStart(32, '0'); }
}

export const FIELD_SEP = '\u001f';

// ------------------------------------------------------------- orden FK ---

/**
 * Orden topológico de tablas por FK (padres primero). Ignora autorreferencias; si hay
 * ciclos, agrega las restantes al final en orden alfabético (la carga usa
 * session_replication_role = replica cuando es posible y valida FKs al final).
 * @param {string[]} tables
 * @param {Array<{table:string, refTable:string}>} fks
 */
export function topoSort(tables, fks) {
  const set = new Set(tables);
  const deps = new Map(tables.map((t) => [t, new Set()]));
  for (const fk of fks) {
    if (fk.table !== fk.refTable && set.has(fk.table) && set.has(fk.refTable)) deps.get(fk.table).add(fk.refTable);
  }
  const out = [];
  const done = new Set();
  let progress = true;
  while (progress) {
    progress = false;
    for (const t of [...tables].sort()) {
      if (done.has(t)) continue;
      if ([...deps.get(t)].every((d) => done.has(d))) { out.push(t); done.add(t); progress = true; }
    }
  }
  for (const t of [...tables].sort()) if (!done.has(t)) out.push(t);
  return out;
}

/** Filas por sentencia INSERT respetando el límite de 65535 parámetros de PG. */
export function rowsPerInsert(batch, ncols) {
  return Math.max(1, Math.min(batch, Math.floor(65535 / Math.max(1, ncols))));
}

/** Indica la columna de un índice único de PG a partir de pg_get_indexdef(oid, k, true). */
export function parseIndexColumn(expr) {
  const e = expr.trim();
  let m = /^"?([a-z_][a-z0-9_]*)"?$/i.exec(e);
  if (m) return { column: m[1], lower: false };
  m = /^lower\(\(?"?([a-z_][a-z0-9_]*)"?\)?(?:::text)?\)$/i.exec(e);
  if (m) return { column: m[1], lower: true };
  return null;
}
