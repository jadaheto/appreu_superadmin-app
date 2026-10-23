import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  PLATFORM_TOKEN_AUDIENCE,
  PLATFORM_TOKEN_ISSUER,
  type PlatformAccessTokenClaims,
} from '../../../../shared/infrastructure/security/access-token.js';
import type {
  IssuedToken,
  PlatformTokenIssuerPort,
  PlatformTokenSubject,
} from '../../application/ports/token-issuer.port.js';

/** Signs platform tokens with the superadmin secret, audience and issuer. */
@Injectable()
export class JwtPlatformTokenIssuer implements PlatformTokenIssuerPort {
  constructor(private readonly jwt: JwtService) {}

  async issue(subject: PlatformTokenSubject): Promise<IssuedToken> {
    const claims: PlatformAccessTokenClaims = {
      sub: subject.userId,
      email: subject.email,
      name: subject.name,
      role: 'superadmin',
    };
    const accessToken = await this.jwt.signAsync(claims, {
      audience: PLATFORM_TOKEN_AUDIENCE,
      issuer: PLATFORM_TOKEN_ISSUER,
    });
    const { exp, iat } = this.jwt.decode<{ exp: number; iat: number }>(accessToken);
    return { accessToken, expiresIn: exp - iat };
  }
}
