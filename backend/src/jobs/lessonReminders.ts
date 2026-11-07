import { minutesToTime } from '@school/shared';
import { logger } from '../config/logger.js';
import { prisma } from '../lib/db.js';
import { isUniqueViolation } from '../lib/errors.js';
import { localNow, toDbDate } from '../lib/dates.js';
import { publishToUser } from '../lib/events.js';

/** How long before a lesson the teacher is reminded. */
export const REMIND_MINUTES_BEFORE = 10;
/** A reminder this late after the start is still useful; later than this it is skipped. */
const LATE_LIMIT_MINUTES = 15;
const TICK_MS = 60_000;

/**
 * Reminds each teacher of a lesson about to start, once per lesson: a notification in their
 * list and a pop-up in any open tab. Lessons already recorded, cancelled or moved are skipped.
 */
export async function sendLessonReminders(now: Date = new Date()): Promise<number> {
  const schools = await prisma.school.findMany({ select: { id: true, timezone: true } });
  let sent = 0;
  for (const school of schools) {
    const local = localNow(school.timezone, now);
    const lessons = await prisma.lesson.findMany({
      where: {
        schoolId: school.id,
        date: toDbDate(local.date),
        status: 'SCHEDULED',
        startMinute: {
          gte: local.minutes - LATE_LIMIT_MINUTES,
          lte: local.minutes + REMIND_MINUTES_BEFORE,
        },
        OR: [{ record: { is: null } }, { record: { is: { status: 'DRAFT' } } }],
        assignment: { isActive: true, teacherProfile: { user: { status: 'ACTIVE' } } },
        notifications: { none: { type: 'LESSON_REMINDER' } },
      },
      include: {
        assignment: {
          select: {
            subject: { select: { name: true } },
            schoolClass: { select: { name: true } },
            teacherProfile: { select: { userId: true } },
          },
        },
      },
    });
    for (const l of lessons) {
      const at = minutesToTime(l.startMinute);
      const title = `${l.assignment.subject.name}, ${l.assignment.schoolClass.name} at ${at}`;
      const body =
        l.startMinute > local.minutes
          ? `Starts in ${l.startMinute - local.minutes} minutes. Record it once the lesson has started.`
          : `Started at ${at}. Record what you taught when you are ready.`;
      const recipientId = l.assignment.teacherProfile.userId;
      try {
        await prisma.notification.create({
          data: {
            schoolId: school.id,
            recipientId,
            type: 'LESSON_REMINDER',
            lessonId: l.id,
            title,
            body,
          },
        });
      } catch (err) {
        // Another run already reminded this lesson.
        if (isUniqueViolation(err)) continue;
        throw err;
      }
      publishToUser(recipientId, {
        type: 'notification',
        notification: { title, body, recordId: null, lessonId: l.id },
      });
      sent += 1;
    }
  }
  return sent;
}

/** Checks once a minute. Stops cleanly when the returned function is called. */
export function startLessonReminders(): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await sendLessonReminders();
    } catch (err) {
      logger.error({ err }, 'Lesson reminders failed');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), TICK_MS);
  void tick();
  return () => clearInterval(timer);
}
