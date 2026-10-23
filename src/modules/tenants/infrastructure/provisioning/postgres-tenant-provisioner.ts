import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  BusinessRuleViolationError,
  ConflictError,
  ExternalServiceError,
} from '../../../../shared/domain/domain-error.js';
import { ENVIRONMENT, type Environment } from '../../../../shared/infrastructure/config/environment.js';
import {
  assertSafeDatabaseName,
  quoteIdentifier,
  type SqlSession,
  TENANT_DATABASE_CONNECTOR,
  type TenantDatabaseConnector,
} from '../../../../shared/infrastructure/persistence/tenant-database-connector.js';
import type {
  BootstrapReport,
  DirectorAccount,
  SchemaInstallReport,
  TenantProvisionerPort,
} from '../../application/ports/tenant-provisioner.port.js';
import { SCHEMA_SCRIPT_LOADER, type SchemaScriptLoader } from './schema-script-loader.js';
import { prepareTenantScript } from './sql-script.js';

/** Shape of the errors thrown by `pg` (SQLSTATE in `code`) and by `net` (`ECONNREFUSED`…). */
interface PgError {
  code?: string;
  message?: string;
}

/** SQLSTATE: insufficient_privilege, invalid_password, invalid_authorization_specification. */
const PRIVILEGE_ERRORS = new Set(['42501', '28P01', '28000']);
const DUPLICATE_DATABASE = '42P04';
const TIME_ZONE_PATTERN = /^[A-Za-z0-9_+\-/]{1,64}$/;

/** Table of the school database that records the applied schema versions. */
export const SCHEMA_MIGRATIONS_DDL =
  'CREATE TABLE IF NOT EXISTS schema_migrations (' +
  'version varchar(255) PRIMARY KEY, ' +
  'applied_at timestamptz NOT NULL DEFAULT now())';
/** Serializes concurrent installers of the same database (transaction-scoped advisory lock). */
export const SCHEMA_LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtext('apreu:schema_migrations'))";

/** PHP's `password_verify` (legacy ERP) and `apreu-api` both accept `$2y$`. */
const toPhpBcrypt = (hash: string): string => hash.replace(/^\$2[ab]\$/, '$2y$');

/**
 * PostgreSQL adapter of {@link TenantProvisionerPort} (ADR-0008).
 *
 * - Uses the dedicated provisioning account (`TENANT_DB_ADMIN_*`, role with
 *   `CREATEDB`, not a superuser). With `TENANT_DB_OWNER` the database and
 *   every object are owned by that role (the account of `apreu-api`): the
 *   database is created `OWNER` it and the provisioning sessions run
 *   `SET ROLE` to it.
 * - Database and role names are validated against `[a-z0-9_]` and the
 *   configured prefix, and interpolated only as quoted identifiers.
 * - `CREATE DATABASE` runs in autocommit on the maintenance database (it
 *   cannot run inside a transaction). The schema and each migration run
 *   statement by statement inside one transaction per file, so the failing
 *   statement is known, nothing is silently ignored (bug #8) and a failed
 *   file leaves no partial changes; each file is recorded in
 *   `schema_migrations` and skipped when re-applied.
 * - The director is inserted with a parameterized statement (bug #4).
 */
@Injectable()
export class PostgresTenantProvisioner implements TenantProvisionerPort {
  private readonly logger = new Logger(PostgresTenantProvisioner.name);

  constructor(
    @Inject(TENANT_DATABASE_CONNECTOR)
    private readonly connector: TenantDatabaseConnector,
    @Inject(SCHEMA_SCRIPT_LOADER) private readonly scripts: SchemaScriptLoader,
    @Inject(ENVIRONMENT) private readonly env: Environment,
  ) {}

  async databaseExists(databaseName: string): Promise<boolean> {
    this.assertManaged(databaseName);
    return this.withServerSession(async (session) => {
      const rows = await session.query('SELECT datname FROM pg_database WHERE datname = $1', [databaseName]);
      return rows.length > 0;
    });
  }

  async createDatabase(databaseName: string): Promise<void> {
    this.assertManaged(databaseName);
    const owner = this.env.tenantDb.owner ? ` OWNER ${quoteIdentifier(this.env.tenantDb.owner)}` : '';
    await this.withServerSession(async (session) => {
      try {
        // No IF NOT EXISTS: orphans are never reused. template0 + UTF8 so the encoding never depends on template1.
        await session.query(
          `CREATE DATABASE ${quoteIdentifier(databaseName)}${owner} ENCODING 'UTF8' TEMPLATE template0`,
        );
      } catch (error) {
        if ((error as PgError).code === DUPLICATE_DATABASE) {
          throw new ConflictError(`La base de datos ${databaseName} ya existe; no se reutiliza.`, { databaseName });
        }
        throw this.translate(error, 'crear la base de datos');
      }
    });
    this.logger.log(`Base de datos ${databaseName} creada.`);
  }

  async installSchema(databaseName: string): Promise<SchemaInstallReport> {
    this.assertManaged(databaseName);
    const scripts = (await this.scripts.load()).map((script) => ({
      ...script,
      ...prepareTenantScript(script.content, script.name),
    }));
    const report: SchemaInstallReport = {
      statementsExecuted: 0,
      skipped: [],
      migrationsApplied: [],
      alreadyApplied: [],
    };

    const session = await this.openProvisioning(databaseName);
    try {
      await this.run(databaseName, 'preparar la base de datos', async () => {
        await session.query(
          `ALTER DATABASE ${quoteIdentifier(databaseName)} SET "TimeZone" TO '${this.timeZoneLiteral()}'`,
        );
        await session.query(SCHEMA_MIGRATIONS_DDL);
      });

      for (const script of scripts) {
        await session.query('BEGIN');
        try {
          await session.query(SCHEMA_LOCK_SQL);
          const done = await session.query('SELECT 1 FROM schema_migrations WHERE version = $1', [script.version]);
          if (done.length > 0) {
            await session.query('ROLLBACK');
            report.alreadyApplied.push(script.version);
            continue;
          }
          for (const [position, statement] of script.statements.entries()) {
            try {
              await session.query(statement);
            } catch (error) {
              const { code, message } = error as PgError;
              throw new BusinessRuleViolationError(
                `Falló la sentencia ${position + 1} de ${script.name}: ${code ?? 'ERROR'}.`,
                'SCHEMA_INSTALL_FAILED',
                {
                  script: script.name,
                  statement: position + 1,
                  preview: statement.slice(0, 120),
                  reason: message?.slice(0, 200),
                },
              );
            }
            report.statementsExecuted++;
          }
          await session.query('INSERT INTO schema_migrations (version) VALUES ($1)', [script.version]);
          await session.query('COMMIT');
        } catch (error) {
          await session.query('ROLLBACK').catch(() => undefined);
          throw error instanceof BusinessRuleViolationError ? error : this.translate(error, `aplicar ${script.name}`);
        }
        report.skipped.push(...script.skipped);
        if (!script.baseline) report.migrationsApplied.push(script.version);
      }

      await this.grantReader(session, databaseName);
    } finally {
      await session.close();
    }
    this.logger.log(
      `Esquema instalado en ${databaseName}: ${report.statementsExecuted} sentencias, ` +
        `${report.migrationsApplied.length} migraciones.`,
    );
    return report;
  }

  async bootstrapSchool(
    databaseName: string,
    input: { schoolName: string; director: DirectorAccount },
  ): Promise<BootstrapReport> {
    this.assertManaged(databaseName);
    const session = await this.openProvisioning(databaseName);
    try {
      await session.query('BEGIN');
      // Defense in depth: no tenant may contain platform superadmins (legacy bug #3).
      const removed = await session.query<{ total: number }>(
        "SELECT COUNT(*)::int AS total FROM users WHERE role = 'superadmin'",
      );
      const superadminsRemoved = Number(removed[0]?.total ?? 0);
      if (superadminsRemoved > 0) await session.query("DELETE FROM users WHERE role = 'superadmin'");

      // The director must replace the temporary password on first login (apreu-api enforces it).
      // E-mails are stored in lower case (ADR-0008: unique index on lower(email)).
      await session.query(
        'INSERT INTO users (name, email, password, role, is_active, must_change_password) ' +
          "VALUES ($1, $2, $3, 'admin', true, true)",
        [input.director.name, input.director.email.toLowerCase(), toPhpBcrypt(input.director.passwordHash)],
      );
      await session.query(
        "INSERT INTO settings (key, value, description) VALUES ('school_name', $1, 'Nombre de la institución') " +
          'ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
        [input.schoolName],
      );
      await session.query('COMMIT');
      return { superadminsRemoved };
    } catch (error) {
      await session.query('ROLLBACK').catch(() => undefined);
      throw this.translate(error, 'crear el usuario director');
    } finally {
      await session.close();
    }
  }

  async dropDatabase(databaseName: string): Promise<void> {
    this.assertManaged(databaseName);
    // WITH (FORCE) closes the sessions still open on the new database (PostgreSQL ≥ 13).
    await this.withServerSession((session) =>
      session.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`),
    );
    this.logger.warn(`Base de datos ${databaseName} eliminada (compensación).`);
  }

  /**
   * The read-only analytics account (`TENANT_DB_READER_USER`) gets `CONNECT`
   * and `SELECT` on the tables (present and future ones created by the owner).
   * With an explicit owner, `PUBLIC` loses `CONNECT`/`TEMP` on the database.
   */
  private async grantReader(session: SqlSession, databaseName: string): Promise<void> {
    const { admin, reader, owner } = this.env.tenantDb;
    const database = quoteIdentifier(databaseName);
    const statements: string[] = [];
    if (owner) statements.push(`REVOKE CONNECT, TEMPORARY ON DATABASE ${database} FROM PUBLIC`);
    if (reader.username !== admin.username && reader.username !== owner) {
      const role = quoteIdentifier(reader.username);
      statements.push(
        `GRANT CONNECT ON DATABASE ${database} TO ${role}`,
        `GRANT USAGE ON SCHEMA public TO ${role}`,
        `GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${role}`,
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${role}`,
      );
    }
    if (statements.length === 0) return;
    await this.run(databaseName, 'otorgar permisos a la cuenta lectora', async () => {
      for (const statement of statements) await session.query(statement);
    });
  }

  private timeZoneLiteral(): string {
    const timeZone = this.env.analytics.timeZone;
    if (!TIME_ZONE_PATTERN.test(timeZone)) {
      throw new BusinessRuleViolationError(`Zona horaria no permitida: ${timeZone}`, 'INVALID_TIME_ZONE');
    }
    return timeZone;
  }

  private async run(databaseName: string, action: string, work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      throw this.translate(error, `${action} de ${databaseName}`);
    }
  }

  /** Only databases following the platform naming rule can be touched. */
  private assertManaged(databaseName: string): void {
    assertSafeDatabaseName(databaseName);
    if (!databaseName.startsWith(this.env.tenantDb.databasePrefix)) {
      throw new BusinessRuleViolationError(
        `La base de datos ${databaseName} no pertenece a la plataforma.`,
        'UNMANAGED_DATABASE',
      );
    }
  }

  /** Session on the school database acting as the owner role (objects and rows belong to it). */
  private async openProvisioning(databaseName: string): Promise<SqlSession> {
    let session: SqlSession;
    try {
      session = await this.connector.openProvisioningSession(databaseName);
    } catch (error) {
      throw this.translate(error, 'conectarse a la nueva base de datos');
    }
    const { owner } = this.env.tenantDb;
    if (owner) {
      try {
        await session.query(`SET ROLE ${quoteIdentifier(owner)}`);
      } catch (error) {
        await session.close();
        throw this.translate(error, `actuar como el propietario ${owner}`);
      }
    }
    return session;
  }

  private async withServerSession<T>(work: (session: SqlSession) => Promise<T>): Promise<T> {
    let session: SqlSession;
    try {
      session = await this.connector.openServerSession();
    } catch (error) {
      throw this.translate(error, 'conectarse al servidor de colegios');
    }
    try {
      return await work(session);
    } finally {
      await session.close();
    }
  }

  /** Maps driver errors to domain errors without leaking hosts or credentials (bug #16). */
  private translate(error: unknown, action: string): Error {
    if (error instanceof ConflictError || error instanceof BusinessRuleViolationError) return error;
    const { code, message } = (error ?? {}) as PgError;
    this.logger.error(`No se pudo ${action}: ${code ?? ''} ${message ?? error}`);
    if (code !== undefined && PRIVILEGE_ERRORS.has(code)) {
      return new ExternalServiceError(
        'PostgreSQL',
        `el usuario de aprovisionamiento no tiene privilegios para ${action} ` +
          '(requiere CREATEDB y, si se configura TENANT_DB_OWNER, ser miembro de ese rol).',
        { code },
      );
    }
    return new ExternalServiceError('PostgreSQL', `no se pudo ${action} (${code ?? 'error de conexión'}).`, { code });
  }
}
