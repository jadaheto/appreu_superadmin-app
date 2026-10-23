import { Inject, Injectable } from '@nestjs/common';
import type { UseCase } from '../../../shared/application/use-case.js';
import { UnauthorizedError } from '../../../shared/domain/domain-error.js';
import { PLATFORM_USER_REPOSITORY, type PlatformUserRepository } from '../domain/platform-user.repository.js';
import { toPlatformUserView, type PlatformUserView } from './platform-user-view.js';

/**
 * Returns the profile of the authenticated superadmin. If the account was
 * deactivated or lost the role after the token was issued, the session is
 * considered invalid.
 */
@Injectable()
export class GetCurrentPlatformUserUseCase implements UseCase<number, PlatformUserView> {
  constructor(@Inject(PLATFORM_USER_REPOSITORY) private readonly users: PlatformUserRepository) {}

  async execute(userId: number): Promise<PlatformUserView> {
    const user = await this.users.findById(userId);
    if (!user || !user.canAccessPlatform()) throw new UnauthorizedError('La sesión ya no es válida.');
    return toPlatformUserView(user);
  }
}
