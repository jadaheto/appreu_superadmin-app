import type { PlatformUser } from './platform-user.js';

/** Output port over the superadmin accounts of the master database. */
export interface PlatformUserRepository {
  findByEmail(email: string): Promise<PlatformUser | null>;
  findById(id: number): Promise<PlatformUser | null>;
  /** Persists `last_login` only (the table is shared with the template school). */
  saveLastLogin(user: PlatformUser): Promise<void>;
}

export const PLATFORM_USER_REPOSITORY = Symbol('PlatformUserRepository');
