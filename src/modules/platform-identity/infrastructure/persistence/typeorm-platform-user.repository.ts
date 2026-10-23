import { Injectable } from '@nestjs/common';
import { Raw } from 'typeorm';
import { MasterDatabase } from '../../../../shared/infrastructure/persistence/master-database.js';
import { PlatformUser, SUPERADMIN_ROLE } from '../../domain/platform-user.js';
import type { PlatformUserRepository } from '../../domain/platform-user.repository.js';
import { PlatformUserOrmEntity } from './platform-user.orm-entity.js';

const toDomain = (row: PlatformUserOrmEntity): PlatformUser =>
  PlatformUser.restore(row.id, {
    name: row.name,
    email: row.email,
    passwordHash: row.password,
    role: row.role,
    isActive: row.isActive === true,
    lastLogin: row.lastLogin,
  });

/**
 * Reads superadmins from the master `users` table. Rows with other roles are
 * never loaded, so a school administrator of the template database cannot
 * reach the console (legacy issue #25).
 */
@Injectable()
export class TypeOrmPlatformUserRepository implements PlatformUserRepository {
  constructor(private readonly db: MasterDatabase) {}

  async findByEmail(email: string): Promise<PlatformUser | null> {
    const repo = await this.db.repository(PlatformUserOrmEntity);
    // Legacy rows may keep mixed-case e-mails; the lookup matches lower(email) (ADR-0008).
    const row = await repo.findOne({
      where: {
        email: Raw((column) => `lower(${column}) = :email`, { email: email.toLowerCase() }),
        role: SUPERADMIN_ROLE,
      },
    });
    return row ? toDomain(row) : null;
  }

  async findById(id: number): Promise<PlatformUser | null> {
    const repo = await this.db.repository(PlatformUserOrmEntity);
    const row = await repo.findOne({ where: { id, role: SUPERADMIN_ROLE } });
    return row ? toDomain(row) : null;
  }

  async saveLastLogin(user: PlatformUser): Promise<void> {
    const repo = await this.db.repository(PlatformUserOrmEntity);
    await repo.update({ id: user.id as number }, { lastLogin: user.lastLogin });
  }
}
