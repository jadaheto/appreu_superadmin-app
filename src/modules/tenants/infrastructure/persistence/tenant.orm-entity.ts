import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { TenantStatus } from '../../domain/tenant-status.js';

/**
 * `tenants` table of the master database (`database/postgres/master-schema.sql`).
 * `status` is a `varchar` + `CHECK` (ADR-0008: no PostgreSQL `ENUM` types).
 */
@Entity({ name: 'tenants' })
export class TenantOrmEntity {
  @PrimaryGeneratedColumn('identity', { type: 'integer', generatedIdentity: 'BY DEFAULT' })
  id: number;

  @Column({ type: 'varchar', length: 60, unique: true })
  slug: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ name: 'admin_email', type: 'varchar', length: 150, nullable: true })
  adminEmail: string | null;

  @Column({ name: 'admin_phone', type: 'varchar', length: 30, nullable: true })
  adminPhone: string | null;

  @Column({ type: 'varchar', length: 10, default: 'active' })
  status: TenantStatus;

  @Column({ name: 'tables_created', type: 'boolean', default: false })
  tablesCreated: boolean;

  @Column({ name: 'db_name', type: 'varchar', length: 64, nullable: true })
  dbName: string | null;

  @Column({ name: 'trial_ends_at', type: 'date', nullable: true })
  trialEndsAt: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
