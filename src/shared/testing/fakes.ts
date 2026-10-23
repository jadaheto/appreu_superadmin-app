import type { ClockPort } from '../application/ports/clock.port.js';
import type { PasswordGeneratorPort } from '../application/ports/password-generator.port.js';
import type { PasswordHasherPort } from '../application/ports/password-hasher.port.js';

/** Clock frozen at a given instant; `advance` moves it forward. */
export class FixedClock implements ClockPort {
  constructor(private current = new Date('2026-03-15T15:00:00Z')) {}
  now(): Date {
    return new Date(this.current);
  }
  set(date: Date): void {
    this.current = date;
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** Reversible "hash" for fast, deterministic tests. */
export class FakePasswordHasher implements PasswordHasherPort {
  async hash(plain: string): Promise<string> {
    return `hashed:${plain}`;
  }
  async verify(plain: string, hash: string): Promise<boolean> {
    return hash === `hashed:${plain}`;
  }
}

/** Returns a predictable sequence of passwords. */
export class SequentialPasswordGenerator implements PasswordGeneratorPort {
  private counter = 0;
  generate(): string {
    return `Temp#Pass${++this.counter}xyz`;
  }
}

/** Generic in-memory store with auto-incremented ids, base for repository fakes. */
export class InMemoryStore<T extends { id: number | null; isNew: boolean; assignId(id: number): void }> {
  readonly items = new Map<number, T>();
  private sequence = 0;

  save(item: T): void {
    if (item.isNew) item.assignId(++this.sequence);
    this.sequence = Math.max(this.sequence, item.id as number);
    this.items.set(item.id as number, item);
  }

  get(id: number): T | null {
    return this.items.get(id) ?? null;
  }

  all(): T[] {
    return [...this.items.values()];
  }
}
