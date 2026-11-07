import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db.js';
import { subscribe, type LiveEvent } from '../src/lib/events.js';
import { sendLessonReminders } from '../src/jobs/lessonReminders.js';
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

/** A Mathematics teacher with a Monday 08:00 lesson; the term's week 1 is this week. */
async function world() {
  const { client: head } = await createSchoolWithHeadmaster();
  const { termId } = await setupTerm(head, 0);
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
  const user = await prisma.user.findFirstOrThrow({ where: { email: 'kofi@test.example' } });
  return { head, teacher, assignmentId, termId, userId: user.id };
}

function listen(userId: string) {
  const events: LiveEvent[] = [];
  const stop = subscribe(userId, (e) => events.push(e));
  return { events, stop };
}

describe('lesson reminders', () => {
  it('reminds the teacher once, ten minutes before the lesson, live and in the list', async () => {
    const w = await world();
    expectOk(
      await w.head.post('/timetable-entries', {
        assignmentId: w.assignmentId,
        weekday: 1,
        startTime: '08:00',
        endTime: '08:40',
      }),
    );
    // Africa/Accra is UTC, so this is Monday 07:52 at the school.
    const monday = mondayOf(today());
    const at = (time: string) => new Date(`${monday}T${time}:00Z`);
    const live = listen(w.userId);
    try {
      expect(await sendLessonReminders(at('07:40'))).toBe(0);
      expect(await sendLessonReminders(at('07:52'))).toBe(1);
      expect(await sendLessonReminders(at('07:55'))).toBe(0);

      const notice = await prisma.notification.findFirstOrThrow({
        where: { type: 'LESSON_REMINDER' },
      });
      expect(notice.title).toBe('Mathematics, FORM 1 at 08:00');
      expect(notice.body).toBe('Starts in 8 minutes. Record it once the lesson has started.');
      const pushed = live.events.find((e) => e.type === 'notification');
      expect(pushed).toMatchObject({
        notification: { title: 'Mathematics, FORM 1 at 08:00', lessonId: notice.lessonId },
      });

      const list = expectOk(await w.teacher.get('/notifications'));
      expect(list.body.data[0]).toMatchObject({
        type: 'LESSON_REMINDER',
        lessonId: notice.lessonId,
      });
    } finally {
      live.stop();
    }
  });

  it('does not remind a lesson that is already recorded or cancelled', async () => {
    const w = await world();
    expectOk(
      await w.head.post('/timetable-entries', {
        assignmentId: w.assignmentId,
        weekday: 1,
        startTime: '08:00',
        endTime: '08:40',
      }),
    );
    const monday = mondayOf(today());
    const lesson = await prisma.lesson.findFirstOrThrow({
      where: { assignmentId: w.assignmentId, date: new Date(`${monday}T00:00:00Z`) },
    });
    await prisma.lesson.update({ where: { id: lesson.id }, data: { status: 'CANCELLED' } });
    expect(await sendLessonReminders(new Date(`${monday}T07:55:00Z`))).toBe(0);
  });
});

describe('teachers see lesson changes without refreshing', () => {
  it('signals the teacher’s open tabs when the headmaster changes the timetable', async () => {
    const w = await world();
    const live = listen(w.userId);
    try {
      expectOk(
        await w.head.post('/timetable-entries', {
          assignmentId: w.assignmentId,
          weekday: 2,
          startTime: '09:00',
          endTime: '09:40',
        }),
      );
      await vi_waitFor(() => live.events.some((e) => e.type === 'lessons-changed'));

      // Reading does not signal, and neither does a failed change.
      live.events.length = 0;
      await w.head.get('/timetable-entries');
      await w.head.post('/timetable-entries', { assignmentId: w.assignmentId });
      await new Promise((r) => setTimeout(r, 200));
      expect(live.events).toEqual([]);
    } finally {
      live.stop();
    }
  });
});

async function vi_waitFor(check: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}
