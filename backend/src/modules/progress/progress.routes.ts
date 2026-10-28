import { Router } from 'express';
import { z } from 'zod';
import { uuid } from '@school/shared';
import { auth, idParam, query, teacherAuth } from '../../lib/http.js';
import { AppError } from '../../lib/errors.js';
import { requirePermission, requireRole } from '../../middleware/requireRole.js';
import * as service from './progress.service.js';

export const progressRouter = Router();

const termQuery = z.object({ termId: uuid.optional() });

progressRouter.get('/progress/me', requireRole('TEACHER'), async (req, res) => {
  const a = teacherAuth(req);
  const { termId } = query(req, termQuery);
  res.json({ data: await service.teacherProgress(a.schoolId, a.teacherProfileId, termId) });
});

progressRouter.get('/progress/me/weeks/:weekNumber', requireRole('TEACHER'), async (req, res) => {
  const a = teacherAuth(req);
  const week = Number(req.params.weekNumber);
  if (!Number.isInteger(week) || week < 1 || week > 20)
    throw new AppError('NOT_FOUND', 'Week not found');
  res.json({ data: await service.teacherWeek(a.schoolId, a.teacherProfileId, week) });
});

progressRouter.get('/progress/teachers', requirePermission('reports.view'), async (req, res) => {
  const { termId } = query(req, termQuery);
  res.json({ data: await service.schoolTeacherProgress(auth(req).schoolId, termId) });
});

progressRouter.get(
  '/progress/teachers/:id',
  requirePermission('reports.view'),
  async (req, res) => {
    const { termId } = query(req, termQuery);
    res.json({ data: await service.teacherProgress(auth(req).schoolId, idParam(req), termId) });
  },
);
