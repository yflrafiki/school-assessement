import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db.js';
import { hashPassword } from '../src/lib/password.js';
import {
  Client,
  createActiveTeacher,
  createSchoolWithHeadmaster,
  expectOk,
  PASSWORD,
  resetDb,
  setupTerm,
} from './helpers.js';

beforeEach(resetDb);

async function systemAdmin() {
  await prisma.user.create({
    data: {
      schoolId: null,
      email: 'owner@test.example',
      fullName: 'System Owner',
      role: 'SYSTEM_ADMIN',
      status: 'ACTIVE',
      passwordHash: await hashPassword(PASSWORD),
    },
  });
  const client = new Client();
  expectOk(await client.login('owner@test.example'));
  return client;
}

describe('system admin', () => {
  it('sees every school, its people and its activity', async () => {
    const a = await createSchoolWithHeadmaster('Ipel International', 'head@ipel.example');
    await setupTerm(a.client, 0);
    await createActiveTeacher(a.client, {
      fullName: 'Kofi Boateng',
      email: 'kofi@ipel.example',
      staffId: 'GES-1',
    });
    const b = await createSchoolWithHeadmaster('Accra JHS', 'head@accra.example');
    const admin = await systemAdmin();

    const me = expectOk(await admin.get('/auth/me')).body.data;
    expect(me).toMatchObject({ role: 'SYSTEM_ADMIN', permissions: ['system.view'] });
    // One school system: the admin sees the school's name.
    expect(me.school).toMatchObject({ id: '', name: 'Ipel International' });

    const overview = expectOk(await admin.get('/admin/overview')).body.data;
    expect(overview.schools).toBe(2);
    expect(overview.people).toMatchObject({ headmasters: 2, teachers: 1 });
    // Two headmasters, the teacher and the admin: people, however many tabs.
    expect(overview.sessions.signedIn).toBe(4);
    expect(overview.recentActivity.length).toBeGreaterThan(0);

    const schools = expectOk(await admin.get('/admin/schools')).body.data;
    expect(schools.map((s: { name: string }) => s.name)).toEqual([
      'Accra JHS',
      'Ipel International',
    ]);
    const ipel = schools.find((s: { name: string }) => s.name === 'Ipel International');
    expect(ipel).toMatchObject({ teachers: 1, term: 'First Term', setup: { total: 9 } });

    const detail = expectOk(await admin.get(`/admin/schools/${a.school.id}`)).body.data;
    expect(detail.school.name).toBe('Ipel International');
    expect(detail.people.map((p: { email: string }) => p.email).sort()).toEqual([
      'head@ipel.example',
      'kofi@ipel.example',
    ]);
    expect(detail.setup.steps[0]).toMatchObject({ id: 'term', done: true });

    const users = expectOk(await admin.get('/admin/users?search=kofi')).body;
    expect(users.data).toHaveLength(1);
    expect(users.data[0].school.name).toBe('Ipel International');

    const activity = expectOk(await admin.get(`/admin/activity?schoolId=${b.school.id}`)).body;
    for (const row of activity.data as { school: { name: string } | null }[])
      expect(row.school?.name).toBe('Accra JHS');
  });

  it('cannot open or change anything inside a school', async () => {
    const { school } = await createSchoolWithHeadmaster();
    const admin = await systemAdmin();
    for (const path of ['/classes', '/teachers', '/terms', '/notifications', '/setup-status']) {
      expect((await admin.get(path)).status, path).toBe(403);
    }
    expect((await admin.post('/classes', { level: 'BASIC_7', name: 'X' })).status).toBe(403);
    // Their own account still works: name and password.
    expectOk(await admin.patch('/auth/me', { fullName: 'Platform Owner' }));
    expect(expectOk(await admin.get('/auth/me')).body.data.fullName).toBe('Platform Owner');
    expect((await admin.patch(`/admin/schools/${school.id}`, { name: 'X' })).status).toBe(404);
  });

  it('is closed to headmasters and teachers', async () => {
    const { client: head } = await createSchoolWithHeadmaster();
    const { client: teacher } = await createActiveTeacher(head, {
      fullName: 'Ama Owusu',
      email: 'ama@test.example',
      staffId: 'GES-2',
    });
    for (const c of [head, teacher]) {
      expect((await c.get('/admin/overview')).status).toBe(403);
      expect((await c.get('/admin/users')).status).toBe(403);
    }
  });

  it('is the only kind of account without a school', async () => {
    await expect(
      prisma.user.create({
        data: { schoolId: null, email: 'x@test.example', fullName: 'X', role: 'TEACHER' },
      }),
    ).rejects.toThrow();
    const { school } = await createSchoolWithHeadmaster();
    await expect(
      prisma.user.create({
        data: {
          schoolId: school.id,
          email: 'y@test.example',
          fullName: 'Y',
          role: 'SYSTEM_ADMIN',
        },
      }),
    ).rejects.toThrow();
  });
});
