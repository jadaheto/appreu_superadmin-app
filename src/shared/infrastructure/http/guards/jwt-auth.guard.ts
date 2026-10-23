import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { ForbiddenError, UnauthorizedError } from '../../../domain/domain-error.js';
import {
  PLATFORM_TOKEN_AUDIENCE,
  PLATFORM_TOKEN_ISSUER,
  type PlatformAccessTokenClaims,
} from '../../security/access-token.js';
import type { RequestWithActor } from '../decorators/current-actor.decorator.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';

/**
 * Global guard: every endpoint requires a valid superadmin token unless it is
 * marked with `@Public()`. Tokens must carry the platform audience/issuer and
 * the `superadmin` role (legacy `auth.php` → `saAuth()`).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & RequestWithActor>();
    const token = this.extractToken(request);
    if (!token) throw new UnauthorizedError('Debe iniciar sesión.');

    let claims: PlatformAccessTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<PlatformAccessTokenClaims>(token, {
        audience: PLATFORM_TOKEN_AUDIENCE,
        issuer: PLATFORM_TOKEN_ISSUER,
      });
    } catch {
      throw new UnauthorizedError('La sesión expiró o no es válida.');
    }
    if (claims.role !== 'superadmin') throw new ForbiddenError('Se requiere el rol superadmin.');

    request.actor = { userId: Number(claims.sub), email: claims.email, name: claims.name, role: 'superadmin' };
    return true;
  }

  private extractToken(request: Request): string | null {
    const [type, value] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' && value ? value : null;
  }
}
