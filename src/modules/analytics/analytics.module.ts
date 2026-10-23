import { Module } from '@nestjs/common';
import { ENVIRONMENT, type Environment } from '../../shared/infrastructure/config/environment.js';
import { GetPlatformDashboardUseCase } from './application/get-platform-dashboard.use-case.js';
import { GetTenantAnalyticsUseCase } from './application/get-tenant-analytics.use-case.js';
import { ANALYTICS_SETTINGS, type AnalyticsSettings } from './application/ports/analytics-settings.port.js';
import { TENANT_CATALOG } from './application/ports/tenant-catalog.port.js';
import { TENANT_STATS_READER } from './application/ports/tenant-stats-reader.port.js';
import { AnalyticsController } from './infrastructure/http/analytics.controller.js';
import { PostgresTenantStatsReader } from './infrastructure/persistence/postgres-tenant-stats-reader.js';
import { SqlTenantCatalog } from './infrastructure/persistence/sql-tenant-catalog.js';

/** Platform Analytics context: global KPIs and per-school metrics (read-only). */
@Module({
  controllers: [AnalyticsController],
  providers: [
    GetPlatformDashboardUseCase,
    GetTenantAnalyticsUseCase,
    { provide: TENANT_CATALOG, useClass: SqlTenantCatalog },
    { provide: TENANT_STATS_READER, useClass: PostgresTenantStatsReader },
    {
      provide: ANALYTICS_SETTINGS,
      inject: [ENVIRONMENT],
      useFactory: (env: Environment): AnalyticsSettings => ({
        concurrency: env.analytics.concurrency,
        timeZone: env.analytics.timeZone,
      }),
    },
  ],
})
export class AnalyticsModule {}
