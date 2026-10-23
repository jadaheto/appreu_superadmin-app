import { Module } from '@nestjs/common';
import {
  ActivateTenantUseCase,
  DeleteTenantUseCase,
  StartTenantTrialUseCase,
  SuspendTenantUseCase,
} from './application/change-tenant-status.use-cases.js';
import { CheckSlugAvailabilityUseCase } from './application/check-slug-availability.use-case.js';
import { CreateTenantUseCase } from './application/create-tenant.use-case.js';
import { GetTenantUseCase } from './application/get-tenant.use-case.js';
import { ListTenantsUseCase } from './application/list-tenants.use-case.js';
import { TENANT_CACHE_INVALIDATOR } from './application/ports/tenant-cache-invalidator.port.js';
import { TENANT_NAMING } from './application/ports/tenant-naming.port.js';
import { TENANT_PROVISIONER } from './application/ports/tenant-provisioner.port.js';
import { UpdateTenantUseCase } from './application/update-tenant.use-case.js';
import { MASTER_TENANT_REPOSITORY } from './domain/tenant.repository.js';
import { HttpTenantCacheInvalidator } from './infrastructure/adapters/http-tenant-cache-invalidator.js';
import { TenantsController } from './infrastructure/http/tenants.controller.js';
import { TypeOrmMasterTenantRepository } from './infrastructure/persistence/index.js';
import { EnvTenantNaming } from './infrastructure/provisioning/env-tenant-naming.js';
import { PostgresTenantProvisioner } from './infrastructure/provisioning/postgres-tenant-provisioner.js';
import { FileSchemaScriptLoader, SCHEMA_SCRIPT_LOADER } from './infrastructure/provisioning/schema-script-loader.js';

/** Tenant Management context: registry, lifecycle and provisioning of schools. */
@Module({
  controllers: [TenantsController],
  providers: [
    ListTenantsUseCase,
    GetTenantUseCase,
    CheckSlugAvailabilityUseCase,
    CreateTenantUseCase,
    UpdateTenantUseCase,
    SuspendTenantUseCase,
    ActivateTenantUseCase,
    StartTenantTrialUseCase,
    DeleteTenantUseCase,
    {
      provide: MASTER_TENANT_REPOSITORY,
      useClass: TypeOrmMasterTenantRepository,
    },
    { provide: TENANT_PROVISIONER, useClass: PostgresTenantProvisioner },
    { provide: TENANT_NAMING, useClass: EnvTenantNaming },
    { provide: TENANT_CACHE_INVALIDATOR, useClass: HttpTenantCacheInvalidator },
    { provide: SCHEMA_SCRIPT_LOADER, useClass: FileSchemaScriptLoader },
  ],
})
export class TenantsModule {}
