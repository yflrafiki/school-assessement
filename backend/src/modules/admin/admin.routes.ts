import { Router } from 'express';
import { z } from 'zod';
import { ROLES, USER_STATUSES, paginationQuery, uuid } from '@school/shared';
import { idParam, query } from '../../lib/http.js';
import { requirePermission } from '../../middleware/requireRole.js';
import * as service from './admin.service.js';

/** The system admin's read-only view of every school. Only GET routes: nothing is changed here. */
export const adminRouter = Router();
adminRouter.use('/admin', requirePermission('system.view'));

adminRouter.get('/admin/overview', async (_req, res) => {
  res.json({ data: await service.overview() });
});

adminRouter.get('/admin/schools', async (_req, res) => {
  res.json({ data: await service.listSchools() });
});

adminRouter.get('/admin/schools/:id', async (req, res) => {
  res.json({ data: await service.getSchool(idParam(req)) });
});

adminRouter.get('/admin/users', async (req, res) => {
  const q = query(
    req,
    paginationQuery.extend({
      search: z.string().trim().max(100).optional(),
      role: z.enum(ROLES).optional(),
      status: z.enum(USER_STATUSES).optional(),
      schoolId: uuid.optional(),
    }),
  );
  res.json(await service.listUsers(q));
});

adminRouter.get('/admin/activity', async (req, res) => {
  const q = query(
    req,
    paginationQuery.extend({
      schoolId: uuid.optional(),
      action: z.string().trim().max(60).optional(),
    }),
  );
  res.json(await service.listActivity(q));
});
