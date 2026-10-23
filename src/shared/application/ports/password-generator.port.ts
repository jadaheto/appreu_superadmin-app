/** Generates strong one-time passwords (e.g. the initial password of a school director). */
export interface PasswordGeneratorPort {
  generate(): string;
}

export const PASSWORD_GENERATOR = Symbol('PasswordGeneratorPort');
