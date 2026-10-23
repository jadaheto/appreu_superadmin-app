import { Inject, Injectable } from '@nestjs/common';
import type { UseCase } from '../../../shared/application/use-case.js';
import { MASTER_TENANT_REPOSITORY, type MasterTenantRepository } from '../domain/tenant.repository.js';
import type { UpdateTenantInfo } from '../domain/tenant.js';
import { requireTenant } from './get-tenant.use-case.js';
import { TENANT_CACHE_INVALIDATOR, type TenantCacheInvalidatorPort } from './ports/tenant-cache-invalidator.port.js';
import { TENANT_NAMING, type TenantNamingPort } from './ports/tenant-naming.port.js';
import { toTenantView, type TenantView } from './tenant-view.js';

export interface UpdateTenantInput extends UpdateTenantInfo {
  id: number;
}

/**
 * Edits name and director contact (the legacy promised "editar" but never implemented it).
 * The ERP caches the registry row (school name), so its cache is invalidated afterwards.
 */
@Injectable()
export class UpdateTenantUseCase implements UseCase<UpdateTenantInput, TenantView> {
  constructor(
    @Inject(MASTER_TENANT_REPOSITORY)
    private readonly tenants: MasterTenantRepository,
    @Inject(TENANT_NAMING) private readonly naming: TenantNamingPort,
    @Inject(TENANT_CACHE_INVALIDATOR)
    private readonly erpCache: TenantCacheInvalidatorPort,
  ) {}

  async execute({ id, ...changes }: UpdateTenantInput): Promise<TenantView> {
    const tenant = await requireTenant(this.tenants, id);
    tenant.updateInfo(changes);
    await this.tenants.save(tenant);
    await this.erpCache.invalidate(tenant.slug.toString());
    return toTenantView(tenant, this.naming);
  }
}
