import { hash, verify } from '@node-rs/argon2';
import { PASSWORD_MIN_LENGTH } from '@school/shared';
import { COMMON_PASSWORDS } from './commonPasswords.js';

const OPTIONS = {
  algorithm: 2, // Argon2id (the package exports this as a const enum)
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** A fixed hash used to spend the same time when the account does not exist. */
let dummyHash: string | undefined;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= await hashPassword('dummy-password-for-timing');
  await verifyPassword(dummyHash, password);
}

/** Returns an error message, or null when the password is acceptable. */
export function passwordProblem(password: string, context: string[] = []): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return 'This password is too common. Choose another.';
  if (/^(.)\1+$/.test(password)) return 'This password is too easy to guess. Choose another.';
  for (const word of context) {
    if (word.length >= 4 && lower.includes(word.toLowerCase())) {
      return 'Do not use your name, email or staff ID in your password';
    }
  }
  return null;
}
