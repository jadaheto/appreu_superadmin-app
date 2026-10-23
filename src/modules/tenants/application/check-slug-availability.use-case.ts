import { Inject, Injectable } from '@nestjs/common';
import type { UseCase } from '../../../shared/application/use-case.js';
import { DomainError } from '../../../shared/domain/domain-error.js';
import { MASTER_TENANT_REPOSITORY, type MasterTenantRepository } from '../domain/tenant.repository.js';
import { TenantSlug } from '../domain/tenant-slug.vo.js';
import { TENANT_NAMING, type TenantNamingPort } from './ports/tenant-naming.port.js';
import { TENANT_PROVISIONER, type TenantProvisionerPort } from './ports/tenant-provisioner.port.js';

export interface SlugAvailability {
  slug: string;
  available: boolean;
  /** Why it is not available (Spanish, shown in the wizard). */
  reason: string | null;
  databaseName: string | null;
}

/**
 * Async check used by the creation wizard: format, reserved words, master
 * registry (including deleted schools) and orphan databases on the server.
 */
@Injectable()
export class CheckSlugAvailabilityUseCase implements UseCase<string, SlugAvailability> {
  constructor(
    @Inject(MASTER_TENANT_REPOSITORY)
    private readonly tenants: MasterTenantRepository,
    @Inject(TENANT_PROVISIONER)
    private readonly provisioner: TenantProvisionerPort,
    @Inject(TENANT_NAMING) private readonly naming: TenantNamingPort,
  ) {}

  async execute(raw: string): Promise<SlugAvailability> {
    const normalized = TenantSlug.normalize(raw);
    let slug: string;
    let databaseName: string;
    try {
      slug = TenantSlug.create(raw).toString();
      databaseName = this.naming.databaseNameFor(slug);
    } catch (error) {
      if (error instanceof DomainError) {
        return {
          slug: normalized,
          available: false,
          reason: error.message,
          databaseName: null,
        };
      }
      throw error;
    }

    const existing = await this.tenants.findBySlug(slug);
    if (existing) {
      const reason = existing.isDeleted
        ? 'El slug pertenece a un colegio eliminado y permanece reservado.'
        : 'El slug ya está registrado.';
      return { slug, available: false, reason, databaseName };
    }
    if (await this.provisioner.databaseExists(databaseName)) {
      return {
        slug,
        available: false,
        reason: `Ya existe la base de datos ${databaseName} en el servidor (posible huérfana); no se reutiliza.`,
        databaseName,
      };
    }
    return { slug, available: true, reason: null, databaseName };
  }
}
