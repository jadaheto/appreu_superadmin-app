import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { DataSource, type EntityTarget, type ObjectLiteral, type Repository } from 'typeorm';
import { ENVIRONMENT, type Environment } from '../config/environment.js';
import { MasterEntityRegistry } from './master-entity-registry.js';

/**
 * Lazily opened TypeORM connection pool to the master database
 * (`tenants` registry + superadmin `users`). Opening on first use lets the API
 * boot (and serve `/health`, `/docs`) even when the database is down.
 */
@Injectable()
export class MasterDatabase implements OnModuleDestroy {
  private readonly logger = new Logger(MasterDatabase.name);
  private connecting: Promise<DataSource> | null = null;

  constructor(@Inject(ENVIRONMENT) private readonly env: Environment) {}

  dataSource(): Promise<DataSource> {
    if (!this.connecting) {
      this.connecting = this.open();
      this.connecting.catch(() => (this.connecting = null));
    }
    return this.connecting;
  }

  async repository<T extends ObjectLiteral>(entity: EntityTarget<T>): Promise<Repository<T>> {
    return (await this.dataSource()).getRepository(entity);
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.dataSource()).query(sql, params);
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.connecting) return;
    const dataSource = await this.connecting.catch(() => null);
    if (dataSource?.isInitialized) await dataSource.destroy();
  }

  private async open(): Promise<DataSource> {
    const { host, port, username, password, database } = this.env.masterDb;
    const dataSource = new DataSource({
      type: 'postgres',
      host,
      port,
      username,
      password,
      database,
      applicationName: 'superadmin-api',
      connectTimeoutMS: this.env.tenantDb.connectTimeoutMs,
      entities: MasterEntityRegistry.all(),
      synchronize: false,
      migrationsRun: false,
      // ADR-0008: the master database works in UTC (startup option, no extra round trip).
      extra: { max: 5, options: '-c TimeZone=UTC' },
      logging: ['error'],
    });
    await dataSource.initialize();
    this.logger.log(`Conectado a la BD maestra ${database}`);
    return dataSource;
  }
}
