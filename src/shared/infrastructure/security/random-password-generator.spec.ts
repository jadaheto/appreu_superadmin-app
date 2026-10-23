import { CryptoPasswordGenerator } from './random-password-generator.js';

describe('CryptoPasswordGenerator', () => {
  const generator = new CryptoPasswordGenerator();

  it('generates 16-character passwords with every character class', () => {
    for (let i = 0; i < 50; i++) {
      const password = generator.generate();
      expect(password).toHaveLength(16);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[2-9]/);
      expect(password).toMatch(/[!@#$%*\-_+=?]/);
      expect(password).not.toMatch(/[0O1lI]/);
    }
  });

  it('does not repeat passwords', () => {
    const passwords = new Set(Array.from({ length: 200 }, () => generator.generate()));
    expect(passwords.size).toBe(200);
  });

  it('refuses weak lengths', () => {
    expect(() => new CryptoPasswordGenerator(8)).toThrow();
  });
});
