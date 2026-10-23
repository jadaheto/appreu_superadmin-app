import type { PlatformUser } from '../domain/platform-user.js';

/** Public profile of a superadmin (never exposes the password hash). */
export interface PlatformUserView {
  id: number;
  name: string;
  email: string;
  role: 'superadmin';
  lastLogin: Date | null;
}

export const toPlatformUserView = (user: PlatformUser): PlatformUserView => ({
  id: user.id as number,
  name: user.name,
  email: user.email.toString(),
  role: 'superadmin',
  lastLogin: user.lastLogin,
});
