import { Router, type Request } from 'express';
import { z } from 'zod';
import { carryForwardBody, createAssignmentBody, updateAssignmentBody, uuid } from '@school/shared';
import { auth, body, idParam, query, teacherAuth } from '../../lib/http.js';
import { requirePermission, requireRole } from '../../middleware/requireRole.js';
import * as service from './assignments.service.js';

export const assignmentsRouter = Router();

const actor = (req: Request) => {
  const a = auth(req);
  return { schoolId: a.schoolId, userId: a.userId, requestId: req.requestId };
};

const listQuery = z.object({
  termId: uuid.optional(),
  teacherProfileId: uuid.optional(),
  classId: uuid.optional(),
});

assignmentsRouter.get('/teachers/me/assignments', requireRole('TEACHER'), async (req, res) => {
  const a = teacherAuth(req);
  const { termId } = query(req, listQuery);
  res.json({
    data: await service.listAssignments(a.schoolId, {
      teacherProfileId: a.teacherProfileId,
      termId,
    }),
  });
});

assignmentsRouter.get('/assignments', requirePermission('school.setup'), async (req, res) => {
  res.json({ data: await service.listAssignments(auth(req).schoolId, query(req, listQuery)) });
});

assignmentsRouter.post('/assignments', requirePermission('school.setup'), async (req, res) => {
  res
    .status(201)
    .json({ data: await service.createAssignment(actor(req), body(req, createAssignmentBody)) });
});

assignmentsRouter.patch('/assignments/:id', requirePermission('school.setup'), async (req, res) => {
  res.json({
    data: await service.updateAssignment(actor(req), idParam(req), body(req, updateAssignmentBody)),
  });
});

assignmentsRouter.post(
  '/assignments/carry-forward',
  requirePermission('school.setup'),
  async (req, res) => {
    const input = body(req, carryForwardBody);
    res.json({ data: await service.carryForward(actor(req), input.fromTermId, input.toTermId) });
  },
);
