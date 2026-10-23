import { Inject, Injectable } from '@nestjs/common';
import type { UseCase } from '../../../shared/application/use-case.js';
import { mapPage, type PageRequest, type Paginated } from '../../../shared/domain/pagination.js';
import {
  MASTER_TENANT_REPOSITORY,
  type MasterTenantRepository,
  type TenantSearchCriteria,
} from '../domain/tenant.repository.js';
import { TENANT_NAMING, type TenantNamingPort } from './ports/tenant-naming.port.js';
import { toTenantView, type TenantView } from './tenant-view.js';

export interface ListTenantsInput {
  criteria: TenantSearchCriteria;
  page: PageRequest;
}

/** Lists schools with filters and paging (legacy `colegios.php`). */
@Injectable()
export class ListTenantsUseCase implements UseCase<ListTenantsInput, Paginated<TenantView>> {
  constructor(
    @Inject(MASTER_TENANT_REPOSITORY)
    private readonly tenants: MasterTenantRepository,
    @Inject(TENANT_NAMING) private readonly naming: TenantNamingPort,
  ) {}

  async execute({ criteria, page }: ListTenantsInput): Promise<Paginated<TenantView>> {
    const result = await this.tenants.search({ ...criteria, search: criteria.search?.trim() || undefined }, page);
    return mapPage(result, (tenant) => toTenantView(tenant, this.naming));
  }
}
