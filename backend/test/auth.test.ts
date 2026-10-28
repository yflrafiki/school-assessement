import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db.js';
import {
  Client,
  PASSWORD,
  app,
  createSchoolWithHeadmaster,
  expectOk,
  flushEmails,
  lastLink,
  mail,
  resetDb,
  tokenFromLink,
} from './helpers.js';
import request from 'supertest';

beforeEach(resetDb);

describe('login and sessions', () => {
  it('logs in, returns me with permissions, and logs out', async () => {
    const { client } = await createSchoolWithHeadmaster();
    const me = expectOk(await client.get('/auth/me'));
    expect(me.body.data.role).toBe('HEADMASTER');
    expect(me.body.data.permissions).toContain('teachers.manage');

    expect((await client.post('/auth/logout')).status).toBe(204);
    expect((await client.get('/auth/me')).status).toBe(401);
  });

  it('answers wrong email and wrong password identically', async () => {
    await createSchoolWithHeadmaster();
    const a = await new Client().login('head@test.example', 'not-the-password');
    const b = await new Client().login('nobody@test.example', 'not-the-password');
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it('returns the session token in the body and never sets a cookie', async () => {
    await createSchoolWithHeadmaster();
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'head@test.example', password: PASSWORD });
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.body.data.token).toMatch(/^[\w-]{43}$/);
    // Only the hash is stored.
    expect(await prisma.session.count({ where: { tokenHash: res.body.data.token } })).toBe(0);
  });

  it('locks the account after five failures', async () => {
    await createSchoolWithHeadmaster();
    for (let i = 0; i < 5; i += 1)
      await new Client().login('head@test.example', 'wrong-password-x');
    const res = await new Client().login('head@test.example');
    expect(res.status).toBe(429);
  });

  it('only accepts the session as a Bearer token', async () => {
    const { client } = await createSchoolWithHeadmaster();
    const noToken = await client.agent
      .post('/api/v1/classes')
      .send({ level: 'BASIC_7', name: 'B7A' });
    expect(noToken.status).toBe(401);
    const asCookie = await client.agent.get('/api/v1/auth/me').set('Cookie', `sid=${client.token}`);
    expect(asCookie.status).toBe(401);
    const forged = await client.agent
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${'x'.repeat(43)}`);
    expect(forged.status).toBe(401);
    expect((await client.post('/classes', { level: 'BASIC_7', name: 'B7A' })).status).toBe(201);
  });

  it('keeps a headmaster and a teacher signed in side by side, like two browser tabs', async () => {
    const { client: headTab } = await createSchoolWithHeadmaster();
    expectOk(
      await headTab.post('/teachers', {
        fullName: 'Kofi Boateng',
        email: 'kofi@test.example',
        staffId: 'GES-1001',
        assignments: [],
      }),
    );
    await flushEmails();
    const invite = tokenFromLink(lastLink('kofi@test.example'));
    expectOk(
      await new Client().agent
        .post('/api/v1/auth/invitations/accept')
        .send({ token: invite, staffId: 'GES-1001', password: PASSWORD }),
    );

    const teacherTab = new Client();
    expectOk(await teacherTab.login('kofi@test.example'));

    // Both tabs stay signed in as their own user.
    expect((await headTab.get('/auth/me')).body.data.role).toBe('HEADMASTER');
    expect((await teacherTab.get('/auth/me')).body.data.role).toBe('TEACHER');
    expect((await headTab.get('/teachers')).status).toBe(200);
    expect((await teacherTab.get('/teachers')).status).toBe(403);

    // Signing out in one tab leaves the other alone.
    expect((await teacherTab.post('/auth/logout')).status).toBe(204);
    expect((await teacherTab.get('/auth/me')).status).toBe(401);
    expect((await headTab.get('/auth/me')).status).toBe(200);
  });

  it('a copied tab forks its own session, so signing out or in there leaves the original alone', async () => {
    const { client: headTab } = await createSchoolWithHeadmaster();
    expectOk(
      await headTab.post('/teachers', {
        fullName: 'Kofi Boateng',
        email: 'kofi@test.example',
        staffId: 'GES-1001',
        assignments: [],
      }),
    );
    await flushEmails();
    const invite = tokenFromLink(lastLink('kofi@test.example'));
    expectOk(
      await new Client().agent
        .post('/api/v1/auth/invitations/accept')
        .send({ token: invite, staffId: 'GES-1001', password: PASSWORD }),
    );

    // The browser copied the headmaster's token into a new tab; the tab forks it.
    const copiedTab = new Client();
    copiedTab.token = headTab.token;
    const fork = expectOk(await copiedTab.post('/auth/sessions/fork'));
    copiedTab.token = fork.body.data.token;
    expect(copiedTab.token).not.toBe(headTab.token);

    // Signing out in the copy, then in as the teacher, never touches the original tab.
    expect((await copiedTab.post('/auth/logout')).status).toBe(204);
    expectOk(await copiedTab.login('kofi@test.example'));
    expect((await copiedTab.get('/auth/me')).body.data.role).toBe('TEACHER');
    expect((await headTab.get('/auth/me')).body.data.role).toBe('HEADMASTER');
  });

  it('cannot fork without a valid session', async () => {
    expect((await new Client().post('/auth/sessions/fork')).status).toBe(401);
  });

  it('a tab that signs in again replaces its own previous session', async () => {
    const { client: tab, user } = await createSchoolWithHeadmaster();
    const first = tab.token;
    expectOk(await tab.login('head@test.example'));
    expect(tab.token).not.toBe(first);
    const sessions = await prisma.session.findMany({ where: { userId: user.id } });
    expect(sessions.filter((s) => !s.revokedAt)).toHaveLength(1);
  });

  it('rejects non-JSON writes', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('email=a@b.c&password=x');
    expect(res.status).toBe(422);
  });

  it('expires idle sessions', async () => {
    const { client, user } = await createSchoolWithHeadmaster();
    await prisma.session.updateMany({
      where: { userId: user.id },
      data: { lastSeenAt: new Date(Date.now() - 9 * 3600 * 1000) },
    });
    expect((await client.get('/auth/me')).status).toBe(401);
  });
});

describe('teacher invitations', () => {
  async function newTeacher(head: Client, email = 'kofi@test.example') {
    const res = await head.post('/teachers', {
      fullName: 'Kofi Boateng',
      email,
      staffId: 'GES-1001',
      assignments: [],
    });
    expectOk(res);
    await flushEmails();
    return res.body.data;
  }

  it('creates a pending teacher and emails an invitation with the token in the URL fragment', async () => {
    const { client: head } = await createSchoolWithHeadmaster();
    const teacher = await newTeacher(head);
    expect(teacher.status).toBe('PENDING_ACTIVATION');
    expect(teacher.invitationStatus).toBe('PENDING');
    const link = lastLink('kofi@test.example');
    expect(link).toMatch(/\/activate#token=/);

    // Only the hash is stored, and the sent email's payload is cleared.
    const token = tokenFromLink(link);
    expect(await prisma.authToken.count({ where: { tokenHash: token } })).toBe(0);
    const outbox = await prisma.emailOutbox.findFirstOrThrow({
      where: { toEmail: 'kofi@test.example' },
    });
    expect(outbox.status).toBe('SENT');
    expect(outbox.payload).toEqual({});
  });

  it('activates with the staff ID and signs the teacher in', async () => {
    const { client: head } = await createSchoolWithHeadmaster();
    await newTeacher(head);
    const token = tokenFromLink(lastLink('kofi@test.example'));
    const anon = new Client();

    const v = expectOk(await anon.agent.post('/api/v1/auth/invitations/validate').send({ token }));
    expect(v.body.data.fullName).toBe('Kofi Boateng');

    const weak = await anon.agent
      .post('/api/v1/auth/invitations/accept')
      .send({ token, staffId: 'GES-1001', password: 'short' });
    expect(weak.status).toBe(422);

    const ok = expectOk(
      await anon.agent
        .post('/api/v1/auth/invitations/accept')
        .send({ token, staffId: 'ges-1001', password: PASSWORD }),
    );
    anon.token = ok.body.data.token;
    expect((await anon.get('/auth/me')).body.data.role).toBe('TEACHER');

    // Single use.
    const again = await new Client().agent
      .post('/api/v1/auth/invitations/accept')
      .send({ token, staffId: 'GES-1001', password: PASSWORD });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('INVITATION_INVALID');
  });

  it('burns the token after five wrong staff IDs, with one generic error', async () => {
    const { client: head } = await createSchoolWithHeadmaster();
    await newTeacher(head);
    const token = tokenFromLink(lastLink('kofi@test.example'));
    const anon = new Client();
    const messages = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      const r = await anon.agent
        .post('/api/v1/auth/invitations/accept')
        .send({ token, staffId: 'WRONG', password: PASSWORD });
      expect(r.status).toBe(400);
      messages.add(r.body.error.message);
    }
    const right = await anon.agent
      .post('/api/v1/auth/invitations/accept')
      .send({ token, staffId: 'GES-1001', password: PASSWORD });
    expect(right.status).toBe(400);
    messages.add(right.body.error.message);
    const unknown = await anon.agent
      .post('/api/v1/auth/invitations/accept')
      .send({ token: 'x'.repeat(43), staffId: 'GES-1001', password: PASSWORD });
    messages.add(unknown.body.error.message);
    expect(messages.size).toBe(1);
  });

  it('expires invitations after 72 hours', async () => {
    const { client: head } = await createSchoolWithHeadmaster();
    await newTeacher(head);
    const token = tokenFromLink(lastLink('kofi@test.example'));
    await prisma.authToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const r = await new Client().agent.post('/api/v1/auth/invitations/validate').send({ token });
    expect(r.body.error.code).toBe('INVITATION_INVALID');
  });

  it('resending revokes the old link', async () => {
    const { client: head } = await createSchoolWithHeadmaster();
    const teacher = await newTeacher(head);
    const oldToken = tokenFromLink(lastLink('kofi@test.example'));
    expectOk(await head.post(`/teachers/${teacher.id}/invitations`));
    await flushEmails();
    const newToken = tokenFromLink(lastLink('kofi@test.example'));
    expect(newToken).not.toBe(oldToken);
    const anon = new Client();
    expect(
      (await anon.agent.post('/api/v1/auth/invitations/validate').send({ token: oldToken })).status,
    ).toBe(400);
    expect(
      (await anon.agent.post('/api/v1/auth/invitations/validate').send({ token: newToken })).status,
    ).toBe(200);
  });

  it('rejects duplicate emails and staff IDs with field errors', async () => {
    const { client: head } = await createSchoolWithHeadmaster();
    await newTeacher(head);
    const dupEmail = await head.post('/teachers', {
      fullName: 'Other',
      email: 'KOFI@test.example',
      staffId: 'GES-2',
      assignments: [],
    });
    expect(dupEmail.status).toBe(422);
    expect(dupEmail.body.error.details.fields.email).toBeDefined();
    const dupStaff = await head.post('/teachers', {
      fullName: 'Other',
      email: 'o@test.example',
      staffId: 'GES-1001',
      assignments: [],
    });
    expect(dupStaff.body.error.details.fields.staffId).toBeDefined();
  });
});

describe('password reset and deactivation', () => {
  async function activeTeacher(head: Client) {
    expectOk(
      await head.post('/teachers', {
        fullName: 'Kofi Boateng',
        email: 'kofi@test.example',
        staffId: 'GES-1001',
        assignments: [],
      }),
    );
    await flushEmails();
    const token = tokenFromLink(lastLink('kofi@test.example'));
    const t = new Client();
    const ok = expectOk(
      await t.agent
        .post('/api/v1/auth/invitations/accept')
        .send({ token, staffId: 'GES-1001', password: PASSWORD }),
    );
    t.token = ok.body.data.token;
    const list = await head.get('/teachers');
    return { teacherClient: t, teacherId: list.body.data[0].id as string };
  }

  it('forgot-password answers the same whether or not the account exists', async () => {
    await createSchoolWithHeadmaster();
    const a = await request(app)
      .post('/api/v1/auth/password/forgot')
      .send({ email: 'head@test.example' });
    const b = await request(app)
      .post('/api/v1/auth/password/forgot')
      .send({ email: 'ghost@test.example' });
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    expect(a.body).toEqual(b.body);
    await flushEmails();
    expect(mail.sent.filter((m) => m.template === 'PASSWORD_RESET')).toHaveLength(1);
  });

  it('resetting the password revokes every session', async () => {
    const { client: head } = await createSchoolWithHeadmaster();
    const { teacherClient } = await activeTeacher(head);
    await request(app).post('/api/v1/auth/password/forgot').send({ email: 'kofi@test.example' });
    await flushEmails();
    const token = tokenFromLink(lastLink('kofi@test.example'));
    expect(lastLink('kofi@test.example')).toMatch(/\/reset-password#token=/);
    expectOk(
      await request(app)
        .post('/api/v1/auth/password/reset')
        .send({ token, password: 'a-brand-new-passphrase' }),
    );
    expect((await teacherClient.get('/auth/me')).status).toBe(401);
    expect((await new Client().login('kofi@test.example', 'a-brand-new-passphrase')).status).toBe(
      200,
    );
    // Single use.
    const again = await request(app)
      .post('/api/v1/auth/password/reset')
      .send({ token, password: 'another-passphrase-1' });
    expect(again.status).toBe(400);
  });

  it('deactivation ends sessions at once and keeps the account; reactivation restores it', async () => {
    const { client: head } = await createSchoolWithHeadmaster();
    const { teacherClient, teacherId } = await activeTeacher(head);
    expect((await teacherClient.get('/auth/me')).status).toBe(200);

    expectOk(await head.post(`/teachers/${teacherId}/deactivate`));
    expect((await teacherClient.get('/auth/me')).status).toBe(401);
    expect((await new Client().login('kofi@test.example')).status).toBe(401);

    const re = expectOk(await head.post(`/teachers/${teacherId}/reactivate`));
    expect(re.body.data.status).toBe('ACTIVE');
    expect((await new Client().login('kofi@test.example')).status).toBe(200);
  });

  it('writes audit entries for account changes', async () => {
    const { client: head } = await createSchoolWithHeadmaster();
    const { teacherId } = await activeTeacher(head);
    await head.post(`/teachers/${teacherId}/deactivate`);
    const audit = expectOk(await head.get(`/teachers/${teacherId}/audit`));
    const actions = audit.body.data.map((a: { action: string }) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(['teacher.created', 'invitation.accepted', 'teacher.deactivated']),
    );
  });
});
