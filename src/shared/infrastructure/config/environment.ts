/**
 * Typed configuration of the superadmin API, read from environment variables.
 *
 * Validated once at startup so the rest of the code can rely on well-formed
 * values. Secrets never have defaults (legacy bug #1: credentials hard-coded
 * in `superadmin/config/db.php`).
 */
export interface Environment {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  corsOrigins: string[];
  /** Express `trust proxy` (`TRUST_PROXY`); `false` when the API is not behind a reverse proxy. */
  trustProxy: number | string | false;
  /** Platform JWT: must differ from the school ERP secret. */
  jwt: { secret: string; expiresIn: string };
  /** Throttling of `POST /auth/login` (attempts per window). */
  loginThrottle: { limit: number; ttlMs: number };
  /** Master database holding `tenants` and the superadmin `users`. */
  masterDb: DatabaseConnection & { database: string };
  /** Server hosting one database per school. */
  tenantDb: {
    host: string;
    port: number;
    /** Account with `CREATEDB` used only for provisioning (and dropping in the compensation). */
    admin: Credentials;
    /**
     * Optional role that owns every school database and its objects (the
     * account `apreu-api` connects with). `null` = the provisioning account.
     */
    owner: string | null;
    /** Database the provisioning account connects to for `CREATE/DROP DATABASE`. */
    maintenanceDatabase: string;
    /** Account used for the read-only analytics queries (falls back to `admin`). */
    reader: Credentials;
    databasePrefix: string;
    connectTimeoutMs: number;
  };
  provisioning: {
    /** Path to `database/postgres/tenant-schema.sql` (consolidated school schema). */
    schemaFile: string;
    /** Folder with the idempotent `NNN-*.sql` migrations applied after the schema (`null` = none). */
    migrationsDir: string | null;
    /** Public URL of a school; `{slug}` is replaced. */
    publicUrlTemplate: string;
  };
  analytics: {
    /** Max number of tenant databases queried at the same time. */
    concurrency: number;
    /** Per-tenant timeout for the analytics queries. */
    queryTimeoutMs: number;
    /** IANA time zone used to compute "this month". */
    timeZone: string;
  };
  /**
   * School ERP (`apreu-api`) internal API, used to invalidate its tenant cache
   * after lifecycle changes. Disabled when `baseUrl` or `internalToken` is empty.
   */
  apreuApi: {
    /** `APREU_API_URL` without trailing slash, e.g. `http://apreu-api:3000`. */
    baseUrl: string | null;
    /** `APREU_INTERNAL_API_TOKEN`: must equal `INTERNAL_API_TOKEN` of apreu-api. */
    internalToken: string | null;
    timeoutMs: number;
  };
}

export interface Credentials {
  username: string;
  password: string;
}

export interface DatabaseConnection extends Credentials {
  host: string;
  port: number;
}

export const ENVIRONMENT = Symbol('Environment');

const required = (env: NodeJS.ProcessEnv, key: string): string => {
  const value = env[key];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Variable de entorno obligatoria no definida: ${key}`);
  }
  return value;
};

const integer = (env: NodeJS.ProcessEnv, key: string, fallback: number): number => {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) throw new Error(`La variable ${key} debe ser un número entero positivo.`);
  return parsed;
};

const DATABASE_PREFIX_PATTERN = /^[a-z][a-z0-9_]{0,15}$/;
const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

/** Optional role name; restricted to `[a-z0-9_]` because it is interpolated as a quoted identifier. */
const roleName = (env: NodeJS.ProcessEnv, key: string): string | null => {
  const value = env[key]?.trim();
  if (!value) return null;
  if (!ROLE_PATTERN.test(value)) throw new Error(`${key} solo admite minúsculas, dígitos y "_" (máx. 63).`);
  return value;
};

/** Optional `APREU_API_URL` (http/https), normalized without trailing slashes. */
const apreuApiUrl = (env: NodeJS.ProcessEnv): string | null => {
  const raw = env.APREU_API_URL?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('APREU_API_URL debe ser una URL absoluta (http o https).');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('APREU_API_URL debe usar http o https.');
  }
  return raw.replace(/\/+$/, '');
};

/**
 * `TRUST_PROXY`: Express `trust proxy` (number of proxies or their IPs/subnets) so `req.ip`,
 * which keys the throttler, is the client and not the reverse proxy. Empty = off: with the API
 * exposed directly, trusting `X-Forwarded-For` would let clients spoof their IP.
 */
const trustProxy = (env: NodeJS.ProcessEnv): number | string | false => {
  const raw = env.TRUST_PROXY?.trim();
  if (!raw || raw === 'false' || raw === '0') return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  if (raw === 'true') {
    throw new Error(
      'TRUST_PROXY=true confía en cualquier X-Forwarded-For; indique el número de proxies (p. ej. 1) o sus IP.',
    );
  }
  return raw;
};

const migrationsDir = (raw: string | undefined): string | null => {
  const value = raw?.trim();
  if (value === 'none') return null;
  return value || 'database/postgres/migrations';
};

/** Builds and validates the {@link Environment}; throws on the first invalid value. */
export const loadEnvironment = (env: NodeJS.ProcessEnv = process.env): Environment => {
  const nodeEnv = (env.NODE_ENV ?? 'development') as Environment['nodeEnv'];
  if (!['development', 'production', 'test'].includes(nodeEnv)) {
    throw new Error(`NODE_ENV inválido: ${nodeEnv}`);
  }

  const jwtSecret = required(env, 'SUPERADMIN_JWT_SECRET');
  if (nodeEnv === 'production' && jwtSecret.length < 32) {
    throw new Error('SUPERADMIN_JWT_SECRET debe tener al menos 32 caracteres en producción.');
  }
  if (env.JWT_SECRET && env.JWT_SECRET === jwtSecret) {
    throw new Error('SUPERADMIN_JWT_SECRET no puede ser igual al JWT_SECRET del ERP de colegios.');
  }

  const databasePrefix = env.TENANT_DB_PREFIX ?? 'apreu_';
  if (!DATABASE_PREFIX_PATTERN.test(databasePrefix)) {
    throw new Error('TENANT_DB_PREFIX solo admite minúsculas, dígitos y "_" (máx. 16).');
  }

  const admin: Credentials = {
    username: required(env, 'TENANT_DB_ADMIN_USER'),
    password: env.TENANT_DB_ADMIN_PASSWORD ?? '',
  };
  // The reader receives GRANTs on every new school, so its name is interpolated as an identifier.
  const readerUser = roleName(env, 'TENANT_DB_READER_USER');
  const reader: Credentials = readerUser
    ? {
        username: readerUser,
        password: env.TENANT_DB_READER_PASSWORD ?? '',
      }
    : admin;

  return {
    nodeEnv,
    port: integer(env, 'PORT', 3100),
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:4200')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    trustProxy: trustProxy(env),
    jwt: {
      secret: jwtSecret,
      expiresIn: env.SUPERADMIN_JWT_EXPIRES_IN ?? '2h',
    },
    loginThrottle: {
      limit: integer(env, 'LOGIN_THROTTLE_LIMIT', 5),
      ttlMs: integer(env, 'LOGIN_THROTTLE_TTL_SECONDS', 60) * 1000,
    },
    masterDb: {
      host: required(env, 'MASTER_DB_HOST'),
      port: integer(env, 'MASTER_DB_PORT', 5432),
      username: required(env, 'MASTER_DB_USER'),
      password: env.MASTER_DB_PASSWORD ?? '',
      database: required(env, 'MASTER_DB_NAME'),
    },
    tenantDb: {
      host: required(env, 'TENANT_DB_HOST'),
      port: integer(env, 'TENANT_DB_PORT', 5432),
      admin,
      reader,
      owner: roleName(env, 'TENANT_DB_OWNER'),
      maintenanceDatabase: env.TENANT_DB_MAINTENANCE_DB?.trim() || 'postgres',
      databasePrefix,
      connectTimeoutMs: integer(env, 'TENANT_DB_CONNECT_TIMEOUT_MS', 5000),
    },
    provisioning: {
      schemaFile: env.TENANT_SCHEMA_FILE?.trim() || 'database/postgres/tenant-schema.sql',
      // `none` disables the migrations (the consolidated schema already includes the v2 changes up to its date).
      migrationsDir: migrationsDir(env.TENANT_MIGRATIONS_DIR),
      publicUrlTemplate: env.TENANT_PUBLIC_URL_TEMPLATE ?? 'https://apreu.co/{slug}',
    },
    analytics: {
      concurrency: Math.max(1, integer(env, 'ANALYTICS_CONCURRENCY', 4)),
      queryTimeoutMs: integer(env, 'ANALYTICS_QUERY_TIMEOUT_MS', 8000),
      timeZone: env.APP_TIME_ZONE ?? 'America/Bogota',
    },
    apreuApi: {
      baseUrl: apreuApiUrl(env),
      internalToken: env.APREU_INTERNAL_API_TOKEN?.trim() || null,
      timeoutMs: Math.max(1, integer(env, 'APREU_API_TIMEOUT_MS', 3000)),
    },
  };
};
