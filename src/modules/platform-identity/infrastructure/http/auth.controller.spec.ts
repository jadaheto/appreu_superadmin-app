import { Test } from '@nestjs/testing';
import { GetCurrentPlatformUserUseCase } from '../../application/get-current-platform-user.use-case.js';
import { LoginPlatformUserUseCase } from '../../application/login-platform-user.use-case.js';
import { AuthController } from './auth.controller.js';

describe('AuthController', () => {
  const login = { execute: vi.fn().mockResolvedValue({ accessToken: 't' }) };
  const currentUser = { execute: vi.fn().mockResolvedValue({ id: 4 }) };
  let controller: AuthController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: LoginPlatformUserUseCase, useValue: login },
        { provide: GetCurrentPlatformUserUseCase, useValue: currentUser },
      ],
    }).compile();
    controller = moduleRef.get(AuthController);
  });

  it('delegates the login to the use case', async () => {
    await expect(controller.signIn({ email: 'root@apreu.co', password: 'p' })).resolves.toEqual({ accessToken: 't' });
    expect(login.execute).toHaveBeenCalledWith({ email: 'root@apreu.co', password: 'p' });
  });

  it('returns the profile of the actor', async () => {
    await expect(controller.me({ userId: 4, email: 'a@b.co', name: 'A', role: 'superadmin' })).resolves.toEqual({
      id: 4,
    });
    expect(currentUser.execute).toHaveBeenCalledWith(4);
  });
});
