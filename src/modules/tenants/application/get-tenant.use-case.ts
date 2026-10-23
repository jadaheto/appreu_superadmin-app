import { Inject, Injectable } from '@nestjs/common';
import type { UseCase } from '../../../shared/application/use-case.js';
import { NotFoundError } from '../../../shared/domain/domain-error.js';
import type { Tenant } from '../domain/tenant.js';
import { MASTER_TENANT_REPOSITORY, type MasterTenantRepository } from '../domain/tenant.repository.js';
import { TENANT_NAMING, type TenantNamingPort } from './ports/tenant-naming.port.js';
import { toTenantView, type TenantView } from './tenant-view.js';

/** Loads a tenant or fails with 404. Shared by the use cases that act on one school. */
export const requireTenant = async (tenants: MasterTenantRepository, id: number): Promise<Tenant> => {
  const tenant = await tenants.findById(id);
  if (!tenant) throw new NotFoundError('Colegio', id);
  return tenant;
};

/** Detail of one school. */
@Injectable()
export class GetTenantUseCase implements UseCase<number, TenantView> {
  constructor(
    @Inject(MASTER_TENANT_REPOSITORY)
    private readonly tenants: MasterTenantRepository,
    @Inject(TENANT_NAMING) private readonly naming: TenantNamingPort,
  ) {}

  async execute(id: number): Promise<TenantView> {
    return toTenantView(await requireTenant(this.tenants, id), this.naming);
  }
}
