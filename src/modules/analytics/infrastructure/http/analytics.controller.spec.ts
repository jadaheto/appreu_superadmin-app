import { Test } from '@nestjs/testing';
import { GetPlatformDashboardUseCase } from '../../application/get-platform-dashboard.use-case.js';
import { GetTenantAnalyticsUseCase } from '../../application/get-tenant-analytics.use-case.js';
import { AnalyticsController } from './analytics.controller.js';

describe('AnalyticsController', () => {
  const dashboard = { execute: vi.fn().mockResolvedValue({ students: { active: 1 } }) };
  const tenantAnalytics = { execute: vi.fn().mockResolvedValue({ available: true }) };
  let controller: AnalyticsController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [
        { provide: GetPlatformDashboardUseCase, useValue: dashboard },
        { provide: GetTenantAnalyticsUseCase, useValue: tenantAnalytics },
      ],
    }).compile();
    controller = moduleRef.get(AnalyticsController);
  });

  it('returns the platform dashboard', async () => {
    await expect(controller.getDashboard()).resolves.toEqual({ students: { active: 1 } });
  });

  it('returns the analytics of one school', async () => {
    await expect(controller.getTenantAnalytics(7)).resolves.toEqual({ available: true });
    expect(tenantAnalytics.execute).toHaveBeenCalledWith(7);
  });
});
