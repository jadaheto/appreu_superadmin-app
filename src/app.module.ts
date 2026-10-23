import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AnalyticsModule } from './modules/analytics/analytics.module.js';
import { HealthController } from './modules/health/health.controller.js';
import { PlatformIdentityModule } from './modules/platform-identity/platform-identity.module.js';
import { TenantsModule } from './modules/tenants/tenants.module.js';
import { ENVIRONMENT, type Environment } from './shared/infrastructure/config/environment.js';
import { throttlerOptions } from './shared/infrastructure/http/throttling.js';
import { SharedModule } from './shared/infrastructure/shared.module.js';

@Module({
  imports: [
    SharedModule,
    ThrottlerModule.forRootAsync({ inject: [ENVIRONMENT], useFactory: (env: Environment) => throttlerOptions(env) }),
    PlatformIdentityModule,
    TenantsModule,
    AnalyticsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
