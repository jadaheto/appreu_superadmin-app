import { Inject, Injectable, Logger } from '@nestjs/common';
import { CLOCK, type ClockPort } from '../../../shared/application/ports/clock.port.js';
import {
  PASSWORD_GENERATOR,
  type PasswordGeneratorPort,
} from '../../../shared/application/ports/password-generator.port.js';
import { PASSWORD_HASHER, type PasswordHasherPort } from '../../../shared/application/ports/password-hasher.port.js';
import { TIME_ZONE } from '../../../shared/application/ports/time-zone.port.js';
import type { UseCase } from '../../../shared/application/use-case.js';
import { isoDate, localDate } from '../../../shared/domain/calendar.js';
import { ConflictError, DomainError, ExternalServiceError } from '../../../shared/domain/domain-error.js';
import { Tenant } from '../domain/tenant.js';
import { MASTER_TENANT_REPOSITORY, type MasterTenantRepository } from '../domain/tenant.repository.js';
import { TenantSlug } from '../domain/tenant-slug.vo.js';
import { TENANT_NAMING, type TenantNamingPort } from './ports/tenant-naming.port.js';
import { TENANT_PROVISIONER, type TenantProvisionerPort } from './ports/tenant-provisioner.port.js';
import { toTenantView, type TenantView } from './tenant-view.js';

export interface CreateTenantInput {
  slug: string;
  name: string;
  adminEmail: string;
  adminPhone?: string | null;
  initialStatus?: 'active' | 'trial';
  trialEndsAt?: string | null;
}

export interface CreateTenantOutput {
  tenant: TenantView;
  /** Director credentials. `temporaryPassword` is returned only here, once, and never stored in clear. */
  director: { name: string; email: string; temporaryPassword: string };
  warnings: string[];
}

type Step = 'CREATE_DATABASE' | 'INSTALL_SCHEMA' | 'CREATE_DIRECTOR' | 'REGISTER_TENANT';

const STEP_LABEL: Record<Step, string> = {
  CREATE_DATABASE: 'crear la base de datos',
  INSTALL_SCHEMA: 'instalar el esquema base',
  CREATE_DIRECTOR: 'crear el usuario director',
  REGISTER_TENANT: 'registrar el colegio en la BD maestra',
};

/**
 * Provisions a new school (legacy `api/create_tenant.php`, rewritten as a saga).
 *
 * Steps:
 * 1. Validate slug/name/e-mail/phone; the slug must not exist in `tenants`
 *    (deleted schools keep theirs) and no database with its name may exist —
 *    orphans are never reused (legacy `CREATE DATABASE IF NOT EXISTS`).
 * 2. `CREATE DATABASE "<prefix><slug>"` (PostgreSQL, UTF8, outside any transaction).
 * 3. Install `tenant-schema.sql` and the migrations statement by statement
 *    (recorded in `schema_migrations`); seeded users are
 *    never imported (legacy bug #3: superadmin with a public hash).
 * 4. Create the director (`admin`) with a strong random password, hashed with
 *    bcrypt and prepared statements (bugs #2/#4).
 * 5. Register the tenant with `db_name` and `tables_created = true`.
 *
 * Compensation: if any step after 2 fails, the database created here is
 * dropped, so no orphan database is left behind (bug #9). No code is cloned.
 */
@Injectable()
export class CreateTenantUseCase implements UseCase<CreateTenantInput, CreateTenantOutput> {
  private readonly logger = new Logger(CreateTenantUseCase.name);

  constructor(
    @Inject(MASTER_TENANT_REPOSITORY)
    private readonly tenants: MasterTenantRepository,
    @Inject(TENANT_PROVISIONER)
    private readonly provisioner: TenantProvisionerPort,
    @Inject(TENANT_NAMING) private readonly naming: TenantNamingPort,
    @Inject(PASSWORD_GENERATOR)
    private readonly passwords: PasswordGeneratorPort,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasherPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(TIME_ZONE) private readonly timeZone: string,
  ) {}

  async execute(input: CreateTenantInput): Promise<CreateTenantOutput> {
    const slug = TenantSlug.create(input.slug);
    const databaseName = this.naming.databaseNameFor(slug.toString());
    const tenant = Tenant.register({
      slug,
      name: input.name,
      adminEmail: input.adminEmail,
      adminPhone: input.adminPhone,
      databaseName,
      initialStatus: input.initialStatus,
      trialEndsAt: input.trialEndsAt,
      today: isoDate(localDate(this.clock.now(), this.timeZone)),
    });

    await this.ensureAvailable(slug.toString(), databaseName);

    const temporaryPassword = this.passwords.generate();
    const director = {
      name: `Director ${tenant.name}`.slice(0, 150),
      email: tenant.adminEmail!.toString(),
      passwordHash: await this.hasher.hash(temporaryPassword),
    };
    const warnings: string[] = [];

    let step: Step = 'CREATE_DATABASE';
    let databaseCreated = false;
    try {
      await this.provisioner.createDatabase(databaseName);
      databaseCreated = true;

      step = 'INSTALL_SCHEMA';
      const report = await this.provisioner.installSchema(databaseName);
      warnings.push(...report.skipped);

      step = 'CREATE_DIRECTOR';
      const bootstrap = await this.provisioner.bootstrapSchool(databaseName, {
        schoolName: tenant.name,
        director,
      });
      if (bootstrap.superadminsRemoved > 0) {
        warnings.push(`Se eliminaron ${bootstrap.superadminsRemoved} usuario(s) superadmin sembrados en la plantilla.`);
      }

      step = 'REGISTER_TENANT';
      await this.tenants.save(tenant);
    } catch (error) {
      const compensation = databaseCreated ? await this.compensate(databaseName) : null;
      throw this.failure(error, step, databaseName, compensation);
    }

    this.logger.log(`Colegio ${slug.toString()} aprovisionado en ${databaseName}.`);
    // Re-read to return the timestamps assigned by the database.
    const stored = (await this.tenants.findById(tenant.id as number).catch(() => null)) ?? tenant;
    return {
      tenant: toTenantView(stored, this.naming),
      director: {
        name: director.name,
        email: director.email,
        temporaryPassword,
      },
      warnings,
    };
  }

  private async ensureAvailable(slug: string, databaseName: string): Promise<void> {
    const existing = await this.tenants.findBySlug(slug);
    if (existing) {
      throw new ConflictError(
        existing.isDeleted
          ? 'El slug pertenece a un colegio eliminado y permanece reservado.'
          : 'El slug ya está registrado.',
        { slug },
      );
    }
    if (await this.provisioner.databaseExists(databaseName)) {
      throw new ConflictError(
        `Ya existe la base de datos ${databaseName} en el servidor (posible huérfana); no se reutiliza.`,
        { databaseName },
      );
    }
  }

  /** Drops the database created by this execution; returns an error message if that also fails. */
  private async compensate(databaseName: string): Promise<{ dropped: boolean; error?: string }> {
    try {
      await this.provisioner.dropDatabase(databaseName);
      return { dropped: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`No se pudo revertir la BD ${databaseName}: ${message}`);
      return { dropped: false, error: message };
    }
  }

  private failure(
    error: unknown,
    step: Step,
    databaseName: string,
    compensation: { dropped: boolean; error?: string } | null,
  ): DomainError {
    const rollback = compensation
      ? compensation.dropped
        ? ` Se revirtió la creación de ${databaseName}.`
        : ` ATENCIÓN: no se pudo eliminar ${databaseName}; elimínela manualmente.`
      : '';
    if (!(error instanceof DomainError)) {
      this.logger.error(`Fallo al ${STEP_LABEL[step]}: ${error instanceof Error ? error.stack : String(error)}`);
    }
    if (error instanceof ConflictError) {
      return new ConflictError(`${error.message}${rollback}`, {
        ...error.details,
        step,
        rolledBack: compensation?.dropped ?? false,
      });
    }
    const reason = error instanceof DomainError ? error.message : 'error inesperado';
    return new ExternalServiceError('aprovisionamiento', `No se pudo ${STEP_LABEL[step]} (${reason}).${rollback}`, {
      step,
      databaseName,
      rolledBack: compensation?.dropped ?? false,
    });
  }
}
