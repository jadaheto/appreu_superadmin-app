import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './app.module.js';
import { PLATFORM_USER_REPOSITORY } from './modules/platform-identity/domain/platform-user.repository.js';
import { PlatformUser } from './modules/platform-identity/domain/platform-user.js';
import { MASTER_TENANT_REPOSITORY } from './modules/tenants/domain/tenant.repository.js';
import { PASSWORD_HASHER } from './shared/application/ports/password-hasher.port.js';
import { DomainExceptionFilter } from './shared/infrastructure/http/filters/domain-exception.filter.js';
import { FakePasswordHasher } from './shared/testing/fakes.js';
import { InMemoryPlatformUserRepository } from './modules/platform-identity/testing/in-memory-platform-user.repository.js';
import { InMemoryTenantRepository } from './modules/tenants/testing/in-memory-tenant.repository.js';

/**
 * Wiring test: boots the real AppModule (no database is opened because the
 * master connection is lazy) with in-memory repositories, and exercises the
 * global guard, throttler, validation pipe and error filter over HTTP.
 */
describe('AppModule (HTTP wiring)', () => {
  let app: INestApplication;
  const users = new InMemoryPlatformUserRepository();
  const tenants = new InMemoryTenantRepository();
  const prefix = '/api/platform/v1';

  beforeAll(async () => {
    Object.assign(process.env, {
      NODE_ENV: 'test',
      SUPERADMIN_JWT_SECRET: 'test-platform-secret',
      MASTER_DB_HOST: 'localhost',
      MASTER_DB_USER: 'test',
      MASTER_DB_NAME: 'apreu_master',
      TENANT_DB_HOST: 'localhost',
      TENANT_DB_ADMIN_USER: 'test',
      LOGIN_THROTTLE_LIMIT: '3',
    });
    users.add(
      PlatformUser.restore(1, {
        name: 'Root',
        email: 'root@apreu.co',
        passwordHash: 'hashed:Clave#2026',
        role: 'superadmin',
        isActive: true,
        lastLogin: null,
      }),
    );
    tenants.seed('colegio-norte');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PLATFORM_USER_REPOSITORY)
      .useValue(users)
      .overrideProvider(MASTER_TENANT_REPOSITORY)
      .useValue(tenants)
      .overrideProvider(PASSWORD_HASHER)
      .useValue(new FakePasswordHasher())
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix(prefix.slice(1), { exclude: ['health'] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new DomainExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('serves the public health check', async () => {
    await request(app.getHttpServer()).get('/health').expect(200, { status: 'ok', service: 'superadmin-api' });
  });

  it('protects every other endpoint', async () => {
    const response = await request(app.getHttpServer()).get(`${prefix}/tenants`).expect(401);
    expect(response.body).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('validates the login body', async () => {
    const response = await request(app.getHttpServer())
      .post(`${prefix}/auth/login`)
      .send({ email: 'no-es-correo', password: '', extra: 1 })
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('logs in and uses the token on protected endpoints', async () => {
    const login = await request(app.getHttpServer())
      .post(`${prefix}/auth/login`)
      .send({ email: 'root@apreu.co', password: 'Clave#2026' })
      .expect(200);
    const token = login.body.accessToken as string;
    expect(login.body.admin).toMatchObject({ email: 'root@apreu.co', role: 'superadmin' });

    const list = await request(app.getHttpServer())
      .get(`${prefix}/tenants?page=1&limit=10`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list.body).toMatchObject({ total: 1, items: [{ slug: 'colegio-norte' }] });

    await request(app.getHttpServer()).get(`${prefix}/tenants/99`).set('Authorization', `Bearer ${token}`).expect(404);

    await request(app.getHttpServer())
      .post(`${prefix}/tenants`)
      .set('Authorization', `Bearer ${token}`)
      .send({ slug: 'x', name: 'IE', adminEmail: 'mal' })
      .expect(400);
  });

  it('throttles repeated login attempts', async () => {
    const attempt = () =>
      request(app.getHttpServer()).post(`${prefix}/auth/login`).send({ email: 'root@apreu.co', password: 'mala' });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await attempt()).status);
    expect(statuses).toContain(429);
  });
});
