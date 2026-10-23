import { loadEnvironment } from './environment.js';

const base = {
  SUPERADMIN_JWT_SECRET: 'platform-secret',
  MASTER_DB_HOST: 'master',
  MASTER_DB_USER: 'sa_master',
  MASTER_DB_NAME: 'apreu_master',
  TENANT_DB_HOST: 'tenants',
  TENANT_DB_ADMIN_USER: 'sa_provisioner',
};

describe('loadEnvironment', () => {
  it('applies defaults', () => {
    const env = loadEnvironment(base);
    expect(env).toMatchObject({
      nodeEnv: 'development',
      port: 3100,
      corsOrigins: ['http://localhost:4200'],
      jwt: { secret: 'platform-secret', expiresIn: '2h' },
      loginThrottle: { limit: 5, ttlMs: 60_000 },
      masterDb: { port: 5432 },
      tenantDb: { databasePrefix: 'apreu_', port: 5432, owner: null, maintenanceDatabase: 'postgres' },
      analytics: { concurrency: 4, timeZone: 'America/Bogota' },
    });
    expect(env.tenantDb.reader).toEqual(env.tenantDb.admin);
    expect(env.provisioning).toMatchObject({
      schemaFile: 'database/postgres/tenant-schema.sql',
      migrationsDir: 'database/postgres/migrations',
    });
  });

  it('configures the schema files, the owner role and the maintenance database', () => {
    const env = loadEnvironment({
      ...base,
      TENANT_SCHEMA_FILE: '/srv/schema.sql',
      TENANT_MIGRATIONS_DIR: 'none',
      TENANT_DB_OWNER: 'apreu_app',
      TENANT_DB_MAINTENANCE_DB: 'template1',
    });
    expect(env.provisioning).toMatchObject({ schemaFile: '/srv/schema.sql', migrationsDir: null });
    expect(env.tenantDb).toMatchObject({ owner: 'apreu_app', maintenanceDatabase: 'template1' });
  });

  it.each(['App', 'x"; DROP ROLE y', 'a-b'])('rejects the unsafe owner role %s', (owner) => {
    expect(() => loadEnvironment({ ...base, TENANT_DB_OWNER: owner })).toThrow(/TENANT_DB_OWNER/);
  });

  it('uses a dedicated reader account when configured', () => {
    const env = loadEnvironment({
      ...base,
      TENANT_DB_READER_USER: 'reader',
      TENANT_DB_READER_PASSWORD: 'r',
    });
    expect(env.tenantDb.reader).toEqual({ username: 'reader', password: 'r' });
  });

  it.each(['SUPERADMIN_JWT_SECRET', 'MASTER_DB_HOST', 'MASTER_DB_NAME', 'TENANT_DB_HOST', 'TENANT_DB_ADMIN_USER'])(
    'requires %s',
    (key) => {
      expect(() => loadEnvironment({ ...base, [key]: '' })).toThrow(key);
    },
  );

  it('rejects reusing the ERP JWT secret', () => {
    expect(() => loadEnvironment({ ...base, JWT_SECRET: 'platform-secret' })).toThrow(/no puede ser igual/);
  });

  it('requires a long secret in production', () => {
    expect(() => loadEnvironment({ ...base, NODE_ENV: 'production' })).toThrow(/32 caracteres/);
  });

  it('rejects unsafe database prefixes', () => {
    expect(() => loadEnvironment({ ...base, TENANT_DB_PREFIX: 'x`; DROP' })).toThrow(/TENANT_DB_PREFIX/);
  });

  it('parses CORS origins and integers', () => {
    const env = loadEnvironment({
      ...base,
      CORS_ORIGINS: 'https://a.co, https://b.co',
      PORT: '8080',
    });
    expect(env.corsOrigins).toEqual(['https://a.co', 'https://b.co']);
    expect(env.port).toBe(8080);
    expect(() => loadEnvironment({ ...base, PORT: 'abc' })).toThrow(/PORT/);
  });

  it('leaves the apreu-api cache invalidation disabled by default', () => {
    expect(loadEnvironment(base).apreuApi).toEqual({
      baseUrl: null,
      internalToken: null,
      timeoutMs: 3000,
    });
  });

  it('configures the apreu-api internal API', () => {
    const env = loadEnvironment({
      ...base,
      APREU_API_URL: 'http://apreu-api:3000//',
      APREU_INTERNAL_API_TOKEN: ' s3cret ',
      APREU_API_TIMEOUT_MS: '1500',
    });
    expect(env.apreuApi).toEqual({
      baseUrl: 'http://apreu-api:3000',
      internalToken: 's3cret',
      timeoutMs: 1500,
    });
  });

  it('reads TRUST_PROXY as a proxy count or an address list', () => {
    expect(loadEnvironment(base).trustProxy).toBe(false);
    expect(loadEnvironment({ ...base, TRUST_PROXY: '1' }).trustProxy).toBe(1);
    expect(loadEnvironment({ ...base, TRUST_PROXY: 'loopback, 10.0.0.0/8' }).trustProxy).toBe('loopback, 10.0.0.0/8');
    expect(() => loadEnvironment({ ...base, TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/);
  });

  it.each(['apreu-api:3000', 'ftp://apreu-api'])('rejects the invalid APREU_API_URL %s', (url) => {
    expect(() => loadEnvironment({ ...base, APREU_API_URL: url })).toThrow(/APREU_API_URL/);
  });
});
