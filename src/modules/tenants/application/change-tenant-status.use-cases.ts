import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type ClockPort } from '../../../shared/application/ports/clock.port.js';
import { TIME_ZONE } from '../../../shared/application/ports/time-zone.port.js';
import type { UseCase } from '../../../shared/application/use-case.js';
import { isoDate, localDate } from '../../../shared/domain/calendar.js';
import type { Tenant } from '../domain/tenant.js';
import { MASTER_TENANT_REPOSITORY, type MasterTenantRepository } from '../domain/tenant.repository.js';
import { requireTenant } from './get-tenant.use-case.js';
import { TENANT_CACHE_INVALIDATOR, type TenantCacheInvalidatorPort } from './ports/tenant-cache-invalidator.port.js';
import { TENANT_NAMING, type TenantNamingPort } from './ports/tenant-naming.port.js';
import { toTenantView, type TenantView } from './tenant-view.js';

/**
 * Template for the use cases that apply one lifecycle transition to a school.
 * After persisting, asks `apreu-api` to drop its cached copy so the new status
 * applies immediately (best effort, see {@link TenantCacheInvalidatorPort}).
 */
abstract class TenantTransitionUseCase<TInput extends { id: number }> implements UseCase<TInput, TenantView> {
  constructor(
    protected readonly tenants: MasterTenantRepository,
    protected readonly naming: TenantNamingPort,
    protected readonly erpCache: TenantCacheInvalidatorPort,
  ) {}

  protected abstract apply(tenant: Tenant, input: TInput): void;

  async execute(input: TInput): Promise<TenantView> {
    const tenant = await requireTenant(this.tenants, input.id);
    this.apply(tenant, input);
    await this.tenants.save(tenant);
    await this.erpCache.invalidate(tenant.slug.toString());
    return toTenantView(tenant, this.naming);
  }
}

/**
 * Suspends a school. Since `apreu-api` checks `tenants.status`, a suspended
 * school can no longer log in (legacy bug #11).
 */
@Injectable()
export class SuspendTenantUseCase extends TenantTransitionUseCase<{
  id: number;
}> {
  constructor(
    @Inject(MASTER_TENANT_REPOSITORY) tenants: MasterTenantRepository,
    @Inject(TENANT_NAMING) naming: TenantNamingPort,
    @Inject(TENANT_CACHE_INVALIDATOR) erpCache: TenantCacheInvalidatorPort,
  ) {
    super(tenants, naming, erpCache);
  }

  protected apply(tenant: Tenant): void {
    tenant.suspend();
  }
}

/** Reactivates a suspended school or converts a trial into a full subscription. */
@Injectable()
export class ActivateTenantUseCase extends TenantTransitionUseCase<{
  id: number;
}> {
  constructor(
    @Inject(MASTER_TENANT_REPOSITORY) tenants: MasterTenantRepository,
    @Inject(TENANT_NAMING) naming: TenantNamingPort,
    @Inject(TENANT_CACHE_INVALIDATOR) erpCache: TenantCacheInvalidatorPort,
  ) {
    super(tenants, naming, erpCache);
  }

  protected apply(tenant: Tenant): void {
    tenant.activate();
  }
}

/** Puts a school on trial (the legacy could only do it with manual SQL). */
@Injectable()
export class StartTenantTrialUseCase extends TenantTransitionUseCase<{
  id: number;
  trialEndsAt?: string | null;
}> {
  constructor(
    @Inject(MASTER_TENANT_REPOSITORY) tenants: MasterTenantRepository,
    @Inject(TENANT_NAMING) naming: TenantNamingPort,
    @Inject(TENANT_CACHE_INVALIDATOR) erpCache: TenantCacheInvalidatorPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(TIME_ZONE) private readonly timeZone: string,
  ) {
    super(tenants, naming, erpCache);
  }

  protected apply(tenant: Tenant, input: { trialEndsAt?: string | null }): void {
    tenant.startTrial(input.trialEndsAt, isoDate(localDate(this.clock.now(), this.timeZone)));
  }
}

/**
 * Logical deletion (legacy `colegios.php?action=delete` only removed the row,
 * leaving the school running unmonitored, bug #10). The record is kept,
 * suspended and marked as deleted; the database is preserved for backups.
 */
@Injectable()
export class DeleteTenantUseCase extends TenantTransitionUseCase<{
  id: number;
}> {
  constructor(
    @Inject(MASTER_TENANT_REPOSITORY) tenants: MasterTenantRepository,
    @Inject(TENANT_NAMING) naming: TenantNamingPort,
    @Inject(TENANT_CACHE_INVALIDATOR) erpCache: TenantCacheInvalidatorPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {
    super(tenants, naming, erpCache);
  }

  protected apply(tenant: Tenant): void {
    tenant.delete(this.clock.now());
  }
}
