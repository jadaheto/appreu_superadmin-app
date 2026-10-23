import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ForbiddenError, UnauthorizedError } from '../../../domain/domain-error.js';
import { PLATFORM_TOKEN_AUDIENCE, PLATFORM_TOKEN_ISSUER } from '../../security/access-token.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

const contextFor = (request: Record<string, any>): ExecutionContext =>
  ({
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

const reflectorReturning = (value: unknown): Reflector =>
  ({ getAllAndOverride: vi.fn().mockReturnValue(value) }) as unknown as Reflector;

describe('JwtAuthGuard', () => {
  const jwt = new JwtService({ secret: 'platform-secret' });
  const sign = (claims: Record<string, unknown> = {}, options: Record<string, unknown> = {}) =>
    jwt.sign(
      { sub: 1, email: 'root@apreu.co', name: 'Root', role: 'superadmin', ...claims },
      { audience: PLATFORM_TOKEN_AUDIENCE, issuer: PLATFORM_TOKEN_ISSUER, ...options },
    );
  const guard = (isPublic = false) => new JwtAuthGuard(reflectorReturning(isPublic), jwt);

  it('lets public endpoints through', async () => {
    await expect(guard(true).canActivate(contextFor({ headers: {} }))).resolves.toBe(true);
  });

  it('rejects requests without a bearer token', async () => {
    await expect(guard().canActivate(contextFor({ headers: {} }))).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects tokens signed with another secret (e.g. the school ERP)', async () => {
    const foreign = new JwtService({ secret: 'erp-secret' }).sign({ sub: 1, role: 'superadmin', tenant: 'a' });
    const request = { headers: { authorization: `Bearer ${foreign}` } };
    await expect(guard().canActivate(contextFor(request))).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects tokens with another audience', async () => {
    const request = { headers: { authorization: `Bearer ${sign({}, { audience: 'apreu-erp' })}` } };
    await expect(guard().canActivate(contextFor(request))).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('forbids tokens without the superadmin role', async () => {
    const request = { headers: { authorization: `Bearer ${sign({ role: 'admin' })}` } };
    await expect(guard().canActivate(contextFor(request))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('attaches the platform actor for a valid token', async () => {
    const request: Record<string, any> = { headers: { authorization: `Bearer ${sign()}` } };
    await expect(guard().canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.actor).toEqual({ userId: 1, email: 'root@apreu.co', name: 'Root', role: 'superadmin' });
  });
});
