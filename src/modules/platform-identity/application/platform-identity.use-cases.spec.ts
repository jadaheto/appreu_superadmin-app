import { UnauthorizedError } from '../../../shared/domain/domain-error.js';
import { FakePasswordHasher, FixedClock } from '../../../shared/testing/fakes.js';
import { PlatformUser } from '../domain/platform-user.js';
import { InMemoryPlatformUserRepository } from '../testing/in-memory-platform-user.repository.js';
import { GetCurrentPlatformUserUseCase } from './get-current-platform-user.use-case.js';
import { INVALID_CREDENTIALS_MESSAGE, LoginPlatformUserUseCase } from './login-platform-user.use-case.js';
import type { PlatformTokenIssuerPort } from './ports/token-issuer.port.js';

const superadmin = (overrides: Partial<{ id: number; role: string; isActive: boolean; email: string }> = {}) =>
  PlatformUser.restore(overrides.id ?? 1, {
    name: 'Operador',
    email: overrides.email ?? 'root@apreu.co',
    passwordHash: 'hashed:Secreta#2026',
    role: overrides.role ?? 'superadmin',
    isActive: overrides.isActive ?? true,
    lastLogin: null,
  });

describe('LoginPlatformUserUseCase', () => {
  let users: InMemoryPlatformUserRepository;
  let clock: FixedClock;
  let tokens: PlatformTokenIssuerPort;
  let useCase: LoginPlatformUserUseCase;

  beforeEach(() => {
    users = new InMemoryPlatformUserRepository();
    clock = new FixedClock();
    tokens = { issue: vi.fn(async () => ({ accessToken: 'jwt', expiresIn: 7200 })) };
    useCase = new LoginPlatformUserUseCase(users, new FakePasswordHasher(), tokens, clock);
  });

  it('issues a token for an active superadmin and records the login', async () => {
    users.add(superadmin());

    const result = await useCase.execute({ email: ' ROOT@apreu.co ', password: 'Secreta#2026' });

    expect(result).toEqual({
      accessToken: 'jwt',
      expiresIn: 7200,
      admin: { id: 1, name: 'Operador', email: 'root@apreu.co', role: 'superadmin', lastLogin: clock.now() },
    });
    expect(tokens.issue).toHaveBeenCalledWith({ userId: 1, email: 'root@apreu.co', name: 'Operador' });
    expect(users.loginsSaved).toEqual([1]);
  });

  it.each([
    ['wrong password', superadmin(), 'otra'],
    ['inactive account', superadmin({ isActive: false }), 'Secreta#2026'],
    ['school admin (not superadmin)', superadmin({ role: 'admin' }), 'Secreta#2026'],
  ])('rejects %s with a generic message', async (_case, user, password) => {
    users.add(user);
    await expect(useCase.execute({ email: 'root@apreu.co', password })).rejects.toThrow(
      new UnauthorizedError(INVALID_CREDENTIALS_MESSAGE),
    );
    expect(users.loginsSaved).toEqual([]);
    expect(tokens.issue).not.toHaveBeenCalled();
  });

  it('rejects unknown e-mails and empty fields', async () => {
    await expect(useCase.execute({ email: 'nadie@apreu.co', password: 'x' })).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(useCase.execute({ email: ' ', password: '' })).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe('GetCurrentPlatformUserUseCase', () => {
  it('returns the profile of an active superadmin', async () => {
    const users = new InMemoryPlatformUserRepository();
    users.add(superadmin());
    await expect(new GetCurrentPlatformUserUseCase(users).execute(1)).resolves.toMatchObject({
      id: 1,
      email: 'root@apreu.co',
    });
  });

  it('invalidates the session of deactivated or missing accounts', async () => {
    const users = new InMemoryPlatformUserRepository();
    users.add(superadmin({ isActive: false }));
    const useCase = new GetCurrentPlatformUserUseCase(users);
    await expect(useCase.execute(1)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(useCase.execute(99)).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
