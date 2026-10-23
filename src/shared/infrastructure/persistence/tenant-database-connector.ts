import { Inject, Injectable } from '@nestjs/common';
import pg from 'pg';
import { ENVIRONMENT, type Environment } from '../config/environment.js';

/** Minimal SQL session over one connection to the tenants server. */
export interface SqlSession {
  /** Runs one statement (placeholders `$1, $2, …`) and returns its rows (empty for DDL/DML). */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

/** Opens sessions against the tenants server. Abstracted so adapters can be unit tested. */
export interface TenantDatabaseConnector {
  /**
   * Session on the maintenance database (`TENANT_DB_MAINTENANCE_DB`, `postgres`)
   * with the provisioning account, in autocommit mode: `CREATE/DROP DATABASE`
   * cannot run inside a transaction block.
   */
  openServerSession(): Promise<SqlSession>;
  /** Session on a tenant database with the provisioning account (`TimeZone` of the school). */
  openProvisioningSession(database: string): Promise<SqlSession>;
  /** Read-only session (READ ONLY transaction) with the reader account and a per-statement timeout. */
  openReadOnlySession(database: string, queryTimeoutMs: number): Promise<SqlSession>;
}

export const TENANT_DATABASE_CONNECTOR = Symbol('TenantDatabaseConnector');

/** PostgreSQL identifiers are truncated at 63 bytes (NAMEDATALEN − 1). */
const IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

/** Fails fast if a database or role name could break out of its double quotes. */
export const assertSafeDatabaseName = (database: string): void => {
  if (!IDENTIFIER_PATTERN.test(database)) {
    throw new Error(`Nombre de base de datos no permitido: ${database}`);
  }
};

/**
 * Quotes a validated identifier (`"apreu_norte"`). Only `[a-z0-9_]` names are
 * accepted, so the result can never contain a quote; the quoting keeps the
 * name literal even if it matches a keyword.
 */
export const quoteIdentifier = (identifier: string): string => {
  assertSafeDatabaseName(identifier);
  return `"${identifier}"`;
};

/** `-c` options sent in the startup packet (no extra round trip). */
const startupOptions = (settings: Record<string, string | number>): string =>
  Object.entries(settings)
    .map(([key, value]) => `-c ${key}=${String(value).replace(/[\\ ]/g, (c) => `\\${c}`)}`)
    .join(' ');

/**
 * Type parsers of the tenant sessions: `date` and `timestamp` (without zone)
 * stay as the strings sent by the server instead of becoming JS `Date`s in the
 * process time zone. `numeric` and `bigint` already arrive as strings.
 */
const tenantTypes = {
  getTypeParser: (oid: number, format?: 'text' | 'binary') => {
    if (oid === pg.types.builtins.DATE || oid === pg.types.builtins.TIMESTAMP) return (value: string) => value;
    return pg.types.getTypeParser(oid, format);
  },
};

class PgSession implements SqlSession {
  constructor(
    private readonly client: pg.Client,
    private readonly readOnly = false,
  ) {}

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = (await this.client.query(sql, params)) as pg.QueryResult | pg.QueryResult[];
    // A parameterless query with several statements returns one result per statement.
    const last = Array.isArray(result) ? result.at(-1) : result;
    return (last?.rows ?? []) as T[];
  }

  async close(): Promise<void> {
    try {
      if (this.readOnly) await this.client.query('ROLLBACK');
    } finally {
      await this.client.end().catch(() => undefined);
    }
  }
}

/** `pg` implementation. Each session owns one short-lived client (no pool: provisioning and KPIs are rare). */
@Injectable()
export class PgTenantDatabaseConnector implements TenantDatabaseConnector {
  constructor(@Inject(ENVIRONMENT) private readonly env: Environment) {}

  openServerSession(): Promise<SqlSession> {
    return this.connect(this.env.tenantDb.admin, this.env.tenantDb.maintenanceDatabase, { TimeZone: 'UTC' });
  }

  openProvisioningSession(database: string): Promise<SqlSession> {
    assertSafeDatabaseName(database);
    return this.connect(this.env.tenantDb.admin, database, { TimeZone: this.env.analytics.timeZone });
  }

  async openReadOnlySession(database: string, queryTimeoutMs: number): Promise<SqlSession> {
    assertSafeDatabaseName(database);
    const settings: Record<string, string | number> = {
      TimeZone: this.env.analytics.timeZone,
      default_transaction_read_only: 'on',
    };
    if (queryTimeoutMs > 0) settings.statement_timeout = queryTimeoutMs;
    const client = await this.client(this.env.tenantDb.reader, database, settings);
    try {
      await client.query('BEGIN TRANSACTION READ ONLY');
    } catch (error) {
      await client.end().catch(() => undefined);
      throw error;
    }
    return new PgSession(client, true);
  }

  private async connect(
    credentials: { username: string; password: string },
    database: string,
    settings: Record<string, string | number>,
  ): Promise<SqlSession> {
    return new PgSession(await this.client(credentials, database, settings));
  }

  private async client(
    credentials: { username: string; password: string },
    database: string,
    settings: Record<string, string | number>,
  ): Promise<pg.Client> {
    const client = new pg.Client({
      host: this.env.tenantDb.host,
      port: this.env.tenantDb.port,
      user: credentials.username,
      password: credentials.password,
      database,
      connectionTimeoutMillis: this.env.tenantDb.connectTimeoutMs,
      application_name: 'superadmin-api',
      options: startupOptions(settings),
      types: tenantTypes,
    });
    // An idle client that loses the server must not crash the process.
    client.on('error', () => undefined);
    try {
      await client.connect();
    } catch (error) {
      await client.end().catch(() => undefined);
      throw error;
    }
    return client;
  }
}
