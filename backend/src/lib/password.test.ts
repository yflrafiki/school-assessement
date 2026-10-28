import { describe, expect, it } from 'vitest';
import { hashPassword, passwordProblem, verifyPassword } from './password.js';
import { hashToken, newToken } from './tokens.js';
import { zonedMidnightUtc } from './dates.js';

describe('passwords', () => {
  it('hashes with Argon2id and verifies', async () => {
    const hash = await hashPassword('a-long-enough-password');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'a-long-enough-password')).toBe(true);
    expect(await verifyPassword(hash, 'wrong-password-here')).toBe(false);
  });

  it('rejects short, common and personal passwords', () => {
    expect(passwordProblem('short')).toMatch(/at least 10/);
    expect(passwordProblem('Password123')).toMatch(/too common/);
    expect(passwordProblem('aaaaaaaaaaaa')).toMatch(/easy to guess/);
    expect(passwordProblem('kwame-mensah-2026', ['Kwame', 'Mensah'])).toMatch(/name/);
    expect(passwordProblem('blue-river-sunrise-42')).toBeNull();
  });
});

describe('tokens', () => {
  it('are 32 random bytes and stored only as SHA-256', () => {
    const t = newToken();
    expect(Buffer.from(t, 'base64url')).toHaveLength(32);
    expect(hashToken(t)).toMatch(/^[a-f0-9]{64}$/);
    expect(newToken()).not.toBe(t);
  });
});

describe('zonedMidnightUtc', () => {
  it('handles GMT and offset zones', () => {
    expect(zonedMidnightUtc('2026-10-28', 'Africa/Accra').toISOString()).toBe(
      '2026-10-28T00:00:00.000Z',
    );
    expect(zonedMidnightUtc('2026-10-28', 'Africa/Lagos').toISOString()).toBe(
      '2026-10-27T23:00:00.000Z',
    );
  });
});
