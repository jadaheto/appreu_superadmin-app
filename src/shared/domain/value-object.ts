/**
 * Base class for immutable value objects compared by value.
 */
export abstract class ValueObject<TValue> {
  protected constructor(protected readonly value: TValue) {
    Object.freeze(this);
  }

  equals(other?: ValueObject<TValue>): boolean {
    if (!other || other.constructor !== this.constructor) return false;
    return JSON.stringify(this.value) === JSON.stringify(other.value);
  }
}
