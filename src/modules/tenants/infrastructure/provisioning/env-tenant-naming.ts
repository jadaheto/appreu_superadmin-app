import { Inject, Injectable } from '@nestjs/common';
import { ENVIRONMENT, type Environment } from '../../../../shared/infrastructure/config/environment.js';
import type { TenantNamingPort } from '../../application/ports/tenant-naming.port.js';
import { databaseNameFor } from '../../domain/tenant-database-name.js';

/** Naming rules configured by `TENANT_DB_PREFIX` and `TENANT_PUBLIC_URL_TEMPLATE`. */
@Injectable()
export class EnvTenantNaming implements TenantNamingPort {
  constructor(@Inject(ENVIRONMENT) private readonly env: Environment) {}

  databaseNameFor(slug: string): string {
    return databaseNameFor(this.env.tenantDb.databasePrefix, slug);
  }

  publicUrlFor(slug: string): string {
    return this.env.provisioning.publicUrlTemplate.replaceAll('{slug}', encodeURIComponent(slug));
  }
}
