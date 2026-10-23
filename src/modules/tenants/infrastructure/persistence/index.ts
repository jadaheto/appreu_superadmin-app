import { MasterEntityRegistry } from '../../../../shared/infrastructure/persistence/master-entity-registry.js';
import { TenantOrmEntity } from './tenant.orm-entity.js';

MasterEntityRegistry.register(TenantOrmEntity);

export { TenantOrmEntity } from './tenant.orm-entity.js';
export { TypeOrmMasterTenantRepository } from './typeorm-master-tenant.repository.js';
