import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db.js';
import { hashPassword } from '../src/lib/password.js';
import {
  Client,
  createActiveTeacher,
  createSchoolWithHeadmaster,
  expectOk,
  flushEmails,
  mail,
  PASSWORD,
  resetDb,
} from './helpers.js';

beforeEach(resetDb);

async function systemAdmin() {
  await prisma.user.create({
    data: {
      schoolId: null,
      email: 'owner@old.example',
      fullName: 'System Owner',
      role: 'SYSTEM_ADMIN',
      status: 'ACTIVE',
      passwordHash: await hashPassword(PASSWORD),
    },
  });
  const tab = new Client();
  expectOk(await tab.login('owner@old.example'));
  return tab;
}

describe('changing your own sign-in email', () => {
  it('needs the password, tells the old address, and signs out other devices', async () => {
    const admin = await systemAdmin();
    const otherDevice = new Client();
    expectOk(await otherDevice.login('owner@old.example'));

    const res = expectOk(
      await admin.patch('/auth/me/email', {
        email: ' Owner@New.Example ',
        currentPassword: PASSWORD,
      }),
    );
    expect(res.body.data.email).toBe('owner@new.example');

    // This tab stays signed in; the other device does not.
    expectOk(await admin.get('/auth/me'));
    expect((await otherDevice.get('/auth/me')).status).toBe(401);

    // The old address is told, with the new one in the message.
    await flushEmails();
    const notice = [...mail.sent].reverse().find((m) => m.to === 'owner@old.example');
    expect(notice?.template).toBe('EMAIL_CHANGED');
    expect(notice?.params.new_email).toBe('owner@new.example');

    expect((await new Client().login('owner@old.example')).status).toBe(401);
    expectOk(await new Client().login('owner@new.example'));
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'user.email_changed' } });
    expect(log.metadata).toMatchObject({ from: 'owner@old.example', to: 'owner@new.example' });
  });

  it('refuses a wrong password, an address someone uses, or the same address', async () => {
    const admin = await systemAdmin();
    await createSchoolWithHeadmaster('Ipel', 'head@ipel.example');

    const wrong = await admin.patch('/auth/me/email', {
      email: 'owner@new.example',
      currentPassword: 'not-my-password',
    });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.details.fields.currentPassword).toBeDefined();

    const taken = await admin.patch('/auth/me/email', {
      email: 'head@ipel.example',
      currentPassword: PASSWORD,
    });
    expect(taken.body.error.details.fields.email[0]).toMatch(/Another account/);

    const same = await admin.patch('/auth/me/email', {
      email: 'owner@old.example',
      currentPassword: PASSWORD,
    });
    expect(same.body.error.details.fields.email[0]).toMatch(/already your email/);

    expect(await prisma.user.count({ where: { email: 'owner@old.example' } })).toBe(1);
  });

  it('works for the headmaster too, but not for teachers', async () => {
    const { client: head } = await createSchoolWithHeadmaster();
    expectOk(
      await head.patch('/auth/me/email', {
        email: 'headmaster@ipel.example',
        currentPassword: PASSWORD,
      }),
    );
    const { client: teacher } = await createActiveTeacher(head, {
      fullName: 'Ama Owusu',
      email: 'ama@test.example',
      staffId: 'GES-2',
    });
    expect(
      (
        await teacher.patch('/auth/me/email', {
          email: 'ama2@test.example',
          currentPassword: PASSWORD,
        })
      ).status,
    ).toBe(403);
  });
});
