import { type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import type { Environment } from '../config/environment.js';

const STRICT_THROTTLE_KEY = 'strictThrottle';

/**
 * Applies the strict `login` throttler to an endpoint (brute-force protection,
 * legacy bug #13). Other endpoints are only subject to the generous default.
 */
export const StrictThrottle = () => SetMetadata(STRICT_THROTTLE_KEY, true);

const isStrict = (context: ExecutionContext): boolean =>
  Reflect.getMetadata(STRICT_THROTTLE_KEY, context.getHandler()) === true;

/** Throttler configuration: `default` for every route, `login` only for `@StrictThrottle()` routes. */
export const throttlerOptions = (env: Environment): ThrottlerModuleOptions => ({
  throttlers: [
    { name: 'default', ttl: 60_000, limit: 300 },
    {
      name: 'login',
      ttl: env.loginThrottle.ttlMs,
      limit: env.loginThrottle.limit,
      skipIf: (context) => !isStrict(context),
    },
  ],
});
