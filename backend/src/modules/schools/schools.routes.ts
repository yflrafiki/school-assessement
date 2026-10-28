import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  createAcademicYearBody,
  createCalendarDayBody,
  createClassBody,
  createLanguageBody,
  createTermBody,
  termWeeksBody,
  updateClassBody,
  updateSubjectBody,
  updateTermBody,
  uuid,
  weekPolicyBody,
} from '@school/shared';
import { auth, body, idParam, query } from '../../lib/http.js';
import { requirePermission } from '../../middleware/requireRole.js';
import * as service from './schools.service.js';

export const schoolsRouter = Router();

const actor = (req: Request) => {
  const a = auth(req);
  return { schoolId: a.schoolId, userId: a.userId, requestId: req.requestId };
};
const setup = requirePermission('school.setup');

// Reference data every signed-in user may read (forms and filters need it).
schoolsRouter.get('/academic-years', async (req, res) => {
  res.json({ data: await service.listAcademicYears(auth(req).schoolId) });
});
schoolsRouter.get('/terms', async (req, res) => {
  res.json({ data: await service.listTerms(auth(req).schoolId) });
});
schoolsRouter.get('/terms/:id/weeks', async (req, res) => {
  res.json({ data: await service.getTermWeeks(auth(req).schoolId, idParam(req)) });
});
schoolsRouter.get('/classes', async (req, res) => {
  res.json({ data: await service.listClasses(auth(req).schoolId) });
});
schoolsRouter.get('/subjects', async (req, res) => {
  res.json({ data: await service.listSubjects(auth(req).schoolId) });
});
schoolsRouter.get('/calendar-days', async (req, res) => {
  res.json({ data: await service.listCalendarDays(auth(req).schoolId) });
});
schoolsRouter.get('/week-policies', async (req, res) => {
  const { termId } = query(req, z.object({ termId: uuid.optional() }));
  res.json({ data: await service.listWeekPolicies(auth(req).schoolId, termId) });
});

schoolsRouter.post('/academic-years', setup, async (req, res) => {
  res.status(201).json({
    data: await service.createAcademicYear(actor(req), body(req, createAcademicYearBody)),
  });
});
schoolsRouter.post('/terms', setup, async (req, res) => {
  res.status(201).json({ data: await service.createTerm(actor(req), body(req, createTermBody)) });
});
schoolsRouter.patch('/terms/:id', setup, async (req, res) => {
  res.json({ data: await service.updateTerm(actor(req), idParam(req), body(req, updateTermBody)) });
});
schoolsRouter.put('/terms/:id/weeks', setup, async (req, res) => {
  res.json({
    data: await service.setTermWeeks(actor(req), idParam(req), body(req, termWeeksBody)),
  });
});
schoolsRouter.post('/classes', setup, async (req, res) => {
  res.status(201).json({ data: await service.createClass(actor(req), body(req, createClassBody)) });
});
schoolsRouter.patch('/classes/:id', setup, async (req, res) => {
  res.json({
    data: await service.updateClass(actor(req), idParam(req), body(req, updateClassBody)),
  });
});
schoolsRouter.post('/subjects', setup, async (req, res) => {
  const { name } = body(req, createLanguageBody);
  res.status(201).json({ data: await service.createLanguage(actor(req), name) });
});
schoolsRouter.patch('/subjects/:id', setup, async (req, res) => {
  res.json({
    data: await service.updateSubject(actor(req), idParam(req), body(req, updateSubjectBody)),
  });
});
schoolsRouter.post('/calendar-days', setup, async (req, res) => {
  res
    .status(201)
    .json({ data: await service.createCalendarDay(actor(req), body(req, createCalendarDayBody)) });
});
schoolsRouter.delete('/calendar-days/:id', setup, async (req, res) => {
  await service.deleteCalendarDay(actor(req), idParam(req));
  res.status(204).end();
});
schoolsRouter.put('/week-policies', setup, async (req, res) => {
  res.json({ data: await service.putWeekPolicy(actor(req), body(req, weekPolicyBody)) });
});
