import { Router, type Request } from 'express';
import {
  createTeacherBody,
  listTeachersQuery,
  paginationQuery,
  updateTeacherBody,
} from '@school/shared';
import { auth, body, idParam, query } from '../../lib/http.js';
import { requirePermission } from '../../middleware/requireRole.js';
import * as service from './teachers.service.js';

export const teachersRouter = Router();

const actor = (req: Request) => {
  const a = auth(req);
  return { schoolId: a.schoolId, userId: a.userId, requestId: req.requestId };
};
const manage = requirePermission('teachers.manage');

teachersRouter.get('/teachers', manage, async (req, res) => {
  res.json(await service.listTeachers(auth(req).schoolId, query(req, listTeachersQuery)));
});

teachersRouter.post('/teachers', manage, async (req, res) => {
  res
    .status(201)
    .json({ data: await service.createTeacher(actor(req), body(req, createTeacherBody)) });
});

// /teachers/me/... routes are registered by other modules; keep ':id' strict.
teachersRouter.get('/teachers/:id', manage, async (req, res) => {
  res.json({ data: await service.getTeacher(auth(req).schoolId, idParam(req)) });
});

teachersRouter.patch('/teachers/:id', manage, async (req, res) => {
  res.json({
    data: await service.updateTeacher(actor(req), idParam(req), body(req, updateTeacherBody)),
  });
});

teachersRouter.delete('/teachers/:id', manage, async (req, res) => {
  await service.deleteTeacher(actor(req), idParam(req));
  res.status(204).end();
});

teachersRouter.post('/teachers/:id/deactivate', manage, async (req, res) => {
  res.json({ data: await service.deactivateTeacher(actor(req), idParam(req)) });
});

teachersRouter.post('/teachers/:id/reactivate', manage, async (req, res) => {
  res.json({ data: await service.reactivateTeacher(actor(req), idParam(req)) });
});

teachersRouter.post('/teachers/:id/invitations', manage, async (req, res) => {
  res.json({ data: await service.resendInvitation(actor(req), idParam(req)) });
});

teachersRouter.post('/teachers/:id/password-reset', manage, async (req, res) => {
  await service.triggerPasswordReset(actor(req), idParam(req));
  res
    .status(202)
    .json({ data: { message: 'A password reset link has been emailed to the teacher.' } });
});

teachersRouter.get('/teachers/:id/audit', manage, async (req, res) => {
  const { page, pageSize } = query(req, paginationQuery);
  res.json(await service.teacherAudit(auth(req).schoolId, idParam(req), page, pageSize));
});
