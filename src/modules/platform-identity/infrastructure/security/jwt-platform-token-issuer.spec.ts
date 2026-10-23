import { JwtService } from '@nestjs/jwt';
import { PLATFORM_TOKEN_AUDIENCE } from '../../../../shared/infrastructure/security/access-token.js';
import { JwtPlatformTokenIssuer } from './jwt-platform-token-issuer.js';

describe('JwtPlatformTokenIssuer', () => {
  it('signs a superadmin token with the platform audience', async () => {
    const jwt = new JwtService({ secret: 's', signOptions: { expiresIn: '2h' } });
    const { accessToken, expiresIn } = await new JwtPlatformTokenIssuer(jwt).issue({
      userId: 3,
      email: 'root@apreu.co',
      name: 'Root',
    });
    expect(expiresIn).toBe(7200);
    const claims = jwt.verify(accessToken, { audience: PLATFORM_TOKEN_AUDIENCE });
    expect(claims).toMatchObject({ sub: 3, role: 'superadmin', email: 'root@apreu.co' });
  });
});
