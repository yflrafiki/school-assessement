import type { z } from 'zod';
import type {
  createAcademicYearBody,
  createCalendarDayBody,
  createClassBody,
  createTermBody,
  termWeeksBody,
  updateClassBody,
  updateSubjectBody,
  updateTermBody,
  WeekPolicyBody,
} from '@school/shared';
import { prisma } from '../../lib/db.js';
import { AppError, isUniqueViolation, notFound, validation } from '../../lib/errors.js';
import { fromDbDate, toDbDate } from '../../lib/dates.js';
import { audit } from '../../lib/audit.js';
import { syncSchoolAssignments } from '../lessons/lessons.service.js';

interface Actor {
  schoolId: string;
  userId: string;
  requestId: string;
}

const auditFor = (actor: Actor) => ({
  schoolId: actor.schoolId,
  actorId: actor.userId,
  requestId: actor.requestId,
});

// ---------- Academic years and terms ----------

export async function listAcademicYears(schoolId: string) {
  const years = await prisma.academicYear.findMany({
    where: { schoolId },
    include: {
      terms: { orderBy: { number: 'asc' }, include: { _count: { select: { weeks: true } } } },
    },
    orderBy: { startDate: 'desc' },
  });
  return years.map((y) => ({
    id: y.id,
    name: y.name,
    startDate: fromDbDate(y.startDate),
    endDate: fromDbDate(y.endDate),
    terms: y.terms.map(termDto),
  }));
}

function termDto(t: {
  id: string;
  academicYearId: string;
  number: number;
  name: string;
  startDate: Date;
  endDate: Date;
  isCurrent: boolean;
  _count?: { weeks: number };
}) {
  return {
    id: t.id,
    academicYearId: t.academicYearId,
    number: t.number,
    name: t.name,
    startDate: fromDbDate(t.startDate),
    endDate: fromDbDate(t.endDate),
    isCurrent: t.isCurrent,
    weekCount: t._count?.weeks ?? 0,
  };
}

export async function createAcademicYear(
  actor: Actor,
  input: z.infer<typeof createAcademicYearBody>,
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const year = await tx.academicYear.create({
        data: {
          schoolId: actor.schoolId,
          name: input.name,
          startDate: toDbDate(input.startDate),
          endDate: toDbDate(input.endDate),
        },
      });
      await audit(tx, {
        ...auditFor(actor),
        action: 'academic_year.created',
        entityType: 'AcademicYear',
        entityId: year.id,
        metadata: { name: input.name },
      });
      return {
        id: year.id,
        name: year.name,
        startDate: input.startDate,
        endDate: input.endDate,
        terms: [],
      };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw validation({ name: ['This academic year already exists'] });
    throw err;
  }
}

export async function listTerms(schoolId: string) {
  const terms = await prisma.term.findMany({
    where: { schoolId },
    include: { academicYear: { select: { name: true } }, _count: { select: { weeks: true } } },
    orderBy: [{ startDate: 'desc' }],
  });
  return terms.map((t) => ({ ...termDto(t), academicYearName: t.academicYear.name }));
}

export async function getCurrentTerm(schoolId: string) {
  return prisma.term.findFirst({ where: { schoolId, isCurrent: true } });
}

export async function createTerm(actor: Actor, input: z.infer<typeof createTermBody>) {
  const year = await prisma.academicYear.findFirst({
    where: { id: input.academicYearId, schoolId: actor.schoolId },
  });
  if (!year) throw notFound('Academic year');
  if (input.startDate < fromDbDate(year.startDate) || input.endDate > fromDbDate(year.endDate)) {
    throw validation({ startDate: ['The term must fall within the academic year'] });
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const hasCurrent = await tx.term.count({
        where: { schoolId: actor.schoolId, isCurrent: true },
      });
      const term = await tx.term.create({
        data: {
          schoolId: actor.schoolId,
          academicYearId: year.id,
          number: input.number,
          name: input.name,
          startDate: toDbDate(input.startDate),
          endDate: toDbDate(input.endDate),
          isCurrent: hasCurrent === 0,
        },
      });
      await audit(tx, {
        ...auditFor(actor),
        action: 'term.created',
        entityType: 'Term',
        entityId: term.id,
        metadata: { name: input.name },
      });
      return termDto(term);
    });
  } catch (err) {
    if (isUniqueViolation(err))
      throw validation({ number: ['This term number already exists for the year'] });
    throw err;
  }
}

export async function updateTerm(
  actor: Actor,
  termId: string,
  input: z.infer<typeof updateTermBody>,
) {
  return prisma.$transaction(async (tx) => {
    const term = await tx.term.findFirst({ where: { id: termId, schoolId: actor.schoolId } });
    if (!term) throw notFound('Term');
    if (input.isCurrent) {
      await tx.term.updateMany({
        where: { schoolId: actor.schoolId, isCurrent: true },
        data: { isCurrent: false },
      });
    }
    const updated = await tx.term.update({
      where: { id: termId },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.isCurrent !== undefined ? { isCurrent: input.isCurrent } : {}),
      },
    });
    await audit(tx, {
      ...auditFor(actor),
      action: 'term.updated',
      entityType: 'Term',
      entityId: termId,
      metadata: input,
    });
    return termDto(updated);
  });
}

export async function getTermWeeks(schoolId: string, termId: string) {
  const term = await prisma.term.findFirst({ where: { id: termId, schoolId } });
  if (!term) throw notFound('Term');
  const weeks = await prisma.termWeek.findMany({
    where: { termId },
    orderBy: { weekNumber: 'asc' },
  });
  return weeks.map((w) => ({
    weekNumber: w.weekNumber,
    startDate: fromDbDate(w.startDate),
    endDate: fromDbDate(w.endDate),
  }));
}

export async function setTermWeeks(
  actor: Actor,
  termId: string,
  input: z.infer<typeof termWeeksBody>,
) {
  const weeks = [...input.weeks].sort((a, b) => a.weekNumber - b.weekNumber);
  return prisma.$transaction(
    async (tx) => {
      const term = await tx.term.findFirst({ where: { id: termId, schoolId: actor.schoolId } });
      if (!term) throw notFound('Term');
      const start = fromDbDate(term.startDate);
      const end = fromDbDate(term.endDate);

      const problems: string[] = [];
      weeks.forEach((w, i) => {
        if (w.startDate > w.endDate) problems.push(`Week ${w.weekNumber} ends before it starts`);
        if (w.startDate < start || w.endDate > end)
          problems.push(`Week ${w.weekNumber} falls outside the term`);
        const prev = weeks[i - 1];
        if (prev && prev.weekNumber === w.weekNumber)
          problems.push(`Week ${w.weekNumber} appears twice`);
        if (prev && w.startDate <= prev.endDate)
          problems.push(`Week ${w.weekNumber} overlaps week ${prev.weekNumber}`);
      });
      if (problems.length) throw validation({ weeks: problems });

      await tx.termWeek.deleteMany({ where: { termId } });
      await tx.termWeek.createMany({
        data: weeks.map((w) => ({
          schoolId: actor.schoolId,
          termId,
          weekNumber: w.weekNumber,
          startDate: toDbDate(w.startDate),
          endDate: toDbDate(w.endDate),
        })),
      });
      await syncSchoolAssignments(tx, actor.schoolId, { termId });
      await audit(tx, {
        ...auditFor(actor),
        action: 'term.weeks_set',
        entityType: 'Term',
        entityId: termId,
        metadata: { count: weeks.length },
      });
      return weeks;
    },
    { timeout: 120_000 },
  );
}

// ---------- Classes ----------

export async function listClasses(schoolId: string) {
  return prisma.schoolClass.findMany({
    where: { schoolId },
    orderBy: [{ level: 'asc' }, { name: 'asc' }],
    select: { id: true, level: true, name: true, isActive: true },
  });
}

export async function createClass(actor: Actor, input: z.infer<typeof createClassBody>) {
  try {
    return await prisma.$transaction(async (tx) => {
      const c = await tx.schoolClass.create({
        data: { schoolId: actor.schoolId, level: input.level, name: input.name },
      });
      await audit(tx, {
        ...auditFor(actor),
        action: 'class.created',
        entityType: 'SchoolClass',
        entityId: c.id,
        metadata: input,
      });
      return { id: c.id, level: c.level, name: c.name, isActive: c.isActive };
    });
  } catch (err) {
    if (isUniqueViolation(err))
      throw validation({ name: ['A class with this name already exists'] });
    throw err;
  }
}

export async function updateClass(
  actor: Actor,
  classId: string,
  input: z.infer<typeof updateClassBody>,
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const c = await tx.schoolClass.findFirst({
        where: { id: classId, schoolId: actor.schoolId },
      });
      if (!c) throw notFound('Class');
      const updated = await tx.schoolClass.update({ where: { id: classId }, data: input });
      await audit(tx, {
        ...auditFor(actor),
        action: 'class.updated',
        entityType: 'SchoolClass',
        entityId: classId,
        metadata: input,
      });
      return {
        id: updated.id,
        level: updated.level,
        name: updated.name,
        isActive: updated.isActive,
      };
    });
  } catch (err) {
    if (isUniqueViolation(err))
      throw validation({ name: ['A class with this name already exists'] });
    throw err;
  }
}

// ---------- Subjects and languages ----------

export async function listSubjects(schoolId: string) {
  const rows = await prisma.subject.findMany({
    where: { OR: [{ schoolId: null }, { schoolId }] },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    code: s.code,
    isNational: s.schoolId === null,
    isFramework: s.isFramework,
    parentSubjectId: s.parentSubjectId,
    isActive: s.isActive,
    // Teachers are assigned to language variants, never to the generic framework subject.
    assignable: !s.isFramework && s.isActive,
  }));
}

export async function createLanguage(actor: Actor, name: string) {
  const framework = await prisma.subject.findFirst({
    where: { schoolId: null, isFramework: true },
  });
  if (!framework)
    throw new AppError(
      'CONFLICT',
      'The Ghanaian Language framework subject is missing. Run the database seed.',
    );
  const exists = await prisma.subject.findFirst({
    where: { schoolId: actor.schoolId, name: { equals: name, mode: 'insensitive' } },
  });
  if (exists) throw validation({ name: ['This language already exists'] });

  return prisma.$transaction(async (tx) => {
    const s = await tx.subject.create({
      data: {
        schoolId: actor.schoolId,
        name,
        code: `GHL-${name
          .toUpperCase()
          .replace(/[^A-Z]/g, '')
          .slice(0, 10)}`,
        parentSubjectId: framework.id,
        sortOrder: framework.sortOrder,
      },
    });
    await audit(tx, {
      ...auditFor(actor),
      action: 'subject.language_created',
      entityType: 'Subject',
      entityId: s.id,
      metadata: { name },
    });
    return {
      id: s.id,
      name: s.name,
      code: s.code,
      isNational: false,
      isFramework: false,
      parentSubjectId: s.parentSubjectId,
      isActive: s.isActive,
      assignable: true,
    };
  });
}

export async function updateSubject(
  actor: Actor,
  subjectId: string,
  input: z.infer<typeof updateSubjectBody>,
) {
  return prisma.$transaction(async (tx) => {
    // National subjects are shared and cannot be edited by a school.
    const s = await tx.subject.findFirst({ where: { id: subjectId, schoolId: actor.schoolId } });
    if (!s) throw notFound('Subject');
    const updated = await tx.subject.update({ where: { id: subjectId }, data: input });
    await audit(tx, {
      ...auditFor(actor),
      action: 'subject.updated',
      entityType: 'Subject',
      entityId: subjectId,
      metadata: input,
    });
    return { id: updated.id, name: updated.name, isActive: updated.isActive };
  });
}

// ---------- Calendar days ----------

export async function listCalendarDays(schoolId: string) {
  const days = await prisma.schoolCalendarDay.findMany({
    where: { schoolId },
    orderBy: { date: 'asc' },
  });
  return days.map((d) => ({
    id: d.id,
    date: fromDbDate(d.date),
    kind: d.kind,
    description: d.description,
  }));
}

export async function createCalendarDay(
  actor: Actor,
  input: z.infer<typeof createCalendarDayBody>,
) {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const day = await tx.schoolCalendarDay.create({
          data: {
            schoolId: actor.schoolId,
            date: toDbDate(input.date),
            kind: input.kind,
            description: input.description,
            createdById: actor.userId,
          },
        });
        await syncSchoolAssignments(tx, actor.schoolId, termCovering(input.date));
        await audit(tx, {
          ...auditFor(actor),
          action: 'calendar_day.created',
          entityType: 'SchoolCalendarDay',
          entityId: day.id,
          metadata: input,
        });
        return { id: day.id, date: input.date, kind: day.kind, description: day.description };
      },
      { timeout: 120_000 },
    );
  } catch (err) {
    if (isUniqueViolation(err)) throw validation({ date: ['This date is already marked'] });
    throw err;
  }
}

export async function deleteCalendarDay(actor: Actor, id: string) {
  await prisma.$transaction(
    async (tx) => {
      const day = await tx.schoolCalendarDay.findFirst({ where: { id, schoolId: actor.schoolId } });
      if (!day) throw notFound('Calendar day');
      await tx.schoolCalendarDay.delete({ where: { id } });
      await syncSchoolAssignments(tx, actor.schoolId, termCovering(fromDbDate(day.date)));
      await audit(tx, {
        ...auditFor(actor),
        action: 'calendar_day.deleted',
        entityType: 'SchoolCalendarDay',
        entityId: id,
        metadata: { date: fromDbDate(day.date), kind: day.kind, description: day.description },
      });
    },
    { timeout: 120_000 },
  );
}

function termCovering(date: string) {
  const d = toDbDate(date);
  return { term: { startDate: { lte: d }, endDate: { gte: d } } };
}

// ---------- Week policies ----------

export async function listWeekPolicies(schoolId: string, termId?: string) {
  const rows = await prisma.weekPolicy.findMany({
    where: { schoolId, ...(termId ? { termId } : {}) },
    include: { schoolClass: { select: { name: true } } },
    orderBy: [{ weekNumber: 'asc' }, { id: 'asc' }],
  });
  return rows.map((p) => ({
    id: p.id,
    termId: p.termId,
    weekNumber: p.weekNumber,
    level: p.level,
    classId: p.classId,
    className: p.schoolClass?.name ?? null,
    kind: p.kind,
    note: p.note,
  }));
}

/** Sets or clears (kind = null) the override for one week of a level or class. */
export async function putWeekPolicy(actor: Actor, input: WeekPolicyBody) {
  await prisma.$transaction(
    async (tx) => {
      const term = await tx.term.findFirst({
        where: { id: input.termId, schoolId: actor.schoolId },
      });
      if (!term) throw notFound('Term');
      let level = input.level ?? null;
      if (input.classId) {
        const c = await tx.schoolClass.findFirst({
          where: { id: input.classId, schoolId: actor.schoolId },
        });
        if (!c) throw notFound('Class');
        level = c.level;
      }
      const scope = input.classId
        ? { classId: input.classId }
        : { level: input.level ?? null, classId: null };
      const existing = await tx.weekPolicy.findFirst({
        where: {
          schoolId: actor.schoolId,
          termId: term.id,
          weekNumber: input.weekNumber,
          ...scope,
        },
      });

      if (input.kind === null) {
        if (existing) await tx.weekPolicy.delete({ where: { id: existing.id } });
      } else if (existing) {
        await tx.weekPolicy.update({
          where: { id: existing.id },
          data: { kind: input.kind, note: input.note ?? null },
        });
      } else {
        await tx.weekPolicy.create({
          data: {
            schoolId: actor.schoolId,
            termId: term.id,
            weekNumber: input.weekNumber,
            level: input.classId ? null : (input.level ?? null),
            classId: input.classId ?? null,
            kind: input.kind,
            note: input.note ?? null,
            createdById: actor.userId,
          },
        });
      }

      await syncSchoolAssignments(tx, actor.schoolId, {
        termId: term.id,
        ...(input.classId
          ? { classId: input.classId }
          : { schoolClass: { level: level ?? undefined } }),
      });
      await audit(tx, {
        ...auditFor(actor),
        action: input.kind === null ? 'week_policy.cleared' : 'week_policy.set',
        entityType: 'Term',
        entityId: term.id,
        metadata: {
          weekNumber: input.weekNumber,
          level,
          classId: input.classId ?? null,
          kind: input.kind,
          note: input.note ?? null,
        },
      });
    },
    { timeout: 120_000 },
  );
  return listWeekPolicies(actor.schoolId, input.termId);
}
