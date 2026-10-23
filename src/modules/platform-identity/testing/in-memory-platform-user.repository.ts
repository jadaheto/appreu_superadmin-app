import type { PlatformUser } from '../domain/platform-user.js';
import type { PlatformUserRepository } from '../domain/platform-user.repository.js';

export class InMemoryPlatformUserRepository implements PlatformUserRepository {
  readonly users = new Map<number, PlatformUser>();
  readonly loginsSaved: number[] = [];

  add(user: PlatformUser): void {
    this.users.set(user.id as number, user);
  }

  async findByEmail(email: string): Promise<PlatformUser | null> {
    return [...this.users.values()].find((user) => user.email.toString() === email) ?? null;
  }

  async findById(id: number): Promise<PlatformUser | null> {
    return this.users.get(id) ?? null;
  }

  async saveLastLogin(user: PlatformUser): Promise<void> {
    this.loginsSaved.push(user.id as number);
  }
}
