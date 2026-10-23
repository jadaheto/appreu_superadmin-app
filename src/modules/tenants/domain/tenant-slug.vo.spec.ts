import { BusinessRuleViolationError } from '../../../shared/domain/domain-error.js';
import { databaseNameFor } from './tenant-database-name.js';
import { TenantSlug } from './tenant-slug.vo.js';

describe('TenantSlug', () => {
  it('normalizes case and whitespace', () => {
    expect(TenantSlug.create('  Colegio-San-Jose ').toString()).toBe('colegio-san-jose');
  });

  it.each([
    'ab',
    'a'.repeat(61),
    'con espacio',
    'con_guion_bajo',
    '-inicio',
    'fin-',
    'doble--guion',
    'ñandú',
    'a;drop',
  ])('rejects "%s"', (raw) => {
    expect(() => TenantSlug.create(raw)).toThrow(BusinessRuleViolationError);
  });

  it.each(['superadmin', 'api', 'www', 'apreu'])('rejects the reserved slug "%s"', (raw) => {
    expect(() => TenantSlug.create(raw)).toThrow(expect.objectContaining({ code: 'RESERVED_SLUG' }));
  });

  it('accepts digits and single dashes', () => {
    expect(TenantSlug.create('ie-123-norte').toString()).toBe('ie-123-norte');
  });
});

describe('databaseNameFor', () => {
  it('replaces dashes with underscores (legacy rule)', () => {
    expect(databaseNameFor('apreu_', 'colegio-san-jose')).toBe('apreu_colegio_san_jose');
  });

  it('accepts up to 63 characters (PostgreSQL identifier limit)', () => {
    expect(databaseNameFor('apreu_', 'a'.repeat(57))).toHaveLength(63);
  });

  it('rejects names longer than 63 characters', () => {
    expect(() => databaseNameFor('apreu_', 'a'.repeat(58))).toThrow(
      expect.objectContaining({ code: 'DATABASE_NAME_TOO_LONG' }),
    );
  });
});
