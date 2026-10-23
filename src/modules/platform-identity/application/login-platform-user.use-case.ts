import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type ClockPort } from '../../../shared/application/ports/clock.port.js';
import { PASSWORD_HASHER, type PasswordHasherPort } from '../../../shared/application/ports/password-hasher.port.js';
import type { UseCase } from '../../../shared/application/use-case.js';
import { UnauthorizedError } from '../../../shared/domain/domain-error.js';
import { PLATFORM_USER_REPOSITORY, type PlatformUserRepository } from '../domain/platform-user.repository.js';
import { PLATFORM_TOKEN_ISSUER, type PlatformTokenIssuerPort } from './ports/token-issuer.port.js';
import { toPlatformUserView, type PlatformUserView } from './platform-user-view.js';

export interface LoginPlatformUserInput {
  email: string;
  password: string;
}

export interface LoginPlatformUserOutput {
  accessToken: string;
  expiresIn: number;
  admin: PlatformUserView;
}

/** Bcrypt hash of a random string: compared when the e-mail is unknown so timing does not reveal accounts. */
const DUMMY_HASH = '$2b$12$f3tqcTjm47V2zqwkMCNC3e80TSzQcSHqsfWv7ySltmEG4AMRgU0bK';

export const INVALID_CREDENTIALS_MESSAGE = 'Credenciales incorrectas o sin permiso de superadmin.';

/**
 * Signs a superadmin into the platform console (legacy `superadmin/login.php`).
 *
 * Rules (RN-SA-01):
 * - Only active users with `role = 'superadmin'` of the master database.
 * - A single generic error message (no hint about which field failed and no
 *   database details, legacy bug #13).
 * - On success `last_login` is updated and a platform JWT is issued.
 * Brute force is mitigated by the throttler on the HTTP endpoint.
 */
@Injectable()
export class LoginPlatformUserUseCase implements UseCase<LoginPlatformUserInput, LoginPlatformUserOutput> {
  constructor(
    @Inject(PLATFORM_USER_REPOSITORY) private readonly users: PlatformUserRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasherPort,
    @Inject(PLATFORM_TOKEN_ISSUER) private readonly tokens: PlatformTokenIssuerPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(input: LoginPlatformUserInput): Promise<LoginPlatformUserOutput> {
    const email = input.email.trim().toLowerCase();
    if (!email || !input.password) throw new UnauthorizedError(INVALID_CREDENTIALS_MESSAGE);

    const user = await this.users.findByEmail(email);
    const passwordMatches = await this.hasher.verify(input.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !passwordMatches || !user.canAccessPlatform()) {
      throw new UnauthorizedError(INVALID_CREDENTIALS_MESSAGE);
    }

    user.recordLogin(this.clock.now());
    await this.users.saveLastLogin(user);

    const token = await this.tokens.issue({ userId: user.id as number, email: user.email.toString(), name: user.name });
    return { ...token, admin: toPlatformUserView(user) };
  }
}
