import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { CLOCK } from '../application/ports/clock.port.js';
import { PASSWORD_GENERATOR } from '../application/ports/password-generator.port.js';
import { PASSWORD_HASHER } from '../application/ports/password-hasher.port.js';
import { TIME_ZONE } from '../application/ports/time-zone.port.js';
import { ENVIRONMENT, type Environment, loadEnvironment } from './config/environment.js';
import { JwtAuthGuard } from './http/guards/jwt-auth.guard.js';
import { MasterDatabase } from './persistence/master-database.js';
import { PgTenantDatabaseConnector, TENANT_DATABASE_CONNECTOR } from './persistence/tenant-database-connector.js';
import { BcryptPasswordHasher } from './security/password-hasher.js';
import { CryptoPasswordGenerator } from './security/random-password-generator.js';
import { SystemClock } from './time/system-clock.js';

/**
 * Cross-cutting infrastructure: configuration, master database, connector to
 * the tenants server, security (platform JWT, bcrypt, password generator)
 * and the global authentication guard.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      inject: [ENVIRONMENT],
      useFactory: (env: Environment) => ({
        secret: env.jwt.secret,
        signOptions: { expiresIn: env.jwt.expiresIn as any },
      }),
      extraProviders: [{ provide: ENVIRONMENT, useFactory: () => loadEnvironment() }],
    }),
  ],
  providers: [
    { provide: ENVIRONMENT, useFactory: () => loadEnvironment() },
    { provide: CLOCK, useClass: SystemClock },
    { provide: TIME_ZONE, inject: [ENVIRONMENT], useFactory: (env: Environment) => env.analytics.timeZone },
    { provide: PASSWORD_HASHER, useClass: BcryptPasswordHasher },
    { provide: PASSWORD_GENERATOR, useFactory: () => new CryptoPasswordGenerator() },
    { provide: TENANT_DATABASE_CONNECTOR, useClass: PgTenantDatabaseConnector },
    MasterDatabase,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [
    ENVIRONMENT,
    CLOCK,
    TIME_ZONE,
    PASSWORD_HASHER,
    PASSWORD_GENERATOR,
    TENANT_DATABASE_CONNECTOR,
    MasterDatabase,
    JwtModule,
  ],
})
export class SharedModule {}
