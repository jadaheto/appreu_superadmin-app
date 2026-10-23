/** Abstraction over the system clock so time-dependent rules are testable. */
export interface ClockPort {
  now(): Date;
}

export const CLOCK = Symbol('ClockPort');
