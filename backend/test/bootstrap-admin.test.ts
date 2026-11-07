import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db.js';
import { bootstrapSystemAdmin } from '../src/jobs/bootstrapAdmin.js';
import { Client, createSchoolWithHeadmaster, expectOk, resetDb } from './helpers.js';

beforeEach(resetDb);

const settings = {
  email: 'Owner@Example.com',
  name: 'Platform Owner',
  password: 'Granite-Harbour-Lamp-73',
};

describe('creating the system admin at start-up', () => {
  it('does nothing without settings', async () => {
    expect(await bootstrapSystemAdmin({})).toBe('skipped');
    expect(await prisma.user.count({ where: { role: 'SYSTEM_ADMIN' } })).toBe(0);
  });

  it('creates the admin once, who can then sign in, and never replaces it', async () => {
    expect(await bootstrapSystemAdmin(settings)).toBe('created');
    const admin = new Client();
    expectOk(await admin.login('owner@example.com', settings.password));
    expect(expectOk(await admin.get('/auth/me')).body.data.role).toBe('SYSTEM_ADMIN');

    // Restarting with the settings still there (or changed) changes nothing.
    expect(
      await bootstrapSystemAdmin({
        ...settings,
        email: 'other@example.com',
        password: 'Another-Long-Passphrase-1',
      }),
    ).toBe('skipped');
    expect(await prisma.user.count({ where: { role: 'SYSTEM_ADMIN' } })).toBe(1);
    expectOk(await new Client().login('owner@example.com', settings.password));
    expect(
      await prisma.auditLog.count({ where: { action: 'system_admin.created_by_operator' } }),
    ).toBe(1);
  });

  it('refuses a weak password, a missing setting, or an email someone already uses', async () => {
    expect(await bootstrapSystemAdmin({ ...settings, password: 'short' })).toBe('skipped');
    expect(await bootstrapSystemAdmin({ email: settings.email, password: settings.password })).toBe(
      'skipped',
    );
    await createSchoolWithHeadmaster('Ipel', 'head@ipel.example');
    expect(await bootstrapSystemAdmin({ ...settings, email: 'head@ipel.example' })).toBe('skipped');
    expect(await prisma.user.count({ where: { role: 'SYSTEM_ADMIN' } })).toBe(0);
  });
});
