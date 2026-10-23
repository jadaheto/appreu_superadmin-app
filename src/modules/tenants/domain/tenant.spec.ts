import { BusinessRuleViolationError } from '../../../shared/domain/domain-error.js';
import { Tenant, type RegisterTenantProps } from './tenant.js';
import { TenantSlug } from './tenant-slug.vo.js';

const TODAY = '2026-03-15';

const register = (overrides: Partial<RegisterTenantProps> = {}) =>
  Tenant.register({
    slug: TenantSlug.create('colegio-norte'),
    name: '  IE   Colegio Norte ',
    adminEmail: 'Director@Norte.edu.co',
    adminPhone: '300 123 4567',
    databaseName: 'apreu_colegio_norte',
    today: TODAY,
    ...overrides,
  });

describe('Tenant', () => {
  describe('register', () => {
    it('normalizes the data and marks the database as installed', () => {
      const tenant = register();
      expect(tenant.isNew).toBe(true);
      expect(tenant.name).toBe('IE Colegio Norte');
      expect(tenant.adminEmail?.toString()).toBe('director@norte.edu.co');
      expect(tenant.adminPhone).toBe('3001234567');
      expect(tenant.status).toBe('active');
      expect(tenant.tablesCreated).toBe(true);
      expect(tenant.trialEndsAt).toBeNull();
    });

    it('supports starting on trial with an end date', () => {
      const tenant = register({
        initialStatus: 'trial',
        trialEndsAt: '2026-04-30',
      });
      expect(tenant.status).toBe('trial');
      expect(tenant.trialEndsAt).toBe('2026-04-30');
    });

    it.each([
      [{ name: 'IE' }, 'INVALID_NAME'],
      [{ name: 'x'.repeat(201) }, 'MAX_LENGTH'],
      [{ adminEmail: '' }, 'REQUIRED_FIELD'],
      [{ adminEmail: 'no-es-correo' }, 'INVALID_EMAIL'],
      [{ adminPhone: '12ab' }, 'INVALID_PHONE'],
      [{ initialStatus: 'trial' as const, trialEndsAt: '2026-01-01' }, 'INVALID_TRIAL_END'],
      [{ initialStatus: 'trial' as const, trialEndsAt: '15/04/2026' }, 'INVALID_DATE'],
      [{ initialStatus: 'suspended' as any }, 'INVALID_STATUS'],
    ])('rejects invalid input %o', (overrides, code) => {
      expect(() => register(overrides)).toThrow(expect.objectContaining({ code }));
    });

    it('treats a blank phone as absent', () => {
      expect(register({ adminPhone: '  ' }).adminPhone).toBeNull();
    });
  });

  describe('lifecycle', () => {
    it('suspends and reactivates', () => {
      const tenant = register();
      tenant.suspend();
      expect(tenant.status).toBe('suspended');
      tenant.activate();
      expect(tenant.status).toBe('active');
    });

    it('puts a school on trial and converts it to active, clearing the end date', () => {
      const tenant = register();
      tenant.startTrial('2026-05-01', TODAY);
      expect(tenant.status).toBe('trial');
      expect(tenant.trialEndsAt).toBe('2026-05-01');
      tenant.activate();
      expect(tenant.trialEndsAt).toBeNull();
    });

    it('rejects transitions to the same status', () => {
      const tenant = register();
      expect(() => tenant.activate()).toThrow(expect.objectContaining({ code: 'INVALID_STATUS_TRANSITION' }));
      tenant.suspend();
      expect(() => tenant.suspend()).toThrow(BusinessRuleViolationError);
    });

    it('deletes logically: suspended, dated and frozen', () => {
      const tenant = register();
      const at = new Date('2026-03-15T15:00:00Z');
      tenant.delete(at);
      expect(tenant.status).toBe('suspended');
      expect(tenant.deletedAt).toEqual(at);
      expect(tenant.isDeleted).toBe(true);
      for (const action of [
        () => tenant.activate(),
        () => tenant.startTrial(null, TODAY),
        () => tenant.updateInfo({ name: 'Otro nombre' }),
        () => tenant.delete(at),
      ]) {
        expect(action).toThrow(expect.objectContaining({ code: 'TENANT_DELETED' }));
      }
    });
  });

  it('updates the contact data', () => {
    const tenant = register();
    tenant.updateInfo({
      name: 'Colegio Norte Bilingüe',
      adminEmail: 'rector@norte.co',
      adminPhone: null,
    });
    expect(tenant.name).toBe('Colegio Norte Bilingüe');
    expect(tenant.adminEmail?.toString()).toBe('rector@norte.co');
    expect(tenant.adminPhone).toBeNull();
  });
});
