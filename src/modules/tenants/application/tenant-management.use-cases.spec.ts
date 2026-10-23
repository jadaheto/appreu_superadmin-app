import { NotFoundError } from '../../../shared/domain/domain-error.js';
import { FixedClock } from '../../../shared/testing/fakes.js';
import { FakeTenantProvisioner, testNaming } from '../testing/fake-tenant-provisioner.js';
import { InMemoryTenantRepository } from '../testing/in-memory-tenant.repository.js';
import { RecordingTenantCacheInvalidator } from '../testing/recording-tenant-cache-invalidator.js';
import {
  ActivateTenantUseCase,
  DeleteTenantUseCase,
  StartTenantTrialUseCase,
  SuspendTenantUseCase,
} from './change-tenant-status.use-cases.js';
import { CheckSlugAvailabilityUseCase } from './check-slug-availability.use-case.js';
import { GetTenantUseCase } from './get-tenant.use-case.js';
import { ListTenantsUseCase } from './list-tenants.use-case.js';
import { UpdateTenantUseCase } from './update-tenant.use-case.js';

describe('tenant management use cases', () => {
  let tenants: InMemoryTenantRepository;
  let clock: FixedClock;
  let erpCache: RecordingTenantCacheInvalidator;

  beforeEach(() => {
    tenants = new InMemoryTenantRepository();
    clock = new FixedClock();
    erpCache = new RecordingTenantCacheInvalidator();
  });

  describe('ListTenantsUseCase', () => {
    it('hides deleted schools by default and maps views', async () => {
      tenants.seed('norte');
      tenants.seed('sur', 'suspended');
      tenants.seed('viejo', 'suspended', new Date());
      const useCase = new ListTenantsUseCase(tenants, testNaming);

      const page = await useCase.execute({
        criteria: {},
        page: { page: 1, limit: 10 },
      });
      expect(page.total).toBe(2);
      expect(page.items[0]).toMatchObject({
        slug: 'norte',
        publicUrl: 'https://apreu.co/norte',
        isDeleted: false,
      });

      const all = await useCase.execute({
        criteria: { includeDeleted: true, search: '  ' },
        page: { page: 1, limit: 10 },
      });
      expect(all.total).toBe(3);

      const suspended = await useCase.execute({
        criteria: { status: 'suspended' },
        page: { page: 1, limit: 10 },
      });
      expect(suspended.items.map((t) => t.slug)).toEqual(['sur']);
    });
  });

  describe('GetTenantUseCase', () => {
    it('returns the view or 404', async () => {
      tenants.seed('norte');
      const useCase = new GetTenantUseCase(tenants, testNaming);
      await expect(useCase.execute(1)).resolves.toMatchObject({
        slug: 'norte',
        databaseName: 'apreu_norte',
      });
      await expect(useCase.execute(9)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('CheckSlugAvailabilityUseCase', () => {
    const build = (provisioner = new FakeTenantProvisioner()) =>
      new CheckSlugAvailabilityUseCase(tenants, provisioner, testNaming);

    it('accepts a free slug', async () => {
      await expect(build().execute('Nuevo-Colegio')).resolves.toEqual({
        slug: 'nuevo-colegio',
        available: true,
        reason: null,
        databaseName: 'apreu_nuevo_colegio',
      });
    });

    it('explains invalid, reserved, taken and orphan slugs', async () => {
      tenants.seed('norte');
      tenants.seed('cerrado', 'suspended', new Date());
      const provisioner = new FakeTenantProvisioner();
      provisioner.databases.add('apreu_huerfano');
      const useCase = build(provisioner);

      await expect(useCase.execute('a b')).resolves.toMatchObject({
        available: false,
        reason: expect.stringMatching(/caracteres|Slug inválido/),
      });
      await expect(useCase.execute('api')).resolves.toMatchObject({
        available: false,
        reason: expect.stringMatching(/reservado/),
      });
      await expect(useCase.execute('norte')).resolves.toMatchObject({
        available: false,
        reason: 'El slug ya está registrado.',
      });
      await expect(useCase.execute('cerrado')).resolves.toMatchObject({
        available: false,
        reason: expect.stringMatching(/eliminado/),
      });
      await expect(useCase.execute('huerfano')).resolves.toMatchObject({
        available: false,
        reason: expect.stringMatching(/huérfana/),
      });
    });
  });

  describe('UpdateTenantUseCase', () => {
    it('updates contact data and persists', async () => {
      tenants.seed('norte');
      const view = await new UpdateTenantUseCase(tenants, testNaming, erpCache).execute({
        id: 1,
        name: 'Colegio Norte Bilingüe',
        adminEmail: 'rector@norte.co',
      });
      expect(view).toMatchObject({
        name: 'Colegio Norte Bilingüe',
        adminEmail: 'rector@norte.co',
      });
      expect(tenants.saves).toBe(1);
      expect(erpCache.slugs).toEqual(['norte']);
    });
  });

  describe('status transitions', () => {
    it('suspends, puts on trial and reactivates', async () => {
      tenants.seed('norte');
      await expect(
        new SuspendTenantUseCase(tenants, testNaming, erpCache).execute({
          id: 1,
        }),
      ).resolves.toMatchObject({
        status: 'suspended',
      });
      await expect(
        new StartTenantTrialUseCase(tenants, testNaming, erpCache, clock, 'America/Bogota').execute({
          id: 1,
          trialEndsAt: '2026-04-15',
        }),
      ).resolves.toMatchObject({ status: 'trial', trialEndsAt: '2026-04-15' });
      await expect(
        new ActivateTenantUseCase(tenants, testNaming, erpCache).execute({
          id: 1,
        }),
      ).resolves.toMatchObject({
        status: 'active',
        trialEndsAt: null,
      });
      expect(erpCache.slugs).toEqual(['norte', 'norte', 'norte']);
    });

    it('rejects a trial ending in the past (Bogotá date)', async () => {
      tenants.seed('norte');
      const useCase = new StartTenantTrialUseCase(tenants, testNaming, erpCache, clock, 'America/Bogota');
      await expect(useCase.execute({ id: 1, trialEndsAt: '2026-03-14' })).rejects.toThrow(
        expect.objectContaining({ code: 'INVALID_TRIAL_END' }),
      );
    });

    it('deletes logically', async () => {
      tenants.seed('norte');
      const view = await new DeleteTenantUseCase(tenants, testNaming, erpCache, clock).execute({ id: 1 });
      expect(view).toMatchObject({
        status: 'suspended',
        isDeleted: true,
        deletedAt: clock.now(),
      });
      expect(tenants.store.all()).toHaveLength(1);
      expect(erpCache.slugs).toEqual(['norte']);
    });

    it('fails with 404 for unknown schools', async () => {
      await expect(
        new SuspendTenantUseCase(tenants, testNaming, erpCache).execute({
          id: 5,
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(erpCache.slugs).toEqual([]);
    });

    it('does not invalidate the ERP cache when the transition is rejected', async () => {
      tenants.seed('norte');
      const useCase = new StartTenantTrialUseCase(tenants, testNaming, erpCache, clock, 'America/Bogota');
      await expect(useCase.execute({ id: 1, trialEndsAt: '2026-03-14' })).rejects.toThrow();
      expect(erpCache.slugs).toEqual([]);
    });
  });
});
