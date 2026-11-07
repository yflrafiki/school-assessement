import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { prisma } from '../src/lib/db.js';
import { hashPassword } from '../src/lib/password.js';
import {
  Client,
  createActiveTeacher,
  createSchoolWithHeadmaster,
  expectOk,
  PASSWORD,
  publishSampleScheme,
  resetDb,
  setupTerm,
  subjectId,
} from './helpers.js';

beforeEach(resetDb);

/** Runs the file exactly as Neon's SQL Editor would: one script, several statements. */
async function runResetScript() {
  const sql = readFileSync(
    new URL('../prisma/scripts/reset-for-demo.sql', import.meta.url),
    'utf8',
  );
  // Only ever the test database: DATABASE_URL here is the developer's own database.
  const url = process.env.TEST_DATABASE_URL ?? '';
  if (new URL(url).pathname.replace('/', '').endsWith('_test') === false) {
    throw new Error('Refusing to run: not a _test database');
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

describe('reset for a fresh start', () => {
  it('removes all school data and keeps only the headmaster and the system admin', async () => {
    const { client: head, school } = await createSchoolWithHeadmaster('Ipel', 'head@ipel.example');
    const { termId } = await setupTerm(head, 2);
    await publishSampleScheme(head, termId);
    const cls = expectOk(await head.post('/classes', { level: 'BASIC_7', name: 'FORM 1' }));
    expectOk(await head.post('/subjects', { name: 'Asante Twi' }));
    const { client: teacher, teacher: t } = await createActiveTeacher(head, {
      fullName: 'Kofi Boateng',
      email: 'kofi@ipel.example',
      staffId: 'GES-1',
      assignments: [{ subjectId: await subjectId(head, 'Mathematics'), classId: cls.body.data.id }],
    });
    const assignmentId = expectOk(await head.get(`/assignments?teacherProfileId=${t.id}`)).body
      .data[0].id as string;
    expectOk(
      await head.post('/timetable-entries', {
        assignmentId,
        weekday: 1,
        startTime: '08:00',
        endTime: '09:00',
      }),
    );
    const lesson = await prisma.lesson.findFirstOrThrow({ where: { assignmentId, weekNumber: 1 } });
    const topics = expectOk(await teacher.get(`/curriculum/topics?lessonId=${lesson.id}`));
    expectOk(
      await teacher.post('/teaching-records', {
        lessonId: lesson.id,
        entryIds: [topics.body.data.entries[0].id],
        taughtSummary: 'Place value with base ten blocks.',
        status: 'SUBMITTED',
      }),
    );
    await prisma.user.create({
      data: {
        schoolId: null,
        email: 'owner@example.com',
        fullName: 'System Owner',
        role: 'SYSTEM_ADMIN',
        status: 'ACTIVE',
        passwordHash: await hashPassword(PASSWORD),
      },
    });
    const nationalSubjects = await prisma.subject.count({ where: { schoolId: null } });
    expect(await prisma.teachingRecord.count()).toBe(1);
    expect(await prisma.notification.count()).toBeGreaterThan(0);
    expect(await prisma.auditLog.count()).toBeGreaterThan(0);

    await runResetScript();

    const users = await prisma.user.findMany({ select: { email: true, role: true } });
    expect(users.map((u) => u.email).sort()).toEqual(['head@ipel.example', 'owner@example.com']);
    for (const count of await Promise.all([
      prisma.teacherProfile.count(),
      prisma.term.count(),
      prisma.academicYear.count(),
      prisma.termWeek.count(),
      prisma.schoolClass.count(),
      prisma.curriculumScheme.count(),
      prisma.curriculumEntry.count(),
      prisma.importBatch.count(),
      prisma.teachingAssignment.count(),
      prisma.timetableEntry.count(),
      prisma.lesson.count(),
      prisma.teachingRecord.count(),
      prisma.notification.count(),
      prisma.auditLog.count(),
      prisma.session.count(),
      prisma.emailOutbox.count(),
      prisma.subject.count({ where: { schoolId: { not: null } } }),
    ]))
      expect(count).toBe(0);
    expect(await prisma.subject.count({ where: { schoolId: null } })).toBe(nationalSubjects);
    expect(await prisma.school.findUnique({ where: { id: school.id } })).not.toBeNull();

    // Both can sign in again with the same passwords, and setup starts from the first step.
    const headAgain = new Client();
    expectOk(await headAgain.login('head@ipel.example'));
    const setup = expectOk(await headAgain.get('/setup-status')).body.data;
    expect(setup.steps[0]).toMatchObject({ id: 'term', done: false });
    expectOk(await new Client().login('owner@example.com'));
    // The old teacher is gone.
    expect((await new Client().login('kofi@ipel.example')).status).toBe(401);
  });

  it('changes nothing when there is no headmaster to keep', async () => {
    const school = await prisma.school.create({ data: { name: 'Ipel' } });
    await prisma.schoolClass.create({
      data: { schoolId: school.id, level: 'BASIC_7', name: 'FORM 1' },
    });
    await expect(runResetScript()).rejects.toThrow(/No headmaster account found/);
    expect(await prisma.schoolClass.count()).toBe(1);
  });
});
