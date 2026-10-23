/**
 * Claims carried by the superadmin access token.
 *
 * The token is signed with `SUPERADMIN_JWT_SECRET` (never the ERP secret) and
 * carries a dedicated audience, so a school token can never be replayed
 * against the platform console and vice versa.
 */
export interface PlatformAccessTokenClaims {
  sub: number;
  email: string;
  name: string;
  role: 'superadmin';
}

export const PLATFORM_TOKEN_AUDIENCE = 'apreu-superadmin';
export const PLATFORM_TOKEN_ISSUER = 'superadmin-api';
