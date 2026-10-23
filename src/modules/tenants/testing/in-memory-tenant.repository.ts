import { ConflictError } from '../../../shared/domain/domain-error.js';
import { toOffset, type PageRequest, type Paginated } from '../../../shared/domain/pagination.js';
import { InMemoryStore } from '../../../shared/testing/fakes.js';
import { Tenant } from '../domain/tenant.js';
import type { MasterTenantRepository, TenantSearchCriteria } from '../domain/tenant.repository.js';
import { TenantSlug } from '../domain/tenant-slug.vo.js';
import type { TenantStatus } from '../domain/tenant-status.js';

export class InMemoryTenantRepository implements MasterTenantRepository {
  readonly store = new InMemoryStore<Tenant>();
  saves = 0;
  failNextSave: Error | null = null;

  async findById(id: number): Promise<Tenant | null> {
    return this.store.get(id);
  }

  async findBySlug(slug: string): Promise<Tenant | null> {
    return this.store.all().find((t) => t.slug.toString() === slug) ?? null;
  }

  async search(criteria: TenantSearchCriteria, page: PageRequest): Promise<Paginated<Tenant>> {
    const term = criteria.search?.toLowerCase();
    const matches = this.store
      .all()
      .filter((t) => criteria.includeDeleted || !t.isDeleted)
      .filter((t) => !criteria.status || t.status === criteria.status)
      .filter(
        (t) =>
          !term ||
          t.slug.toString().includes(term) ||
          t.name.toLowerCase().includes(term) ||
          (t.adminEmail?.toString().includes(term) ?? false),
      );
    const offset = toOffset(page);
    return {
      items: matches.slice(offset, offset + page.limit),
      total: matches.length,
      ...page,
    };
  }

  async save(tenant: Tenant): Promise<void> {
    if (this.failNextSave) {
      const error = this.failNextSave;
      this.failNextSave = null;
      throw error;
    }
    const duplicate = this.store.all().find((t) => t.slug.equals(tenant.slug) && t !== tenant);
    if (duplicate) throw new ConflictError('El slug ya está registrado.');
    this.saves++;
    this.store.save(tenant);
  }

  /** Test helper: stores a persisted tenant. */
  seed(slug: string, status: TenantStatus = 'active', deletedAt: Date | null = null): Tenant {
    const tenant = Tenant.restore(this.store.all().length + 1, {
      slug: TenantSlug.restore(slug),
      name: `Colegio ${slug}`,
      adminEmail: null,
      adminPhone: null,
      status,
      tablesCreated: true,
      databaseName: `apreu_${slug.replace(/-/g, '_')}`,
      trialEndsAt: null,
      createdAt: new Date('2026-01-10T12:00:00Z'),
      updatedAt: null,
      deletedAt,
    });
    this.store.save(tenant);
    return tenant;
  }
}
