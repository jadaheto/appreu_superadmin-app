export interface PlatformTokenSubject {
  userId: number;
  email: string;
  name: string;
}

export interface IssuedToken {
  accessToken: string;
  /** Lifetime in seconds. */
  expiresIn: number;
}

/** Issues signed platform access tokens. */
export interface PlatformTokenIssuerPort {
  issue(subject: PlatformTokenSubject): Promise<IssuedToken>;
}

export const PLATFORM_TOKEN_ISSUER = Symbol('PlatformTokenIssuerPort');
