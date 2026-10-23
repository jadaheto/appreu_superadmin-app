import { MasterEntityRegistry } from '../../../../shared/infrastructure/persistence/master-entity-registry.js';
import { PlatformUserOrmEntity } from './platform-user.orm-entity.js';

MasterEntityRegistry.register(PlatformUserOrmEntity);

export { PlatformUserOrmEntity } from './platform-user.orm-entity.js';
export { TypeOrmPlatformUserRepository } from './typeorm-platform-user.repository.js';
