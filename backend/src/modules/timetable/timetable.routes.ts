import { Router, type Request } from 'express';
import {
  listTimetableQuery,
  publishTimetableBody,
  timetableEntryBody,
  updateTimetableEntryBody,
} from '@school/shared';
import { auth, body, idParam, query } from '../../lib/http.js';
import { requirePermission } from '../../middleware/requireRole.js';
import * as service from './timetable.service.js';

export const timetableRouter = Router();

const actor = (req: Request) => {
  const a = auth(req);
  return { schoolId: a.schoolId, userId: a.userId, requestId: req.requestId };
};

timetableRouter.get('/timetable-entries', async (req, res) => {
  const a = auth(req);
  const filters = query(req, listTimetableQuery);
  // Teachers see only their own slots.
  if (a.role === 'TEACHER') filters.teacherProfileId = a.teacherProfileId ?? undefined;
  else if (a.role !== 'HEADMASTER') {
    res.json({ data: [] });
    return;
  }
  res.json({ data: await service.listEntries(a.schoolId, filters) });
});

timetableRouter.post(
  '/timetable-entries',
  requirePermission('timetable.manage'),
  async (req, res) => {
    res
      .status(201)
      .json({ data: await service.createEntry(actor(req), body(req, timetableEntryBody)) });
  },
);

timetableRouter.patch(
  '/timetable-entries/:id',
  requirePermission('timetable.manage'),
  async (req, res) => {
    res.json({
      data: await service.updateEntry(
        actor(req),
        idParam(req),
        body(req, updateTimetableEntryBody),
      ),
    });
  },
);

timetableRouter.delete(
  '/timetable-entries/:id',
  requirePermission('timetable.manage'),
  async (req, res) => {
    await service.deleteEntry(actor(req), idParam(req));
    res.status(204).end();
  },
);

timetableRouter.post(
  '/timetable/publish',
  requirePermission('timetable.manage'),
  async (req, res) => {
    res.json({ data: await service.publish(actor(req), body(req, publishTimetableBody)) });
  },
);
