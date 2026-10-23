import { Test } from '@nestjs/testing';
import {
  ActivateTenantUseCase,
  DeleteTenantUseCase,
  StartTenantTrialUseCase,
  SuspendTenantUseCase,
} from '../../application/change-tenant-status.use-cases.js';
import { CheckSlugAvailabilityUseCase } from '../../application/check-slug-availability.use-case.js';
import { CreateTenantUseCase } from '../../application/create-tenant.use-case.js';
import { GetTenantUseCase } from '../../application/get-tenant.use-case.js';
import { ListTenantsUseCase } from '../../application/list-tenants.use-case.js';
import { UpdateTenantUseCase } from '../../application/update-tenant.use-case.js';
import { ListTenantsQueryDto } from './dto/tenant.dto.js';
import { TenantsController } from './tenants.controller.js';

describe('TenantsController', () => {
  const mock = () => ({ execute: vi.fn().mockResolvedValue({ ok: true }) });
  const useCases = {
    list: mock(),
    get: mock(),
    check: mock(),
    create: mock(),
    update: mock(),
    suspend: mock(),
    activate: mock(),
    trial: mock(),
    remove: mock(),
  };
  let controller: TenantsController;

  beforeEach(async () => {
    Object.values(useCases).forEach((u) => u.execute.mockClear());
    const moduleRef = await Test.createTestingModule({
      controllers: [TenantsController],
      providers: [
        { provide: ListTenantsUseCase, useValue: useCases.list },
        { provide: GetTenantUseCase, useValue: useCases.get },
        { provide: CheckSlugAvailabilityUseCase, useValue: useCases.check },
        { provide: CreateTenantUseCase, useValue: useCases.create },
        { provide: UpdateTenantUseCase, useValue: useCases.update },
        { provide: SuspendTenantUseCase, useValue: useCases.suspend },
        { provide: ActivateTenantUseCase, useValue: useCases.activate },
        { provide: StartTenantTrialUseCase, useValue: useCases.trial },
        { provide: DeleteTenantUseCase, useValue: useCases.remove },
      ],
    }).compile();
    controller = moduleRef.get(TenantsController);
  });

  it('lists with filters and paging', async () => {
    const query = Object.assign(new ListTenantsQueryDto(), {
      page: 2,
      limit: 5,
      search: 'nor',
      status: 'active',
    });
    await controller.list(query);
    expect(useCases.list.execute).toHaveBeenCalledWith({
      criteria: { search: 'nor', status: 'active', includeDeleted: false },
      page: { page: 2, limit: 5 },
    });
  });

  it('checks slug availability', async () => {
    await controller.slugAvailability({ slug: 'norte' });
    expect(useCases.check.execute).toHaveBeenCalledWith('norte');
  });

  it('creates a tenant from the DTO', async () => {
    const dto = { slug: 'norte', name: 'IE Norte', adminEmail: 'd@n.co' };
    await controller.create(dto);
    expect(useCases.create.execute).toHaveBeenCalledWith(dto);
  });

  it('gets and updates by id', async () => {
    await controller.findOne(3);
    expect(useCases.get.execute).toHaveBeenCalledWith(3);
    await controller.update(3, { name: 'Nuevo', adminPhone: null });
    expect(useCases.update.execute).toHaveBeenCalledWith({
      id: 3,
      name: 'Nuevo',
      adminPhone: null,
    });
  });

  it('applies the lifecycle transitions', async () => {
    await controller.suspend(1);
    await controller.activate(1);
    await controller.trial(1, {});
    await controller.remove(1);
    expect(useCases.suspend.execute).toHaveBeenCalledWith({ id: 1 });
    expect(useCases.activate.execute).toHaveBeenCalledWith({ id: 1 });
    expect(useCases.trial.execute).toHaveBeenCalledWith({
      id: 1,
      trialEndsAt: null,
    });
    expect(useCases.remove.execute).toHaveBeenCalledWith({ id: 1 });
  });
});
