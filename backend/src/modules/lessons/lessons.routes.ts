import { Router, type Request } from 'express';
import {
  cancelLessonBody,
  createAbsenceBody,
  dailyBoardQuery,
  listLessonsQuery,
  rescheduleLessonBody,
  timeToMinutes,
  waiveLessonBody,
} from '@school/shared';
import { forbidden } from '../../lib/errors.js';
import { auth, body, idParam, query, teacherAuth } from '../../lib/http.js';
import { requirePermission, requireRole } from '../../middleware/requireRole.js';
import * as service from './lessons.service.js';

export const lessonsRouter = Router();

const actor = (req: Request) => {
  const a = auth(req);
  return { schoolId: a.schoolId, userId: a.userId, requestId: req.requestId };
};

lessonsRouter.get('/lessons', async (req, res) => {
  const a = auth(req);
  const q = query(req, listLessonsQuery);
  if (a.role === 'TEACHER') {
    res.json(
      await service.listLessons(a.schoolId, q, {
        teacherProfileId: teacherAuth(req).teacherProfileId,
      }),
    );
    return;
  }
  if (a.role !== 'HEADMASTER') {
    throw forbidden();
  }
  res.json(await service.listLessons(a.schoolId, q));
});

lessonsRouter.get('/lessons/today', requireRole('TEACHER'), async (req, res) => {
  const a = teacherAuth(req);
  const now = await service.schoolNow(a.schoolId);
  const result = await service.listLessons(
    a.schoolId,
    { date: now.date, page: 1, pageSize: 100 },
    { teacherProfileId: a.teacherProfileId },
  );
  res.json({ data: result.data, meta: { date: now.date } });
});

lessonsRouter.get('/lessons/:id', async (req, res) => {
  const a = auth(req);
  const scope = a.role === 'TEACHER' ? { teacherProfileId: teacherAuth(req).teacherProfileId } : {};
  if (a.role === 'SCHOOL_ADMIN') {
    throw forbidden();
  }
  res.json({ data: await service.getLesson(a.schoolId, idParam(req), scope) });
});

lessonsRouter.post('/lessons/:id/cancel', requirePermission('lessons.manage'), async (req, res) => {
  const { reason } = body(req, cancelLessonBody);
  res.json({ data: await service.cancelLesson(actor(req), idParam(req), reason) });
});

lessonsRouter.post('/lessons/:id/waive', requirePermission('lessons.manage'), async (req, res) => {
  const { reason } = body(req, waiveLessonBody);
  res.json({ data: await service.waiveLesson(actor(req), idParam(req), reason) });
});

lessonsRouter.post(
  '/lessons/:id/reschedule',
  requirePermission('lessons.manage'),
  async (req, res) => {
    const input = body(req, rescheduleLessonBody);
    const data = await service.rescheduleLesson(actor(req), idParam(req), {
      date: input.date,
      startMinute: timeToMinutes(input.startTime),
      endMinute: timeToMinutes(input.endTime),
      reason: input.reason,
    });
    res.status(201).json({ data });
  },
);

lessonsRouter.get(
  '/dashboard/headmaster/daily',
  requirePermission('lessons.manage'),
  async (req, res) => {
    const { date } = query(req, dailyBoardQuery);
    res.json({ data: await service.dailyBoard(auth(req).schoolId, date) });
  },
);

lessonsRouter.get('/absences', requirePermission('lessons.manage'), async (req, res) => {
  const teacherProfileId =
    typeof req.query.teacherProfileId === 'string' ? req.query.teacherProfileId : undefined;
  res.json({ data: await service.listAbsences(auth(req).schoolId, teacherProfileId) });
});

lessonsRouter.post('/absences', requirePermission('lessons.manage'), async (req, res) => {
  const input = body(req, createAbsenceBody);
  res.status(201).json({ data: await service.createAbsence(actor(req), input) });
});

lessonsRouter.delete('/absences/:id', requirePermission('lessons.manage'), async (req, res) => {
  await service.revokeAbsence(actor(req), idParam(req));
  res.status(204).end();
});
