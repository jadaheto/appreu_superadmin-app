import { Module } from '@nestjs/common';
import { GetCurrentPlatformUserUseCase } from './application/get-current-platform-user.use-case.js';
import { LoginPlatformUserUseCase } from './application/login-platform-user.use-case.js';
import { PLATFORM_TOKEN_ISSUER } from './application/ports/token-issuer.port.js';
import { PLATFORM_USER_REPOSITORY } from './domain/platform-user.repository.js';
import { AuthController } from './infrastructure/http/auth.controller.js';
import { TypeOrmPlatformUserRepository } from './infrastructure/persistence/index.js';
import { JwtPlatformTokenIssuer } from './infrastructure/security/jwt-platform-token-issuer.js';

/** Platform Identity context: superadmin authentication. */
@Module({
  controllers: [AuthController],
  providers: [
    LoginPlatformUserUseCase,
    GetCurrentPlatformUserUseCase,
    { provide: PLATFORM_USER_REPOSITORY, useClass: TypeOrmPlatformUserRepository },
    { provide: PLATFORM_TOKEN_ISSUER, useClass: JwtPlatformTokenIssuer },
  ],
})
export class PlatformIdentityModule {}
