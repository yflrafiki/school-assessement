import express, { Router, type Request } from 'express';
import { z } from 'zod';
import {
  bulkReviewBody,
  createImportBody,
  curriculumQuery,
  listImportRowsQuery,
  reviewImportRowBody,
  uuid,
} from '@school/shared';
import { auth, body, idParam, query } from '../../lib/http.js';
import { validation } from '../../lib/errors.js';
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

/**
 * Upload the scheme-of-learning PDF itself. The server rebuilds its tables and stages every
 * row for review, exactly as if the extractor's JSON had been uploaded.
 */
curriculumRouter.post(
  '/curriculum/imports/pdf',
  importer,
  express.raw({ type: 'application/pdf', limit: '20mb' }),
  async (req, res) => {
    const { termId, fileName } = query(
      req,
      z.object({ termId: uuid, fileName: z.string().trim().min(1).max(200).default('scheme.pdf') }),
    );
    const data = Buffer.isBuffer(req.body) ? new Uint8Array(req.body) : null;
    if (
      !data ||
      data.length < 5 ||
      Buffer.from(data.subarray(0, 5)).toString('latin1') !== '%PDF-'
    ) {
      throw validation({ file: ['Upload the scheme of learning as a PDF file'] });
    }
    const { batch, created } = await service.createImportFromPdf(actor(req), {
      termId,
      fileName,
      data,
    });
    res.status(created ? 201 : 200).json({ data: batch, meta: { created } });
  },
);

curriculumRouter.post('/curriculum/imports/:id/rows/bulk-review', importer, async (req, res) => {
  const input = body(req, bulkReviewBody);
  res.json({ data: await service.bulkApprove(actor(req), idParam(req), input) });
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
