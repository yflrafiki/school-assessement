import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  draftRecordBody,
  editRecordBody,
  listRecordsQuery,
  submitRecordBody,
  uuid,
} from '@school/shared';
import { auth, body, idParam, query, teacherAuth } from '../../lib/http.js';
import { forbidden } from '../../lib/errors.js';
import { requireRole } from '../../middleware/requireRole.js';
import * as service from './records.service.js';

export const recordsRouter = Router();

const teacherActor = (req: Request) => {
  const a = teacherAuth(req);
  return {
    schoolId: a.schoolId,
    userId: a.userId,
    teacherProfileId: a.teacherProfileId,
    fullName: a.fullName,
    requestId: req.requestId,
  };
};

recordsRouter.post('/teaching-records', requireRole('TEACHER'), async (req, res) => {
  const raw = (req.body ?? {}) as { status?: unknown };
  const input = raw.status === 'DRAFT' ? body(req, draftRecordBody) : body(req, submitRecordBody);
  res.status(201).json({ data: await service.submitRecord(teacherActor(req), input) });
});

recordsRouter.get('/teaching-records', async (req, res) => {
  const a = auth(req);
  const q = query(req, listRecordsQuery);
  if (a.role === 'TEACHER') {
    res.json(
      await service.listRecords(a.schoolId, q, {
        teacherProfileId: teacherAuth(req).teacherProfileId,
      }),
    );
    return;
  }
  if (a.role !== 'HEADMASTER') throw forbidden();
  res.json(await service.listRecords(a.schoolId, q));
});

recordsRouter.get('/teaching-records/by-lesson', requireRole('TEACHER'), async (req, res) => {
  const a = teacherAuth(req);
  const { lessonId } = query(req, z.object({ lessonId: uuid }));
  res.json({ data: await service.getRecordForLesson(a.schoolId, lessonId, a.teacherProfileId) });
});

recordsRouter.get('/teaching-records/:id', async (req, res) => {
  const a = auth(req);
  if (a.role === 'SCHOOL_ADMIN') throw forbidden();
  const scope = a.role === 'TEACHER' ? { teacherProfileId: teacherAuth(req).teacherProfileId } : {};
  res.json({ data: await service.getRecord(a.schoolId, idParam(req), scope) });
});

recordsRouter.patch('/teaching-records/:id', requireRole('TEACHER'), async (req, res) => {
  res.json({
    data: await service.editRecord(teacherActor(req), idParam(req), body(req, editRecordBody)),
  });
});
