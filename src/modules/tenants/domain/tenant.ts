import { BusinessRuleViolationError } from '../../../shared/domain/domain-error.js';
import { Entity, type EntityId } from '../../../shared/domain/entity.js';
import { Guard } from '../../../shared/domain/guard.js';
import { Email } from '../../../shared/domain/value-objects/email.vo.js';
import type { TenantSlug } from './tenant-slug.vo.js';
import type { TenantStatus } from './tenant-status.js';

export interface TenantProps {
  slug: TenantSlug;
  name: string;
  adminEmail: Email | null;
  adminPhone: string | null;
  status: TenantStatus;
  /** Legacy flag: the school database is installed. */
  tablesCreated: boolean;
  databaseName: string;
  /** Last day of the trial (`YYYY-MM-DD`), only meaningful while in `trial`. */
  trialEndsAt: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  /** Logical deletion: the record, the database and the slug are kept. */
  deletedAt: Date | null;
}

export interface RegisterTenantProps {
  slug: TenantSlug;
  name: string;
  adminEmail: string;
  adminPhone?: string | null;
  databaseName: string;
  initialStatus?: 'active' | 'trial';
  trialEndsAt?: string | null;
  today: string;
}

export interface UpdateTenantInfo {
  name?: string;
  adminEmail?: string;
  adminPhone?: string | null;
}

const PHONE_PATTERN = /^\+?\d{7,15}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const normalizeName = (raw: string): string => {
  const name = (raw ?? '').trim().replace(/\s+/g, ' ');
  Guard.againstEmpty(name, 'nombre');
  if (name.length < 3) {
    throw new BusinessRuleViolationError(
      'El nombre de la institución debe tener al menos 3 caracteres.',
      'INVALID_NAME',
    );
  }
  Guard.againstMaxLength(name, 200, 'nombre');
  return name;
};

const normalizePhone = (raw: string | null | undefined): string | null => {
  if (raw === null || raw === undefined) return null;
  const phone = raw.replace(/[\s().-]/g, '');
  if (phone === '') return null;
  if (!PHONE_PATTERN.test(phone)) {
    throw new BusinessRuleViolationError('El teléfono debe tener entre 7 y 15 dígitos.', 'INVALID_PHONE');
  }
  return phone;
};

const validateTrialEnd = (trialEndsAt: string | null | undefined, today: string): string | null => {
  if (!trialEndsAt) return null;
  if (!DATE_PATTERN.test(trialEndsAt) || Number.isNaN(Date.parse(`${trialEndsAt}T00:00:00Z`))) {
    throw new BusinessRuleViolationError('La fecha de fin de prueba debe tener el formato AAAA-MM-DD.', 'INVALID_DATE');
  }
  if (trialEndsAt < today) {
    throw new BusinessRuleViolationError('La fecha de fin de prueba no puede estar en el pasado.', 'INVALID_TRIAL_END');
  }
  return trialEndsAt;
};

/**
 * A school registered in the master database (`tenants`).
 *
 * Lifecycle (doc 09 §3, corrected):
 * - `active ⇄ suspended`, `trial → active | suspended`, `active | suspended → trial`.
 * - Deletion is logical: the school is suspended (so `apreu-api` blocks its
 *   login, legacy bugs #10/#11) and marked with `deletedAt`; afterwards no
 *   transition is allowed and the slug stays reserved.
 */
export class Tenant extends Entity<TenantProps> {
  private constructor(id: EntityId, props: TenantProps) {
    super(id, props);
  }

  /**
   * Builds the record of a school whose database has just been provisioned
   * (RN-SA-03/04). The director e-mail is mandatory in v2.
   */
  static register(input: RegisterTenantProps): Tenant {
    const status = input.initialStatus ?? 'active';
    if (status !== 'active' && status !== 'trial') {
      throw new BusinessRuleViolationError('Estado inicial inválido.', 'INVALID_STATUS');
    }
    Guard.againstEmpty(input.adminEmail, 'correo del director');
    return new Tenant(null, {
      slug: input.slug,
      name: normalizeName(input.name),
      adminEmail: Email.create(input.adminEmail),
      adminPhone: normalizePhone(input.adminPhone),
      status,
      tablesCreated: true,
      databaseName: input.databaseName,
      trialEndsAt: status === 'trial' ? validateTrialEnd(input.trialEndsAt, input.today) : null,
      createdAt: null,
      updatedAt: null,
      deletedAt: null,
    });
  }

  /** Rebuilds a persisted tenant without re-running creation rules. */
  static restore(id: number, props: TenantProps): Tenant {
    return new Tenant(id, { ...props });
  }

  get slug(): TenantSlug {
    return this.props.slug;
  }
  get name(): string {
    return this.props.name;
  }
  get adminEmail(): Email | null {
    return this.props.adminEmail;
  }
  get adminPhone(): string | null {
    return this.props.adminPhone;
  }
  get status(): TenantStatus {
    return this.props.status;
  }
  get tablesCreated(): boolean {
    return this.props.tablesCreated;
  }
  get databaseName(): string {
    return this.props.databaseName;
  }
  get trialEndsAt(): string | null {
    return this.props.trialEndsAt;
  }
  get createdAt(): Date | null {
    return this.props.createdAt;
  }
  get updatedAt(): Date | null {
    return this.props.updatedAt;
  }
  get deletedAt(): Date | null {
    return this.props.deletedAt;
  }
  get isDeleted(): boolean {
    return this.props.deletedAt !== null;
  }

  /** Edits the contact data (missing in the legacy, bug #20). */
  updateInfo(changes: UpdateTenantInfo): void {
    this.ensureNotDeleted();
    if (changes.name !== undefined) this.props.name = normalizeName(changes.name);
    if (changes.adminEmail !== undefined) this.props.adminEmail = Email.create(changes.adminEmail);
    if (changes.adminPhone !== undefined) this.props.adminPhone = normalizePhone(changes.adminPhone);
  }

  suspend(): void {
    this.transition(['active', 'trial'], 'suspended');
  }

  activate(): void {
    this.transition(['suspended', 'trial'], 'active');
    this.props.trialEndsAt = null;
  }

  /** Puts the school on trial, optionally until `trialEndsAt` (inclusive). */
  startTrial(trialEndsAt: string | null | undefined, today: string): void {
    const endsAt = validateTrialEnd(trialEndsAt, today);
    this.transition(['active', 'suspended'], 'trial');
    this.props.trialEndsAt = endsAt;
  }

  /** Logical deletion: suspends the school and marks the record as deleted. */
  delete(at: Date): void {
    this.ensureNotDeleted();
    this.props.status = 'suspended';
    this.props.deletedAt = at;
  }

  private transition(from: readonly TenantStatus[], to: TenantStatus): void {
    this.ensureNotDeleted();
    if (!from.includes(this.props.status)) {
      throw new BusinessRuleViolationError(
        `No se puede pasar el colegio de "${this.props.status}" a "${to}".`,
        'INVALID_STATUS_TRANSITION',
        { from: this.props.status, to },
      );
    }
    this.props.status = to;
  }

  private ensureNotDeleted(): void {
    if (this.isDeleted) {
      throw new BusinessRuleViolationError('El colegio fue eliminado y ya no admite cambios.', 'TENANT_DELETED');
    }
  }
}
