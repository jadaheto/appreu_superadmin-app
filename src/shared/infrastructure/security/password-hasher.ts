import { Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import type { PasswordHasherPort } from '../../application/ports/password-hasher.port.js';

const COST = 12;

/**
 * bcrypt adapter. Legacy PHP hashes use the `$2y$` prefix, which is the same
 * algorithm as `$2b$`; it is normalized before comparing so existing users
 * keep their passwords.
 */
@Injectable()
export class BcryptPasswordHasher implements PasswordHasherPort {
  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, COST);
  }

  verify(plain: string, hash: string): Promise<boolean> {
    if (!hash) return Promise.resolve(false);
    const normalized = hash.startsWith('$2y$') ? `$2b$${hash.slice(4)}` : hash;
    return bcrypt.compare(plain, normalized);
  }
}
