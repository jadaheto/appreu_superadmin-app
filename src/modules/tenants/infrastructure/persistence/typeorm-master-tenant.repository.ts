import { Inject, Injectable } from '@nestjs/common';
import { Brackets } from 'typeorm';
import { ConflictError } from '../../../../shared/domain/domain-error.js';
import { toOffset, type PageRequest, type Paginated } from '../../../../shared/domain/pagination.js';
import { MasterDatabase } from '../../../../shared/infrastructure/persistence/master-database.js';
import { TENANT_NAMING, type TenantNamingPort } from '../../application/ports/tenant-naming.port.js';
import type { Tenant } from '../../domain/tenant.js';
import type { MasterTenantRepository, TenantSearchCriteria } from '../../domain/tenant.repository.js';
import { TenantMapper } from './tenant.mapper.js';
import { TenantOrmEntity } from './tenant.orm-entity.js';

const UNIQUE_VIOLATION = '23505';

/** TypeORM adapter of {@link MasterTenantRepository} over the master `tenants` table. */
@Injectable()
export class TypeOrmMasterTenantRepository implements MasterTenantRepository {
  constructor(
    private readonly db: MasterDatabase,
    @Inject(TENANT_NAMING) private readonly naming: TenantNamingPort,
  ) {}

  async findById(id: number): Promise<Tenant | null> {
    const row = await (await this.db.repository(TenantOrmEntity)).findOne({ where: { id } });
    return row ? this.toDomain(row) : null;
  }

  async findBySlug(slug: string): Promise<Tenant | null> {
    const row = await (await this.db.repository(TenantOrmEntity)).findOne({ where: { slug } });
    return row ? this.toDomain(row) : null;
  }

  async search(criteria: TenantSearchCriteria, page: PageRequest): Promise<Paginated<Tenant>> {
    const query = (await this.db.repository(TenantOrmEntity)).createQueryBuilder('t');
    if (!criteria.includeDeleted) query.andWhere('t.deleted_at IS NULL');
    if (criteria.status) query.andWhere('t.status = :status', { status: criteria.status });
    if (criteria.search) {
      // Insensitive to case and accents like the old utf8mb4_general_ci collation (ADR-0008:
      // f_unaccent + ILIKE, trigram index); `\\` is the default LIKE escape of PostgreSQL.
      const term = `%${criteria.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      query.andWhere(
        new Brackets((where) =>
          where
            .where('t.slug ILIKE :term', { term })
            .orWhere('f_unaccent(t.name) ILIKE f_unaccent(:term)')
            .orWhere('t.admin_email ILIKE :term'),
        ),
      );
    }
    const [rows, total] = await query
      .orderBy('t.created_at', 'DESC')
      .addOrderBy('t.id', 'DESC')
      .skip(toOffset(page))
      .take(page.limit)
      .getManyAndCount();
    return {
      items: rows.map((row) => this.toDomain(row)),
      total,
      page: page.page,
      limit: page.limit,
    };
  }

  async save(tenant: Tenant): Promise<void> {
    const repo = await this.db.repository(TenantOrmEntity);
    try {
      const saved = await repo.save(TenantMapper.toOrm(tenant));
      if (tenant.isNew) tenant.assignId(saved.id);
    } catch (error) {
      // 23505 = unique_violation (slug).
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new ConflictError('El slug ya está registrado.', {
          slug: tenant.slug.toString(),
        });
      }
      throw error;
    }
  }

  private toDomain(row: TenantOrmEntity): Tenant {
    return TenantMapper.toDomain(row, (slug) => this.naming.databaseNameFor(slug));
  }
}
