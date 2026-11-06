import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db.js';
import { isoWeekday } from '../src/lib/dates.js';
import {
  createActiveTeacher,
  createSchoolWithHeadmaster,
  expectOk,
  publishSampleScheme,
  resetDb,
  setupTerm,
  subjectId,
  today,
} from './helpers.js';

beforeEach(resetDb);

describe('timetable slot changes take effect at once', () => {
  it('shows a slot added today in the teacher’s lessons without publishing', async () => {
    const { client: head } = await createSchoolWithHeadmaster();
    const { termId } = await setupTerm(head, 1);
    await publishSampleScheme(head, termId);
    const cls = expectOk(await head.post('/classes', { level: 'BASIC_7', name: 'FORM 1' }));
    const { client: teacher, teacher: t } = await createActiveTeacher(head, {
      fullName: 'Kofi Boateng',
      email: 'kofi@test.example',
      staffId: 'GES-1',
      assignments: [{ subjectId: await subjectId(head, 'Mathematics'), classId: cls.body.data.id }],
    });
    const assignmentId = expectOk(await head.get(`/assignments?teacherProfileId=${t.id}`)).body
      .data[0].id as string;

    // A school day this week, so the test does not depend on what day it runs.
    const day = Math.min(isoWeekday(today()), 5);
    const slot = expectOk(
      await head.post('/timetable-entries', {
        assignmentId,
        weekday: day,
        startTime: '07:00',
        endTime: '07:40',
      }),
    ).body.data;
    const lessons = await prisma.lesson.findMany({ where: { timetableEntryId: slot.id } });
    expect(lessons.length).toBeGreaterThan(0);
    if (isoWeekday(today()) <= 5) {
      const mine = expectOk(await teacher.get('/lessons/today'));
      expect(mine.body.data).toHaveLength(1);
      expect(mine.body.data[0].startTime).toBe('07:00');
    }

    // Moving the slot moves the lessons nobody has recorded.
    const moved = expectOk(
      await head.patch(`/timetable-entries/${slot.id}`, { startTime: '07:40', endTime: '08:20' }),
    ).body.data;
    expect(await prisma.lesson.count({ where: { timetableEntryId: slot.id } })).toBe(0);
    expect(await prisma.lesson.count({ where: { timetableEntryId: moved.id } })).toBe(
      lessons.length,
    );

    // Removing it removes them.
    expectOk(await head.delete(`/timetable-entries/${moved.id}`));
    expect(await prisma.lesson.count({ where: { assignmentId } })).toBe(0);
  });
});
