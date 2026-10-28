import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  createImportBody,
  curriculumQuery,
  listImportRowsQuery,
  reviewImportRowBody,
  uuid,
} from '@school/shared';
import { auth, body, idParam, query } from '../../lib/http.js';
import { requirePermission } from '../../middleware/requireRole.js';
import * as service from './curriculum.service.js';

export const curriculumRouter = Router();

const actor = (req: Request) => {
  const a = auth(req);
  return { schoolId: a.schoolId, userId: a.userId, requestId: req.requestId };
};
const importer = requirePermission('curriculum.import');

curriculumRouter.get('/curriculum', async (req, res) => {
  res.json({ data: await service.getCurriculum(auth(req).schoolId, query(req, curriculumQuery)) });
});

curriculumRouter.get('/curriculum/topics', async (req, res) => {
  const a = auth(req);
  const { lessonId } = query(req, z.object({ lessonId: uuid }));
  const scope =
    a.role === 'TEACHER'
      ? (a.teacherProfileId ?? '00000000-0000-0000-0000-000000000000')
      : undefined;
  res.json({ data: await service.topicsForLesson(a.schoolId, lessonId, scope) });
});

curriculumRouter.get('/curriculum/schemes', async (req, res) => {
  const { termId } = query(req, z.object({ termId: uuid.optional() }));
  res.json({ data: await service.listSchemes(auth(req).schoolId, termId) });
});

curriculumRouter.post(
  '/curriculum/schemes/:id/publish',
  requirePermission('school.setup'),
  async (req, res) => {
    res.json({ data: await service.publishScheme(actor(req), idParam(req)) });
  },
);

curriculumRouter.get('/curriculum/imports', importer, async (req, res) => {
  res.json({ data: await service.listImports(auth(req).schoolId) });
});

curriculumRouter.post('/curriculum/imports', importer, async (req, res) => {
  const { batch, created } = await service.createImport(actor(req), body(req, createImportBody));
  res.status(created ? 201 : 200).json({ data: batch, meta: { created } });
});

curriculumRouter.get('/curriculum/imports/:id', importer, async (req, res) => {
  res.json({ data: await service.getImport(auth(req).schoolId, idParam(req)) });
});

curriculumRouter.get('/curriculum/imports/:id/rows', importer, async (req, res) => {
  res.json(
    await service.listImportRows(auth(req).schoolId, idParam(req), query(req, listImportRowsQuery)),
  );
});

curriculumRouter.patch('/curriculum/imports/:id/rows/:rowId', importer, async (req, res) => {
  const data = await service.reviewRow(
    actor(req),
    idParam(req),
    idParam(req, 'rowId'),
    body(req, reviewImportRowBody),
  );
  res.json({ data });
});

curriculumRouter.post('/curriculum/imports/:id/approve', importer, async (req, res) => {
  res.json({ data: await service.approveImport(actor(req), idParam(req)) });
});
