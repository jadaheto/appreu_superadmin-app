// Infraestructura del sembrador: argumentos, cliente HTTP con limitador por ruta,
// acceso SQL (solo para lo que la API no permite), PRNG determinista y utilidades de fechas.
import bcrypt from 'bcryptjs';
import pg from 'pg';

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------
export const CONFIG = {
  apiUrl: process.env.APREU_API_URL ?? 'http://apreu-dev-api:3000/api',
  superadminUrl: process.env.SUPERADMIN_API_URL ?? 'http://superadmin-dev-api:3100/api/platform/v1',
  superadmin: {
    email: process.env.SUPERADMIN_EMAIL ?? 'super@apreu.co',
    password: process.env.SUPERADMIN_PASSWORD ?? 'Super2026x',
  },
  pg: {
    host: process.env.PGHOST ?? 'apreu-dev-pg',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD ?? 'postgres',
  },
  masterDb: process.env.MASTER_DB_NAME ?? 'apreu_master',
  /** Fecha de negocio "hoy" (la API usa el reloj real; solo se usa para planear). */
  today: process.env.SEED_TODAY ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date()),
  /** Límite propio por ruta (la API permite 300/min por IP y por handler; login 10/min). */
  perRouteLimit: 280,
  loginLimit: 9,
};

export function parseArgs(argv) {
  const args = { tenant: 'demo', size: null, reset: false, all: false, verify: false, only: null, skip: [], saveBaseline: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--tenant') args.tenant = next();
    else if (a === '--size') args.size = next();
    else if (a === '--reset') args.reset = true;
    else if (a === '--all') args.all = true;
    else if (a === '--verify') args.verify = true;
    else if (a === '--only') args.only = next().split(',');
    else if (a === '--skip') args.skip = next().split(',');
    else if (a === '--save-baseline') args.saveBaseline = next();
    else if (a === '--make-e2e-fixture') args.makeFixture = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`Argumento desconocido: ${a}`);
  }
  return args;
}

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------
const started = Date.now();
export const log = (...parts) => {
  const s = ((Date.now() - started) / 1000).toFixed(0).padStart(4);
  console.log(`[${s}s]`, ...parts);
};
export const warn = (...parts) => console.warn('  ⚠', ...parts);

// ---------------------------------------------------------------------------
// Limitador por ruta (ventana deslizante de 60 s)
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const windows = new Map();
async function acquire(key, limit) {
  for (;;) {
    const now = Date.now();
    const list = (windows.get(key) ?? []).filter((t) => now - t < 60_000);
    windows.set(key, list);
    if (list.length < limit) {
      list.push(now);
      return;
    }
    await sleep(list[0] + 60_050 - now);
  }
}
const routeKey = (method, path) =>
  `${method} ${path.split('?')[0].replace(/\/\d+(?=\/|$)/g, '/:id').replace(/\/(REC|al)[\w-]+$/i, '/:code')}`;

export class ApiError extends Error {
  constructor(method, path, status, body) {
    super(`${method} ${path} → ${status} ${typeof body === 'string' ? body.slice(0, 400) : JSON.stringify(body).slice(0, 600)}`);
    this.status = status;
    this.body = body;
  }
}

/** Cliente HTTP mínimo con `X-Tenant`, token y reintentos ante 429. */
export class HttpClient {
  constructor(baseUrl, headers = {}) {
    this.baseUrl = baseUrl;
    this.headers = headers;
    this.count = 0;
  }

  async request(method, path, body, { token, allow = [], raw = false } = {}) {
    const key = routeKey(method, path);
    const isLogin = /\/(auth\/login)$/.test(path);
    for (let attempt = 0; ; attempt++) {
      await acquire(this.baseUrl + key, isLogin ? CONFIG.loginLimit : CONFIG.perRouteLimit);
      const headers = { ...this.headers };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (token) headers.Authorization = `Bearer ${token}`;
      let res;
      try {
        res = await fetch(this.baseUrl + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      } catch (error) {
        if (attempt < 5) {
          await sleep(1000 * (attempt + 1));
          continue;
        }
        throw error;
      }
      this.count++;
      if (res.status === 429 && attempt < 10) {
        const retry = Number(res.headers.get('retry-after') ?? res.headers.get('retry-after-default') ?? 10);
        warn(`429 en ${key}; espero ${retry}s`);
        await sleep((Number.isFinite(retry) ? retry : 10) * 1000 + 250);
        continue;
      }
      const text = raw ? null : await res.text();
      let parsed = text;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          /* texto plano */
        }
      }
      if (res.ok) return raw ? res : parsed;
      if (allow.includes(res.status)) return { __status: res.status, ...(typeof parsed === 'object' ? parsed : { body: parsed }) };
      throw new ApiError(method, path, res.status, parsed);
    }
  }

  get = (path, opts) => this.request('GET', path, undefined, opts);
  post = (path, body = {}, opts) => this.request('POST', path, body, opts);
  put = (path, body = {}, opts) => this.request('PUT', path, body, opts);
  patch = (path, body = {}, opts) => this.request('PATCH', path, body, opts);
  delete = (path, opts) => this.request('DELETE', path, undefined, opts);
}

/** Sesión autenticada sobre un colegio de apreu-api. */
export class TenantApi {
  constructor(slug) {
    this.slug = slug;
    this.http = new HttpClient(CONFIG.apiUrl, { 'X-Tenant': slug });
    this.token = null;
  }

  async login(email, password) {
    const res = await this.http.post('/auth/login', { email, password });
    return res.accessToken;
  }

  /** Devuelve un cliente "atado" a un token. */
  as(token) {
    const http = this.http;
    return {
      get: (p, o) => http.get(p, { ...o, token }),
      post: (p, b, o) => http.post(p, b, { ...o, token }),
      put: (p, b, o) => http.put(p, b, { ...o, token }),
      patch: (p, b, o) => http.patch(p, b, { ...o, token }),
      delete: (p, o) => http.delete(p, { ...o, token }),
    };
  }

  /** Recorre todas las páginas de un listado paginado `{items,total}` o arreglo. */
  async all(client, path, limit = 200) {
    const sep = path.includes('?') ? '&' : '?';
    const first = await client.get(`${path}${sep}page=1&limit=${limit}`);
    if (Array.isArray(first)) return first;
    const items = [...(first.items ?? [])];
    const total = first.total ?? items.length;
    for (let page = 2; items.length < total; page++) {
      const next = await client.get(`${path}${sep}page=${page}&limit=${limit}`);
      if (!next.items?.length) break;
      items.push(...next.items);
    }
    return items;
  }
}

// ---------------------------------------------------------------------------
// SQL directo (cada uso está documentado en README.md, sección "SQL directo")
// ---------------------------------------------------------------------------
export async function withDb(database, work) {
  const client = new pg.Client({ ...CONFIG.pg, database });
  await client.connect();
  try {
    await client.query("SET TIME ZONE 'America/Bogota'");
    return await work(client);
  } finally {
    await client.end();
  }
}

export async function tenantDbName(slug) {
  return withDb(CONFIG.masterDb, async (db) => {
    const { rows } = await db.query('SELECT db_name FROM tenants WHERE slug = $1', [slug]);
    if (!rows.length) return null;
    return rows[0].db_name || `apreu_${slug.replace(/-/g, '_')}`;
  });
}

const hashCache = new Map();
export function hashPassword(password) {
  if (!hashCache.has(password)) hashCache.set(password, bcrypt.hashSync(password, 10));
  return hashCache.get(password);
}

/**
 * SQL #1 — contraseñas conocidas. La API solo genera contraseñas temporales aleatorias
 * (devueltas una vez) con cambio obligatorio, y el login admite 10 intentos/min por IP.
 */
export async function setKnownPasswords(dbName, emails, password) {
  if (!emails.length) return 0;
  return withDb(dbName, async (db) => {
    const res = await db.query(
      'UPDATE users SET password = $1, must_change_password = false WHERE lower(email) = ANY($2::text[])',
      [hashPassword(password), emails.map((e) => e.toLowerCase())],
    );
    return res.rowCount;
  });
}

// ---------------------------------------------------------------------------
// Snapshot / reset (SQL #0): estado conocido del colegio
// ---------------------------------------------------------------------------
const SKIP_TABLES = new Set(['schema_migrations']);

async function userTables(db) {
  const { rows } = await db.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  return rows.map((r) => r.tablename).filter((t) => !SKIP_TABLES.has(t));
}

/** Copia todas las filas de la BD a un objeto JSON `{tabla: filas[]}`. */
export async function snapshot(dbName) {
  return withDb(dbName, async (db) => {
    const out = {};
    for (const table of await userTables(db)) {
      const { rows } = await db.query(`SELECT to_jsonb(t) AS r FROM "${table}" t`);
      out[table] = rows.map((r) => r.r);
    }
    return out;
  });
}

/** Vacía el colegio y restaura el snapshot (incluidos los contadores de las columnas identity). */
export async function restore(dbName, data) {
  return withDb(dbName, async (db) => {
    const tables = await userTables(db);
    await db.query('BEGIN');
    try {
      await db.query(`TRUNCATE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
      await db.query("SET LOCAL session_replication_role = 'replica'");
      for (const table of tables) {
        const rows = data[table] ?? [];
        if (!rows.length) continue;
        const { rows: cols } = await db.query(
          `SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1 AND is_generated = 'NEVER' ORDER BY ordinal_position`,
          [table],
        );
        const list = cols.map((c) => `"${c.column_name}"`).join(', ');
        await db.query(
          `INSERT INTO "${table}" (${list}) OVERRIDING SYSTEM VALUE
           SELECT ${list} FROM jsonb_populate_recordset(NULL::"${table}", $1::jsonb)`,
          [JSON.stringify(rows)],
        );
      }
      const { rows: seqs } = await db.query(
        `SELECT c.table_name, c.column_name, pg_get_serial_sequence(format('%I', c.table_name), c.column_name) AS seq
           FROM information_schema.columns c
          WHERE c.table_schema = 'public' AND (c.is_identity = 'YES' OR c.column_default LIKE 'nextval%')`,
      );
      for (const { table_name, column_name, seq } of seqs) {
        if (!seq) continue;
        await db.query(
          `SELECT setval($1, COALESCE((SELECT max("${column_name}") FROM "${table_name}"), 0) + 1, false)`,
          [seq],
        );
      }
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  });
}

// ---------------------------------------------------------------------------
// PRNG determinista (mulberry32) para que cada corrida genere los mismos datos
// ---------------------------------------------------------------------------
export function rng(seedText) {
  let h = 1779033703 ^ seedText.length;
  for (let i = 0; i < seedText.length; i++) {
    h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
    shuffle: (list) => {
      const a2 = [...list];
      for (let i = a2.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a2[i], a2[j]] = [a2[j], a2[i]];
      }
      return a2;
    },
    weighted: (pairs) => {
      const total = pairs.reduce((s, [, w]) => s + w, 0);
      let x = next() * total;
      for (const [v, w] of pairs) {
        if ((x -= w) < 0) return v;
      }
      return pairs[pairs.length - 1][0];
    },
    /** Normal aproximada (Box-Muller). */
    normal: (mean, sd) => mean + sd * Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next()),
    digits: (n) => Array.from({ length: n }, () => Math.floor(next() * 10)).join(''),
  };
  return r;
}

// ---------------------------------------------------------------------------
// Fechas (YYYY-MM-DD, calendario de Bogotá)
// ---------------------------------------------------------------------------
export const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const weekday = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay(); // 0 = domingo
export const lastDayOfMonth = (year, month) => new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
export const minDate = (a, b) => (a < b ? a : b);
export const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Ejecuta `fn` sobre los elementos con `n` tareas en paralelo. */
export async function pool(items, n, fn) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export const round1 = (x) => Math.round(x * 10) / 10;
export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const slugEmail = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ñ/g, 'n')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '');
