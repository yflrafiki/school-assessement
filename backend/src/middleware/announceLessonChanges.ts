import type { RequestHandler } from 'express';
import { logger } from '../config/logger.js';
import { prisma } from '../lib/db.js';
import { publishToUser } from '../lib/events.js';

/** Changes made here can add, move or remove lessons, or change their week or state. */
const AFFECTS_LESSONS =
  /^\/(timetable|timetable-entries|lessons|absences|calendar-days|week-policies|terms|curriculum|assignments|teachers|classes)(\/|$)/;

/**
 * After a successful change by the headmaster or school admin that can affect lessons, tells
 * every teacher's open tabs to reload their lessons, so nobody has to refresh to see today's
 * lessons. Only a signal travels; each tab then fetches what its teacher may see.
 */
export const announceLessonChanges: RequestHandler = (req, res, next) => {
  const auth = req.auth;
  if (req.method !== 'GET' && auth && auth.role !== 'TEACHER' && AFFECTS_LESSONS.test(req.path)) {
    res.on('finish', () => {
      if (res.statusCode >= 400) return;
      prisma.user
        .findMany({
          where: { schoolId: auth.schoolId, role: 'TEACHER', status: 'ACTIVE' },
          select: { id: true },
        })
        .then((teachers) => {
          for (const t of teachers) publishToUser(t.id, { type: 'lessons-changed' });
        })
        .catch((err: unknown) => logger.warn({ err }, 'Could not announce lesson changes'));
    });
  }
  next();
};
