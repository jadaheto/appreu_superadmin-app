import {
  BusinessRuleViolationError,
  ConflictError,
  ExternalServiceError,
} from '../../../shared/domain/domain-error.js';
import { FakePasswordHasher, FixedClock, SequentialPasswordGenerator } from '../../../shared/testing/fakes.js';
import { FakeTenantProvisioner, testNaming } from '../testing/fake-tenant-provisioner.js';
import { InMemoryTenantRepository } from '../testing/in-memory-tenant.repository.js';
import { CreateTenantUseCase, type CreateTenantInput } from './create-tenant.use-case.js';

describe('CreateTenantUseCase', () => {
  let tenants: InMemoryTenantRepository;
  let provisioner: FakeTenantProvisioner;
  let useCase: CreateTenantUseCase;

  const input = (overrides: Partial<CreateTenantInput> = {}): CreateTenantInput => ({
    slug: 'Colegio-Norte',
    name: 'IE Colegio Norte',
    adminEmail: 'director@norte.edu.co',
    adminPhone: '3001234567',
    ...overrides,
  });

  beforeEach(() => {
    tenants = new InMemoryTenantRepository();
    provisioner = new FakeTenantProvisioner();
    useCase = new CreateTenantUseCase(
      tenants,
      provisioner,
      testNaming,
      new SequentialPasswordGenerator(),
      new FakePasswordHasher(),
      new FixedClock(),
      'America/Bogota',
    );
  });

  it('provisions the database, creates the director and registers the tenant', async () => {
    const result = await useCase.execute(input());

    expect(provisioner.calls).toEqual([
      'createDatabase:apreu_colegio_norte',
      'installSchema:apreu_colegio_norte',
      'bootstrapSchool:apreu_colegio_norte',
    ]);
    expect(result.tenant).toMatchObject({
      id: 1,
      slug: 'colegio-norte',
      status: 'active',
      tablesCreated: true,
      databaseName: 'apreu_colegio_norte',
      publicUrl: 'https://apreu.co/colegio-norte',
    });
    expect(result.director).toEqual({
      name: 'Director IE Colegio Norte',
      email: 'director@norte.edu.co',
      temporaryPassword: 'Temp#Pass1xyz',
    });
    expect(result.warnings).toEqual([]);
  });

  it('only sends the hash of the director password to the database', async () => {
    await useCase.execute(input());
    expect(provisioner.directors[0]).toMatchObject({
      schoolName: 'IE Colegio Norte',
      director: {
        email: 'director@norte.edu.co',
        passwordHash: 'hashed:Temp#Pass1xyz',
      },
    });
  });

  it('generates a different password for every school', async () => {
    const a = await useCase.execute(input());
    const b = await useCase.execute(input({ slug: 'colegio-sur', adminEmail: 'd@sur.co' }));
    expect(a.director.temporaryPassword).not.toBe(b.director.temporaryPassword);
  });

  it('creates schools on trial', async () => {
    const result = await useCase.execute(input({ initialStatus: 'trial', trialEndsAt: '2026-04-30' }));
    expect(result.tenant).toMatchObject({
      status: 'trial',
      trialEndsAt: '2026-04-30',
    });
  });

  it('reports skipped statements and removed seeded superadmins as warnings', async () => {
    provisioner.report = {
      statementsExecuted: 10,
      skipped: ['Se omitió INSERT INTO users'],
      migrationsApplied: [],
      alreadyApplied: [],
    };
    provisioner.bootstrap = { superadminsRemoved: 1 };
    const result = await useCase.execute(input());
    expect(result.warnings).toEqual([
      'Se omitió INSERT INTO users',
      'Se eliminaron 1 usuario(s) superadmin sembrados en la plantilla.',
    ]);
  });

  describe('validation (nothing is provisioned)', () => {
    it.each([
      [{ slug: 'mal slug' }, 'INVALID_SLUG'],
      [{ slug: 'superadmin' }, 'RESERVED_SLUG'],
      [{ name: '' }, 'REQUIRED_FIELD'],
      [{ adminEmail: 'x' }, 'INVALID_EMAIL'],
    ])('rejects %o', async (overrides, code) => {
      await expect(useCase.execute(input(overrides))).rejects.toThrow(expect.objectContaining({ code }));
      expect(provisioner.calls).toEqual([]);
    });

    it('rejects a slug already registered', async () => {
      tenants.seed('colegio-norte');
      await expect(useCase.execute(input())).rejects.toBeInstanceOf(ConflictError);
      expect(provisioner.calls).toEqual([]);
    });

    it('keeps the slug of deleted schools reserved', async () => {
      tenants.seed('colegio-norte', 'suspended', new Date());
      await expect(useCase.execute(input())).rejects.toThrow(/colegio eliminado/);
    });

    it('never reuses an orphan database', async () => {
      provisioner.databases.add('apreu_colegio_norte');
      await expect(useCase.execute(input())).rejects.toThrow(/posible huérfana/);
      expect(provisioner.calls).toEqual([]);
    });
  });

  describe('compensation', () => {
    it.each(['installSchema', 'bootstrapSchool'] as const)('drops the database when %s fails', async (step) => {
      provisioner.failures.set(step, new Error('Table creation failed'));

      const error = await useCase.execute(input()).catch((e) => e);

      expect(error).toBeInstanceOf(ExternalServiceError);
      expect(error.message).toMatch(/Se revirtió la creación de apreu_colegio_norte/);
      expect(error.message).not.toContain('Table creation failed');
      expect(error.details).toMatchObject({ rolledBack: true });
      expect(provisioner.calls.at(-1)).toBe('dropDatabase:apreu_colegio_norte');
      expect(provisioner.databases.has('apreu_colegio_norte')).toBe(false);
      expect(tenants.store.all()).toHaveLength(0);
    });

    it('drops the database when the master registration fails (legacy left orphans)', async () => {
      tenants.failNextSave = new ConflictError('El slug ya está registrado.');

      const error = await useCase.execute(input()).catch((e) => e);

      expect(error).toBeInstanceOf(ConflictError);
      expect(error.details).toMatchObject({
        step: 'REGISTER_TENANT',
        rolledBack: true,
      });
      expect(provisioner.databases.size).toBe(0);
    });

    it('does not drop anything when the database could not be created', async () => {
      provisioner.failures.set('createDatabase', new ExternalServiceError('PostgreSQL', 'sin privilegios'));
      await expect(useCase.execute(input())).rejects.toThrow(/sin privilegios/);
      expect(provisioner.calls).toEqual(['createDatabase:apreu_colegio_norte']);
    });

    it('warns when the compensation itself fails', async () => {
      provisioner.failures.set('installSchema', new Error('boom'));
      provisioner.failures.set('dropDatabase', new Error('drop denied'));
      const error = await useCase.execute(input()).catch((e) => e);
      expect(error.message).toMatch(/elimínela manualmente/);
      expect(error.details).toMatchObject({ rolledBack: false });
    });

    it('keeps business errors of the provisioner meaningful', async () => {
      provisioner.failures.set('installSchema', new BusinessRuleViolationError('Sentencia no permitida', 'X'));
      await expect(useCase.execute(input())).rejects.toThrow(/Sentencia no permitida/);
    });
  });
});
