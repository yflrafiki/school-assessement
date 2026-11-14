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

describe('assignment or class test given in a lesson', () => {
  it('is recorded with the lesson, can be corrected, and is counted per teacher', async () => {
    const { client: head } = await createSchoolWithHeadmaster();
    const { termId } = await setupTerm(head, 0);
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
    const monday = mondayOf(today());
    const lesson = await prisma.lesson.findFirstOrThrow({
      where: { assignmentId, date: new Date(`${monday}T00:00:00Z`) },
    });
    const topics = expectOk(await client.get(`/curriculum/topics?lessonId=${lesson.id}`));

    // Unknown kinds are refused.
    const bad = await client.post('/teaching-records', {
      lessonId: lesson.id,
      entryIds: [topics.body.data.entries[0].id],
      taughtSummary: 'Taught rounding off whole numbers with number lines.',
      assessments: ['QUIZ'],
      status: 'SUBMITTED',
    });
    expect(bad.status).toBe(422);

    const saved = expectOk(
      await client.post('/teaching-records', {
        lessonId: lesson.id,
        entryIds: [topics.body.data.entries[0].id],
        taughtSummary: 'Taught rounding off whole numbers with number lines.',
        assessments: ['CLASS_EXERCISE', 'ASSIGNMENT', 'ASSIGNMENT'],
        assessmentNote: 'Exercise 3.2, questions 1 to 10',
        status: 'SUBMITTED',
      }),
    );
    const recordId = saved.body.data.record.id as string;
    const shown = expectOk(await head.get(`/teaching-records/${recordId}`)).body.data;
    expect(shown.assessments).toEqual(['CLASS_EXERCISE', 'ASSIGNMENT']);
    expect(shown.assessmentNote).toBe('Exercise 3.2, questions 1 to 10');

    const range = `dateFrom=${monday}&dateTo=${today()}`;
    const before = expectOk(await head.get(`/reports/teaching-activity?${range}`)).body.data;
    expect(before.rows[0]).toMatchObject({ classExercises: 1, assignments: 1, classTests: 0 });

    // The teacher corrects it: it was a class test. The headmaster is told what changed.
    const edited = expectOk(
      await client.patch(`/teaching-records/${recordId}`, { assessments: ['CLASS_TEST'] }),
    ).body.data;
    expect(edited.assessments).toEqual(['CLASS_TEST']);
    const notice = await prisma.notification.findFirstOrThrow({
      where: { type: 'RECORD_EDITED', recordId },
    });
    expect(notice.body).toMatch(/assignment or test given/);
    const after = expectOk(await head.get(`/reports/teaching-activity?${range}`)).body.data;
    expect(after.rows[0]).toMatchObject({ classExercises: 0, assignments: 0, classTests: 1 });

    // Nothing given any more: the note goes too.
    const cleared = expectOk(
      await client.patch(`/teaching-records/${recordId}`, { assessments: [] }),
    ).body.data;
    expect(cleared).toMatchObject({ assessments: [], assessmentNote: null });
  });
});
