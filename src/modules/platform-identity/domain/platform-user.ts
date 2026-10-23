import { Entity } from '../../../shared/domain/entity.js';
import { Email } from '../../../shared/domain/value-objects/email.vo.js';

export const SUPERADMIN_ROLE = 'superadmin';

export interface PlatformUserProps {
  name: string;
  email: Email;
  passwordHash: string;
  role: string;
  isActive: boolean;
  lastLogin: Date | null;
}

/**
 * Operator of the platform. Stored in the `users` table of the master
 * database (legacy `superadmin/login.php`): only rows with
 * `role = 'superadmin'` and `is_active = 1` may enter the console (RN-SA-01).
 */
export class PlatformUser extends Entity<PlatformUserProps> {
  private constructor(id: number, props: PlatformUserProps) {
    super(id, props);
  }

  static restore(id: number, props: Omit<PlatformUserProps, 'email'> & { email: string }): PlatformUser {
    return new PlatformUser(id, { ...props, email: Email.create(props.email) });
  }

  get name(): string {
    return this.props.name;
  }
  get email(): Email {
    return this.props.email;
  }
  get passwordHash(): string {
    return this.props.passwordHash;
  }
  get role(): string {
    return this.props.role;
  }
  get isActive(): boolean {
    return this.props.isActive;
  }
  get lastLogin(): Date | null {
    return this.props.lastLogin;
  }

  /** RN-SA-01: active users with the superadmin role. */
  canAccessPlatform(): boolean {
    return this.props.isActive && this.props.role === SUPERADMIN_ROLE;
  }

  recordLogin(at: Date): void {
    this.props.lastLogin = at;
  }
}
