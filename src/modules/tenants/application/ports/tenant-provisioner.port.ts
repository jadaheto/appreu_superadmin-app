export interface DirectorAccount {
  name: string;
  email: string;
  /** bcrypt hash; the plain password never reaches the adapter. */
  passwordHash: string;
}

export interface SchemaInstallReport {
  /** Statements executed from the consolidated schema and the migrations. */
  statementsExecuted: number;
  /** Human readable notes about statements intentionally skipped (e.g. seeded users). */
  skipped: string[];
  /** Migration versions applied after the consolidated schema. */
  migrationsApplied: string[];
  /** Versions already recorded in `schema_migrations` and therefore not executed again. */
  alreadyApplied: string[];
}

export interface BootstrapReport {
  /** Superadmin rows removed from the new school (defense against seeded accounts, legacy bug #3). */
  superadminsRemoved: number;
}

/**
 * Creates and installs the database of a school on the tenants server
 * (replaces steps 1–3 of `api/create_tenant.php`; no folder cloning).
 */
export interface TenantProvisionerPort {
  databaseExists(databaseName: string): Promise<boolean>;
  /** Fails with `ConflictError` if the database already exists (orphans are never reused). */
  createDatabase(databaseName: string): Promise<void>;
  /**
   * Applies `tenant-schema.sql` and then the migrations, statement by
   * statement, one transaction per file, recording each version in the
   * `schema_migrations` table of the school (re-running is safe).
   */
  installSchema(databaseName: string): Promise<SchemaInstallReport>;
  /** Creates the director (`role = 'admin'`) and the initial settings of the school. */
  bootstrapSchool(
    databaseName: string,
    input: { schoolName: string; director: DirectorAccount },
  ): Promise<BootstrapReport>;
  /** Compensation: drops a database created by this API. */
  dropDatabase(databaseName: string): Promise<void>;
}

export const TENANT_PROVISIONER = Symbol('TenantProvisionerPort');
