import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** `users` table of the master database (only superadmin rows are read). */
@Entity({ name: 'users' })
export class PlatformUserOrmEntity {
  @PrimaryGeneratedColumn('identity', { type: 'integer', generatedIdentity: 'BY DEFAULT' })
  id: number;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'varchar', length: 150 })
  email: string;

  @Column({ type: 'varchar', length: 255 })
  password: string;

  @Column({ type: 'varchar', length: 20 })
  role: string;

  @Column({ name: 'is_active', type: 'boolean' })
  isActive: boolean;

  @Column({ name: 'last_login', type: 'timestamptz', nullable: true })
  lastLogin: Date | null;
}
