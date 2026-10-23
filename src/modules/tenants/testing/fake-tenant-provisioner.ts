import type {
  BootstrapReport,
  DirectorAccount,
  SchemaInstallReport,
  TenantProvisionerPort,
} from '../application/ports/tenant-provisioner.port.js';
import type { TenantNamingPort } from '../application/ports/tenant-naming.port.js';
import { databaseNameFor } from '../domain/tenant-database-name.js';

type Step = 'createDatabase' | 'installSchema' | 'bootstrapSchool' | 'dropDatabase';

/** Records the provisioning calls; any step can be configured to fail. */
export class FakeTenantProvisioner implements TenantProvisionerPort {
  readonly databases = new Set<string>();
  readonly calls: string[] = [];
  readonly directors: {
    databaseName: string;
    schoolName: string;
    director: DirectorAccount;
  }[] = [];
  readonly failures = new Map<Step, Error>();
  report: SchemaInstallReport = {
    statementsExecuted: 50,
    skipped: [],
    migrationsApplied: [],
    alreadyApplied: [],
  };
  bootstrap: BootstrapReport = { superadminsRemoved: 0 };

  async databaseExists(databaseName: string): Promise<boolean> {
    return this.databases.has(databaseName);
  }

  async createDatabase(databaseName: string): Promise<void> {
    this.step('createDatabase', databaseName);
    this.databases.add(databaseName);
  }

  async installSchema(databaseName: string): Promise<SchemaInstallReport> {
    this.step('installSchema', databaseName);
    return this.report;
  }

  async bootstrapSchool(
    databaseName: string,
    input: { schoolName: string; director: DirectorAccount },
  ): Promise<BootstrapReport> {
    this.step('bootstrapSchool', databaseName);
    this.directors.push({ databaseName, ...input });
    return this.bootstrap;
  }

  async dropDatabase(databaseName: string): Promise<void> {
    this.step('dropDatabase', databaseName);
    this.databases.delete(databaseName);
  }

  private step(step: Step, databaseName: string): void {
    this.calls.push(`${step}:${databaseName}`);
    const failure = this.failures.get(step);
    if (failure) throw failure;
  }
}

export const testNaming: TenantNamingPort = {
  databaseNameFor: (slug) => databaseNameFor('apreu_', slug),
  publicUrlFor: (slug) => `https://apreu.co/${slug}`,
};
