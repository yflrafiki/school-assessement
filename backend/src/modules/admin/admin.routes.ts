import { Router } from 'express';
import { z } from 'zod';
import { ROLES, USER_STATUSES, paginationQuery, uuid } from '@school/shared';
import { idParam, query } from '../../lib/http.js';
import { requirePermission } from '../../middleware/requireRole.js';
import * as service from './admin.service.js';
import { prisma } from '../../lib/db.js';
import { notFound } from '../../lib/errors.js';
import { sendRecordsExport } from '../reports/recordsExport.js';

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

/** The same records download as the headmaster's, for the school (this system serves one). */
adminRouter.get('/admin/records-export', async (req, res) => {
  const school = await prisma.school.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!school) throw notFound('School');
  await sendRecordsExport(req, res, school.id);
});
