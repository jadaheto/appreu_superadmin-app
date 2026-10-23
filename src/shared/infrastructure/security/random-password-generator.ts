import { randomInt } from 'node:crypto';
import type { PasswordGeneratorPort } from '../../application/ports/password-generator.port.js';

const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%*-_+=?';
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

/**
 * Cryptographically secure generator (replaces the fixed default password of
 * `api/create_tenant.php`, legacy bug #2). Always includes lower, upper, digit
 * and symbol; ambiguous characters (0/O, 1/l/I) are excluded.
 */
export class CryptoPasswordGenerator implements PasswordGeneratorPort {
  constructor(private readonly length = 16) {
    if (length < 12) throw new Error('La contraseña generada debe tener al menos 12 caracteres.');
  }

  generate(): string {
    const pick = (alphabet: string) => alphabet[randomInt(alphabet.length)];
    const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
    while (chars.length < this.length) chars.push(pick(ALL));
    for (let i = chars.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  }
}
