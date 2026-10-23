import type { ExecutionContext } from '@nestjs/common';
import { loadEnvironment } from '../config/environment.js';
import { StrictThrottle, throttlerOptions } from './throttling.js';

class Handlers {
  @StrictThrottle()
  login() {}
  list() {}
}

const contextFor = (handler: () => void) => ({ getHandler: () => handler }) as unknown as ExecutionContext;

describe('throttlerOptions', () => {
  const env = loadEnvironment({
    SUPERADMIN_JWT_SECRET: 's',
    MASTER_DB_HOST: 'h',
    MASTER_DB_USER: 'u',
    MASTER_DB_NAME: 'm',
    TENANT_DB_HOST: 't',
    TENANT_DB_ADMIN_USER: 'a',
    LOGIN_THROTTLE_LIMIT: '3',
  });
  const options = throttlerOptions(env) as { throttlers: any[] };
  const login = options.throttlers.find((t) => t.name === 'login');

  it('limits login attempts with the configured values', () => {
    expect(login).toMatchObject({ limit: 3, ttl: 60_000 });
  });

  it('applies the login throttler only to @StrictThrottle endpoints', () => {
    expect(login.skipIf(contextFor(Handlers.prototype.login))).toBe(false);
    expect(login.skipIf(contextFor(Handlers.prototype.list))).toBe(true);
  });
});
