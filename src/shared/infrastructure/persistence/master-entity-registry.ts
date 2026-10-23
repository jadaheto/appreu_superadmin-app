import type { EntitySchema, MixedList } from 'typeorm';

type EntityClass = Function | string | EntitySchema;

/**
 * Collects the ORM entities mapped to the master database. Each module
 * registers its entities from `infrastructure/persistence/index.ts`; the
 * {@link MasterDatabase} reads them when it opens the connection.
 */
export class MasterEntityRegistry {
  private static readonly entities = new Set<EntityClass>();

  static register(...entities: EntityClass[]): void {
    entities.forEach((entity) => this.entities.add(entity));
  }

  static all(): MixedList<EntityClass> {
    return [...this.entities];
  }
}
