import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db.js';
import {
  createActiveTeacher,
  createSchoolWithHeadmaster,
  expectOk,
  mondayOf,
  publishSampleScheme,
  resetDb,
  setupTerm,
  subjectId,
  today,
} from './helpers.js';

beforeEach(resetDb);

describe('starting to use the system part-way through a term', () => {
  it('waives earlier lessons so this week’s lesson can be recorded on the right week', async () => {
    const { client: head } = await createSchoolWithHeadmaster();
    const { termId } = await setupTerm(head, 3);
    const cls = expectOk(await head.post('/classes', { level: 'BASIC_7', name: 'B7A' }));
    const { teacher, client } = await createActiveTeacher(head, {
      fullName: 'Kofi Boateng',
      email: 'kofi@test.example',
      staffId: 'GES-1',
      assignments: [{ subjectId: await subjectId(head, 'Mathematics'), classId: cls.body.data.id }],
    });
    const assignmentId = expectOk(await head.get(`/assignments?teacherProfileId=${teacher.id}`))
      .body.data[0].id as string;
    expectOk(
      await head.post('/timetable-entries', {
        assignmentId,
        weekday: 1,
        startTime: '06:00',
        endTime: '07:00',
      }),
    );
    await publishSampleScheme(head, termId);
    expectOk(await head.post('/timetable/publish', { termId }));

    const thisMonday = mondayOf(today());
    const lesson = await prisma.lesson.findFirstOrThrow({
      where: { assignmentId, date: new Date(`${thisMonday}T00:00:00Z`) },
    });
    expect(lesson.weekNumber).toBe(4);
    const topics = expectOk(await client.get(`/curriculum/topics?lessonId=${lesson.id}`));
    const record = {
      lessonId: lesson.id,
      entryIds: [topics.body.data.entries[0].id],
      taughtSummary: 'Taught rounding off whole numbers with number lines.',
      status: 'SUBMITTED',
    };
    // Weeks 1 to 3 were never recorded, so week 4 is locked.
    const locked = await client.post('/teaching-records', record);
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('WEEK_LOCKED');

    // A teacher cannot do this; the headmaster can.
    expect((await client.post('/lessons/waive-before', { termId, date: thisMonday })).status).toBe(
      403,
    );
    expect((await head.post('/lessons/waive-before', { termId, date: '2099-01-01' })).status).toBe(
      422,
    );
    const res = expectOk(await head.post('/lessons/waive-before', { termId, date: thisMonday }));
    expect(res.body.data.waived).toBe(3);

    // Still week 4, and now it can be recorded.
    const after = await prisma.lesson.findUniqueOrThrow({ where: { id: lesson.id } });
    expect(after.weekNumber).toBe(4);
    expect((await client.post('/teaching-records', record)).status).toBe(201);
    expect(await prisma.auditLog.count({ where: { action: 'lessons.waived_before' } })).toBe(1);
  });
});
