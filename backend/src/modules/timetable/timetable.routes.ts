import express, { Router, type Request } from 'express';
import {
  importTimetableBody,
  listTimetableQuery,
  publishTimetableBody,
  timetableEntryBody,
  updateTimetableEntryBody,
} from '@school/shared';
import { auth, body, idParam, query } from '../../lib/http.js';
import { validation } from '../../lib/errors.js';
import { logger } from '../../config/logger.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { TooManyTimetablePagesError, readTimetablePdf } from './pdfTimetable.js';
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

/**
 * Reads a timetable PDF and returns its grid, one sheet per class. Nothing is saved: the
 * headmaster checks and edits the rows, then they go through /timetable/import.
 */
timetableRouter.post(
  '/timetable/import/pdf',
  requirePermission('timetable.manage'),
  rateLimit({ name: 'timetable-pdf', windowMs: 60 * 60 * 1000, max: 20 }),
  express.raw({ type: 'application/pdf', limit: '5mb' }),
  async (req, res) => {
    const data = Buffer.isBuffer(req.body) ? new Uint8Array(req.body) : null;
    if (!data || Buffer.from(data.subarray(0, 5)).toString('latin1') !== '%PDF-') {
      throw validation({ file: ['Upload the timetable as a PDF file'] });
    }
    try {
      res.json({ data: await readTimetablePdf(data) });
    } catch (err) {
      logger.warn({ err, requestId: req.requestId }, 'Timetable PDF could not be read');
      throw validation({
        file: [
          err instanceof TooManyTimetablePagesError
            ? `This PDF has ${err.pages} pages. A timetable has one page per class; check that it is the right file.`
            : 'This PDF could not be read. Check that it is the timetable, or upload it as Excel instead.',
        ],
      });
    }
  },
);

timetableRouter.post(
  '/timetable/import',
  requirePermission('timetable.manage'),
  async (req, res) => {
    const input = body(req, importTimetableBody);
    const result = await service.importTimetable(actor(req), input);
    const failed = result.rows.some((r) => r.error);
    // Problems come back row by row (always 200), so the page can show them next to each row.
    res.json({
      data: { ...result, dryRun: input.dryRun || failed, saved: !input.dryRun && !failed },
    });
  },
);

timetableRouter.post(
  '/timetable/publish',
  requirePermission('timetable.manage'),
  async (req, res) => {
    res.json({ data: await service.publish(actor(req), body(req, publishTimetableBody)) });
  },
);
