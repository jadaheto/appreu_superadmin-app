import { PlatformUser } from './platform-user.js';

const build = (overrides: Partial<{ role: string; isActive: boolean }> = {}) =>
  PlatformUser.restore(1, {
    name: 'Root',
    email: 'ROOT@apreu.co',
    passwordHash: 'h',
    role: 'superadmin',
    isActive: true,
    lastLogin: null,
    ...overrides,
  });

describe('PlatformUser', () => {
  it('normalizes the e-mail', () => {
    expect(build().email.toString()).toBe('root@apreu.co');
  });

  it('grants access only to active superadmins', () => {
    expect(build().canAccessPlatform()).toBe(true);
    expect(build({ isActive: false }).canAccessPlatform()).toBe(false);
    expect(build({ role: 'admin' }).canAccessPlatform()).toBe(false);
  });

  it('records the login time', () => {
    const user = build();
    const at = new Date('2026-01-01T00:00:00Z');
    user.recordLogin(at);
    expect(user.lastLogin).toEqual(at);
  });
});
