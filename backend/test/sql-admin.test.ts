import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db.js';
import { Client, expectOk, flushEmails, lastLink, resetDb, tokenFromLink } from './helpers.js';

beforeEach(resetDb);

describe('a system admin added by hand in SQL, without a password', () => {
  it('cannot sign in until it sets a password through "Forgot password"', async () => {
    // Exactly what the operator runs in Neon's SQL Editor.
    await prisma.$executeRawUnsafe(`
      INSERT INTO users (id, school_id, email, full_name, role, status, updated_at)
      VALUES (gen_random_uuid(), NULL, lower('Owner@Example.com'), 'Platform Owner',
              'SYSTEM_ADMIN', 'ACTIVE', now());`);

    const admin = new Client();
    expect((await admin.login('owner@example.com', 'anything-at-all-123')).status).toBe(401);

    expect((await admin.post('/auth/password/forgot', { email: 'owner@example.com' })).status).toBe(
      202,
    );
    await flushEmails();
    const token = tokenFromLink(lastLink('owner@example.com'));
    expectOk(
      await admin.post('/auth/password/reset', { token, password: 'Granite-Harbour-Lamp-73' }),
    );

    expectOk(await admin.login('owner@example.com', 'Granite-Harbour-Lamp-73'));
    expect(expectOk(await admin.get('/auth/me')).body.data.role).toBe('SYSTEM_ADMIN');
    expectOk(await admin.get('/admin/overview'));
  });
});
