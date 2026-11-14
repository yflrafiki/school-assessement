import { minutesToTime, type LessonState, type ListLessonsQuery } from '@school/shared';
import { prisma, type Db, type Prisma, type Tx } from '../../lib/db.js';
import { AppError, notFound } from '../../lib/errors.js';
import {
  addDays,
  eachDate,
  fromDbDate,
  isoWeekday,
  isWeekend,
  localNow,
  toDbDate,
} from '../../lib/dates.js';
import { audit } from '../../lib/audit.js';
import { pageArgs, pageMeta } from '../../lib/pagination.js';
import { paceLessons } from './pacing.js';
import { lessonState } from './lessonState.js';
import { isSpecialWeekDate, loadTermCalendar, type TermCalendar } from './weekKinds.js';

// ---------- Locking ----------

/**
 * Every change that can alter an assignment's completeness takes this row lock first,
 * so submissions, cancellations, waivers, absences, holidays and re-pacing serialise.
 */
export async function lockAssignment(
  tx: Tx,
  schoolId: string,
  assignmentId: string,
  teacherProfileId?: string,
): Promise<{ id: string } | null> {
  const rows = teacherProfileId
    ? await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM teaching_assignments
        WHERE id = ${assignmentId}::uuid AND school_id = ${schoolId}::uuid
          AND teacher_profile_id = ${teacherProfileId}::uuid AND is_active
        FOR UPDATE`
    : await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM teaching_assignments
        WHERE id = ${assignmentId}::uuid AND school_id = ${schoolId}::uuid
        FOR UPDATE`;
  return rows[0] ?? null;
}

/**
 * Locks several assignments in id order, so concurrent school-wide changes cannot deadlock.
 * One statement: ORDER BY with FOR UPDATE locks the rows in the order they are returned.
 */
export async function lockAssignmentsInOrder(tx: Tx, schoolId: string, ids: string[]) {
  const sorted = [...new Set(ids)].sort();
  if (!sorted.length) return;
  await tx.$queryRaw`
    SELECT id FROM teaching_assignments
    WHERE id = ANY(${sorted}::uuid[]) AND school_id = ${schoolId}::uuid
    ORDER BY id
    FOR UPDATE`;
}

// ---------- Closed days ----------

export async function closedDates(db: Db, schoolId: string): Promise<Set<string>> {
  const days = await db.schoolCalendarDay.findMany({ where: { schoolId }, select: { date: true } });
  return new Set(days.map((d) => fromDbDate(d.date)));
}

/** Latest school day on or before `date`. Lessons dated before it are overdue. */
export function lastSchoolDayOnOrBefore(date: string, closed: ReadonlySet<string>): string {
  let d = date;
  for (let i = 0; i < 366 && (isWeekend(d) || closed.has(d)); i += 1) d = addDays(d, -1);
  return d;
}

// ---------- Sync: generation, reconciliation, pacing ----------

export interface SyncResult {
  assignmentId: string;
  perWeek: number;
  previousPerWeek: number | null;
  requiredWeeks: number[];
  shortfall: number;
  lessonsCreated: number;
  lessonsRemoved: number;
  hasSubmittedRecords: boolean;
}

/**
 * What several syncs in one transaction share: the school's closed days, each class's term
 * calendar and each teacher's absences are read once, not once per subject. Only valid within
 * one transaction that does not change them.
 */
export interface SyncCache {
  closed?: Set<string>;
  calendars: Map<string, TermCalendar>;
  absences: Map<string, { startDate: Date; endDate: Date }[]>;
}

export const newSyncCache = (): SyncCache => ({ calendars: new Map(), absences: new Map() });

type SystemCancelReason = 'HOLIDAY' | 'SPECIAL_WEEK' | 'ABSENCE';

/** Sets each lesson's curriculum week in one statement, not one call per lesson. */
async function setLessonWeeks(tx: Tx, changes: { id: string; week: number | null }[]) {
  if (!changes.length) return;
  const ids = changes.map((c) => c.id);
  const weeks = changes.map((c) => c.week);
  await tx.$executeRaw`
    UPDATE lessons AS l SET week_number = v.week, updated_at = now()
    FROM unnest(${ids}::uuid[], ${weeks}::int[]) AS v(id, week)
    WHERE l.id = v.id`;
}

/**
 * Brings one assignment's lessons in line with its timetable, the calendar, absences and
 * special weeks, then re-paces them onto curriculum weeks. The caller must hold the assignment lock.
 * Changes are written in batches: on a remote database every call is a round trip.
 */
export async function syncAssignment(
  tx: Tx,
  assignmentId: string,
  opts: { generate: boolean },
  cache: SyncCache = newSyncCache(),
): Promise<SyncResult> {
  const assignment = await tx.teachingAssignment.findUniqueOrThrow({
    where: { id: assignmentId },
    include: {
      schoolClass: true,
      term: true,
      timetableEntries: { where: { deletedAt: null } },
    },
  });
  const { schoolId } = assignment;
  const termStart = fromDbDate(assignment.term.startDate);
  const termEnd = fromDbDate(assignment.term.endDate);
  let lessonsCreated = 0;
  let lessonsRemoved = 0;

  if (opts.generate) {
    const wanted: Prisma.LessonCreateManyInput[] = [];
    const wantedKeys = new Set<string>();
    for (const entry of assignment.timetableEntries) {
      const from = maxDate(termStart, fromDbDate(entry.validFrom));
      const to = minDate(termEnd, fromDbDate(entry.validTo));
      for (const date of eachDate(from, to)) {
        if (isoWeekday(date) !== entry.weekday) continue;
        wantedKeys.add(`${date}|${entry.startMinute}`);
        wanted.push({
          schoolId,
          assignmentId,
          timetableEntryId: entry.id,
          date: toDbDate(date),
          startMinute: entry.startMinute,
          endMinute: entry.endMinute,
        });
      }
    }
    if (wanted.length) {
      const created = await tx.lesson.createMany({ data: wanted, skipDuplicates: true });
      lessonsCreated = created.count;
    }

    // Generated lessons whose slot no longer exists: remove if untouched, otherwise cancel.
    const generated = await tx.lesson.findMany({
      where: { assignmentId, timetableEntryId: { not: null } },
      include: { record: { select: { id: true, status: true } } },
    });
    const remove: string[] = [];
    const cancelDraft: string[] = [];
    for (const l of generated) {
      if (wantedKeys.has(`${fromDbDate(l.date)}|${l.startMinute}`)) continue;
      // Untouched: scheduled, or cancelled by the system (holiday, absence, special week).
      // A headmaster's own cancellation and any record are history and stay.
      const untouched =
        l.status === 'SCHEDULED' ||
        (l.status === 'CANCELLED' && l.cancelReason !== 'SCHOOL_CANCELLATION');
      if (!l.record && untouched) remove.push(l.id);
      // A draft keeps the lesson as history; submitted work is never touched.
      else if (l.status === 'SCHEDULED' && l.record?.status === 'DRAFT') cancelDraft.push(l.id);
    }
    if (remove.length) {
      lessonsRemoved = (await tx.lesson.deleteMany({ where: { id: { in: remove } } })).count;
    }
    if (cancelDraft.length) {
      await tx.lesson.updateMany({
        where: { id: { in: cancelDraft } },
        data: {
          status: 'CANCELLED',
          cancelReason: 'SCHOOL_CANCELLATION',
          reason: 'Timetable slot removed',
        },
      });
    }
  }

  let calendar = cache.calendars.get(assignment.classId);
  if (!calendar) {
    calendar = await loadTermCalendar(
      tx,
      schoolId,
      assignment.termId,
      assignment.classId,
      assignment.schoolClass.level,
    );
    cache.calendars.set(assignment.classId, calendar);
  }
  const closed = (cache.closed ??= await closedDates(tx, schoolId));
  let absences = cache.absences.get(assignment.teacherProfileId);
  if (!absences) {
    absences = await tx.absence.findMany({
      where: {
        schoolId,
        teacherProfileId: assignment.teacherProfileId,
        revokedAt: null,
        startDate: { lte: assignment.term.endDate },
        endDate: { gte: assignment.term.startDate },
      },
      select: { startDate: true, endDate: true },
    });
    cache.absences.set(assignment.teacherProfileId, absences);
  }
  const teacherAbsences = absences;
  const lessons = await tx.lesson.findMany({
    where: { assignmentId },
    include: { record: { select: { status: true } } },
  });

  const absent = (date: string) =>
    teacherAbsences.some((a) => fromDbDate(a.startDate) <= date && date <= fromDbDate(a.endDate));

  // Reconcile system cancellations. Manual decisions and submitted work are left alone.
  // Changes are grouped by their new status, one update per group.
  const changed = new Map<
    string,
    { status: 'CANCELLED' | 'SCHEDULED'; reason: SystemCancelReason | null; ids: string[] }
  >();
  for (const l of lessons) {
    const manual =
      l.status === 'RESCHEDULED' ||
      l.status === 'WAIVED' ||
      (l.status === 'CANCELLED' && l.cancelReason === 'SCHOOL_CANCELLATION');
    const submitted = l.record?.status === 'SUBMITTED';
    if (manual || submitted) continue;

    const date = fromDbDate(l.date);
    const reason = closed.has(date)
      ? ('HOLIDAY' as const)
      : isSpecialWeekDate(calendar, date)
        ? ('SPECIAL_WEEK' as const)
        : absent(date)
          ? ('ABSENCE' as const)
          : null;
    const status = reason ? 'CANCELLED' : 'SCHEDULED';
    if (l.status !== status || l.cancelReason !== reason) {
      const key = `${status}|${reason ?? ''}`;
      const group = changed.get(key) ?? { status, reason, ids: [] };
      group.ids.push(l.id);
      changed.set(key, group);
      l.status = status;
      l.cancelReason = reason;
    }
  }
  for (const g of changed.values()) {
    await tx.lesson.updateMany({
      where: { id: { in: g.ids } },
      data: { status: g.status, cancelReason: g.reason, reason: null },
    });
  }

  const perWeek = assignment.timetableEntries.length;
  const pacing = paceLessons(
    lessons.map((l) => ({
      id: l.id,
      date: fromDbDate(l.date),
      startMinute: l.startMinute,
      status: l.status,
      hasSubmittedRecord: l.record?.status === 'SUBMITTED',
      currentWeek: l.weekNumber,
    })),
    calendar.requiredWeeks,
    perWeek,
  );
  await setLessonWeeks(
    tx,
    lessons
      .map((l) => ({ id: l.id, week: pacing.weeks.get(l.id) ?? null, was: l.weekNumber }))
      .filter((c) => c.week !== c.was),
  );

  const previousPerWeek = assignment.pacedPerWeek;
  if (opts.generate && previousPerWeek !== perWeek) {
    await tx.teachingAssignment.update({
      where: { id: assignmentId },
      data: { pacedPerWeek: perWeek },
    });
  }

  return {
    assignmentId,
    perWeek,
    previousPerWeek,
    requiredWeeks: calendar.requiredWeeks,
    shortfall: pacing.shortfall,
    lessonsCreated,
    lessonsRemoved,
    hasSubmittedRecords: lessons.some((l) => l.record?.status === 'SUBMITTED'),
  };
}

/** Re-syncs every assignment touched by a school-wide change (holiday, policy, scheme publish). */
export async function syncSchoolAssignments(
  tx: Tx,
  schoolId: string,
  where: Prisma.TeachingAssignmentWhereInput = {},
) {
  const assignments = await tx.teachingAssignment.findMany({
    where: { schoolId, isActive: true, pacedPerWeek: { not: null }, ...where },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  await lockAssignmentsInOrder(
    tx,
    schoolId,
    assignments.map((a) => a.id),
  );
  const cache = newSyncCache();
  for (const a of assignments) await syncAssignment(tx, a.id, { generate: false }, cache);
  return assignments.length;
}

function maxDate(a: string, b: string) {
  return a > b ? a : b;
}
function minDate(a: string, b: string) {
  return a < b ? a : b;
}

// ---------- Reading lessons ----------

const lessonInclude = {
  assignment: {
    select: {
      id: true,
      subject: { select: { id: true, name: true } },
      schoolClass: { select: { id: true, name: true, level: true } },
      teacherProfile: { select: { id: true, staffId: true, user: { select: { fullName: true } } } },
    },
  },
  record: { select: { id: true, status: true, submittedAt: true, isLate: true } },
} satisfies Prisma.LessonInclude;

type LessonRow = Prisma.LessonGetPayload<{ include: typeof lessonInclude }>;

export function toLessonDto(
  l: LessonRow,
  now: { date: string; minutes: number },
  closed: ReadonlySet<string>,
) {
  const date = fromDbDate(l.date);
  return {
    id: l.id,
    date,
    startTime: minutesToTime(l.startMinute),
    endTime: minutesToTime(l.endMinute),
    status: l.status,
    state: lessonState(
      {
        date,
        startMinute: l.startMinute,
        status: l.status,
        hasSubmittedRecord: l.record?.status === 'SUBMITTED',
        weekNumber: l.weekNumber,
      },
      now,
      closed,
    ),
    cancelReason: l.cancelReason,
    reason: l.reason,
    weekNumber: l.weekNumber,
    rescheduledFromId: l.rescheduledFromId,
    assignment: {
      id: l.assignment.id,
      subject: l.assignment.subject,
      schoolClass: l.assignment.schoolClass,
      teacher: {
        id: l.assignment.teacherProfile.id,
        staffId: l.assignment.teacherProfile.staffId,
        fullName: l.assignment.teacherProfile.user.fullName,
      },
    },
    record: l.record,
  };
}
export type LessonDto = ReturnType<typeof toLessonDto>;

export async function schoolNow(schoolId: string) {
  const school = await prisma.school.findUniqueOrThrow({
    where: { id: schoolId },
    select: { timezone: true },
  });
  return localNow(school.timezone);
}

/** Translates a derived state into a database filter, so state filters stay server-side and paginated. */
function stateWhere(
  state: LessonState,
  now: { date: string; minutes: number },
  overdueBefore: string,
): Prisma.LessonWhereInput {
  const today = toDbDate(now.date);
  const notSubmitted: Prisma.LessonWhereInput = {
    OR: [{ record: { is: null } }, { record: { is: { status: 'DRAFT' } } }],
  };
  const started: Prisma.LessonWhereInput = {
    OR: [{ date: { lt: today } }, { date: today, startMinute: { lte: now.minutes } }],
  };
  switch (state) {
    case 'CANCELLED':
    case 'RESCHEDULED':
    case 'WAIVED':
      return { status: state };
    case 'COMPLETED':
      return { status: 'SCHEDULED', record: { is: { status: 'SUBMITTED' } } };
    case 'UPCOMING':
      return {
        status: 'SCHEDULED',
        ...notSubmitted,
        AND: [{ OR: [{ date: { gt: today } }, { date: today, startMinute: { gt: now.minutes } }] }],
      };
    case 'OVERDUE':
      return {
        status: 'SCHEDULED',
        weekNumber: { not: null },
        date: { lt: toDbDate(overdueBefore) },
        ...notSubmitted,
      };
    case 'DUE':
      return {
        status: 'SCHEDULED',
        ...notSubmitted,
        AND: [started, { OR: [{ weekNumber: null }, { date: { gte: toDbDate(overdueBefore) } }] }],
      };
  }
}

export async function listLessons(
  schoolId: string,
  q: ListLessonsQuery,
  scope: { teacherProfileId?: string } = {},
) {
  const [now, closed] = await Promise.all([schoolNow(schoolId), closedDates(prisma, schoolId)]);
  const overdueBefore = lastSchoolDayOnOrBefore(now.date, closed);

  const assignmentFilter: Prisma.TeachingAssignmentWhereInput = {
    ...(scope.teacherProfileId ? { teacherProfileId: scope.teacherProfileId } : {}),
    ...(q.teacherProfileId ? { teacherProfileId: q.teacherProfileId } : {}),
    ...(q.classId ? { classId: q.classId } : {}),
    ...(q.subjectId ? { subjectId: q.subjectId } : {}),
    ...(q.level ? { schoolClass: { level: q.level } } : {}),
  };
  // A teacher filtering on someone else's lessons simply gets nothing.
  if (
    scope.teacherProfileId &&
    q.teacherProfileId &&
    q.teacherProfileId !== scope.teacherProfileId
  ) {
    return { data: [], meta: pageMeta(q.page, q.pageSize, 0) };
  }

  const where: Prisma.LessonWhereInput = {
    schoolId,
    assignment: assignmentFilter,
    ...(q.assignmentId ? { assignmentId: q.assignmentId } : {}),
    ...(q.date ? { date: toDbDate(q.date) } : {}),
    ...(!q.date && (q.dateFrom || q.dateTo)
      ? {
          date: {
            ...(q.dateFrom ? { gte: toDbDate(q.dateFrom) } : {}),
            ...(q.dateTo ? { lte: toDbDate(q.dateTo) } : {}),
          },
        }
      : {}),
    ...(q.state ? { AND: [stateWhere(q.state, now, overdueBefore)] } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.lesson.findMany({
      where,
      include: lessonInclude,
      orderBy: [{ date: 'asc' }, { startMinute: 'asc' }, { id: 'asc' }],
      ...pageArgs(q.page, q.pageSize),
    }),
    prisma.lesson.count({ where }),
  ]);
  return {
    data: rows.map((r) => toLessonDto(r, now, closed)),
    meta: pageMeta(q.page, q.pageSize, total),
  };
}

export async function getLesson(
  schoolId: string,
  lessonId: string,
  scope: { teacherProfileId?: string } = {},
) {
  const lesson = await prisma.lesson.findFirst({
    where: {
      id: lessonId,
      schoolId,
      ...(scope.teacherProfileId
        ? { assignment: { teacherProfileId: scope.teacherProfileId } }
        : {}),
    },
    include: lessonInclude,
  });
  if (!lesson) throw notFound('Lesson');
  const [now, closed] = await Promise.all([schoolNow(schoolId), closedDates(prisma, schoolId)]);
  return toLessonDto(lesson, now, closed);
}

/** Daily Lessons board: every lesson on a date with its state, grouped by teacher on the client. */
export async function dailyBoard(schoolId: string, date?: string) {
  const [now, closed] = await Promise.all([schoolNow(schoolId), closedDates(prisma, schoolId)]);
  const day = date ?? now.date;
  const rows = await prisma.lesson.findMany({
    where: { schoolId, date: toDbDate(day) },
    include: lessonInclude,
    orderBy: [{ startMinute: 'asc' }, { id: 'asc' }],
  });
  const lessons = rows.map((r) => toLessonDto(r, now, closed));
  const counts: Record<string, number> = {};
  for (const l of lessons) counts[l.state] = (counts[l.state] ?? 0) + 1;
  return { date: day, isClosed: closed.has(day) || isWeekend(day), counts, lessons };
}

// ---------- Headmaster exceptions ----------

interface Actor {
  schoolId: string;
  userId: string;
  requestId: string;
}

async function lessonForDecision(tx: Tx, actor: Actor, lessonId: string) {
  const lesson = await tx.lesson.findFirst({ where: { id: lessonId, schoolId: actor.schoolId } });
  if (!lesson) throw notFound('Lesson');
  await lockAssignment(tx, actor.schoolId, lesson.assignmentId);
  const fresh = await tx.lesson.findUniqueOrThrow({
    where: { id: lessonId },
    include: { record: true },
  });
  if (fresh.record?.status === 'SUBMITTED') {
    throw new AppError(
      'CONFLICT',
      'This lesson already has a submitted record and cannot be changed',
    );
  }
  if (fresh.status !== 'SCHEDULED') {
    throw new AppError('CONFLICT', `This lesson is already ${fresh.status.toLowerCase()}`);
  }
  return fresh;
}

export async function cancelLesson(actor: Actor, lessonId: string, reason: string) {
  await prisma.$transaction(async (tx) => {
    const lesson = await lessonForDecision(tx, actor, lessonId);
    await tx.lesson.update({
      where: { id: lesson.id },
      data: {
        status: 'CANCELLED',
        cancelReason: 'SCHOOL_CANCELLATION',
        reason,
        decidedById: actor.userId,
        decidedAt: new Date(),
      },
    });
    await syncAssignment(tx, lesson.assignmentId, { generate: false });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: 'lesson.cancelled',
      entityType: 'Lesson',
      entityId: lesson.id,
      metadata: { reason },
      requestId: actor.requestId,
    });
  });
  return getLesson(actor.schoolId, lessonId);
}

export async function waiveLesson(actor: Actor, lessonId: string, reason: string) {
  await prisma.$transaction(async (tx) => {
    const lesson = await lessonForDecision(tx, actor, lessonId);
    if (lesson.weekNumber === null) {
      throw new AppError('CONFLICT', 'Only lessons paced onto a curriculum week can be waived');
    }
    await tx.lesson.update({
      where: { id: lesson.id },
      data: { status: 'WAIVED', reason, decidedById: actor.userId, decidedAt: new Date() },
    });
    await syncAssignment(tx, lesson.assignmentId, { generate: false });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: 'lesson.waived',
      entityType: 'Lesson',
      entityId: lesson.id,
      metadata: { reason, weekNumber: lesson.weekNumber },
      requestId: actor.requestId,
    });
  });
  return getLesson(actor.schoolId, lessonId);
}

/**
 * For a school that starts using the system part-way through a term: every scheduled lesson
 * before `date` without a submitted record is waived in one step. Waived lessons keep their
 * curriculum week, so today's lessons stay on the right week and no earlier week locks them.
 */
export async function waiveLessonsBefore(
  actor: Actor,
  input: { termId: string; date: string; reason: string },
) {
  const now = await schoolNow(actor.schoolId);
  // Up to the coming Monday, so it can be set up over a weekend for the week ahead. Later
  // dates would waive lessons teachers are still expected to teach and record.
  const nextMonday = addDays(now.date, 8 - isoWeekday(now.date));
  if (input.date > nextMonday) {
    throw new AppError('VALIDATION_ERROR', 'Please check the date', {
      fields: { date: [`Choose a day up to Monday ${nextMonday}`] },
    });
  }
  return prisma.$transaction(
    async (tx) => {
      const term = await tx.term.findFirst({
        where: { id: input.termId, schoolId: actor.schoolId },
      });
      if (!term) throw notFound('Term');
      const ids = (
        await tx.teachingAssignment.findMany({
          where: { schoolId: actor.schoolId, termId: term.id },
          select: { id: true },
        })
      ).map((a) => a.id);
      await lockAssignmentsInOrder(tx, actor.schoolId, ids);
      const { count } = await tx.lesson.updateMany({
        where: {
          assignmentId: { in: ids },
          status: 'SCHEDULED',
          date: { lt: toDbDate(input.date) },
          weekNumber: { not: null },
          OR: [{ record: { is: null } }, { record: { is: { status: 'DRAFT' } } }],
        },
        data: {
          status: 'WAIVED',
          reason: input.reason,
          decidedById: actor.userId,
          decidedAt: new Date(),
        },
      });
      {
        const cache = newSyncCache();
        for (const id of [...ids].sort()) await syncAssignment(tx, id, { generate: false }, cache);
      }
      await audit(tx, {
        schoolId: actor.schoolId,
        actorId: actor.userId,
        action: 'lessons.waived_before',
        entityType: 'Term',
        entityId: term.id,
        metadata: { date: input.date, waived: count, reason: input.reason },
        requestId: actor.requestId,
      });
      return { waived: count };
    },
    { timeout: 120_000 },
  );
}

export async function rescheduleLesson(
  actor: Actor,
  lessonId: string,
  input: { date: string; startMinute: number; endMinute: number; reason: string },
) {
  const newId = await prisma.$transaction(async (tx) => {
    const lesson = await lessonForDecision(tx, actor, lessonId);
    const assignment = await tx.teachingAssignment.findUniqueOrThrow({
      where: { id: lesson.assignmentId },
      include: { term: true },
    });
    const closed = await closedDates(tx, actor.schoolId);
    const fields: Record<string, string[]> = {};
    if (isWeekend(input.date) || closed.has(input.date)) fields.date = ['Choose a school day'];
    if (
      input.date < fromDbDate(assignment.term.startDate) ||
      input.date > fromDbDate(assignment.term.endDate)
    ) {
      fields.date = ['The new date must fall within the term'];
    }
    if (Object.keys(fields).length)
      throw new AppError('VALIDATION_ERROR', 'Please check the new date', { fields });

    const clash = await tx.lesson.findFirst({
      where: {
        assignmentId: lesson.assignmentId,
        date: toDbDate(input.date),
        status: 'SCHEDULED',
        startMinute: { lt: input.endMinute },
        endMinute: { gt: input.startMinute },
      },
      select: { id: true },
    });
    if (clash)
      throw new AppError(
        'CONFLICT',
        'This class already has a lesson of this subject at that time',
      );

    await tx.lesson.update({
      where: { id: lesson.id },
      data: {
        status: 'RESCHEDULED',
        reason: input.reason,
        decidedById: actor.userId,
        decidedAt: new Date(),
      },
    });
    const created = await tx.lesson.create({
      data: {
        schoolId: actor.schoolId,
        assignmentId: lesson.assignmentId,
        date: toDbDate(input.date),
        startMinute: input.startMinute,
        endMinute: input.endMinute,
        rescheduledFromId: lesson.id,
        decidedById: actor.userId,
        decidedAt: new Date(),
        reason: input.reason,
      },
    });
    await syncAssignment(tx, lesson.assignmentId, { generate: false });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: 'lesson.rescheduled',
      entityType: 'Lesson',
      entityId: lesson.id,
      metadata: { reason: input.reason, newLessonId: created.id, newDate: input.date },
      requestId: actor.requestId,
    });
    return created.id;
  });
  return getLesson(actor.schoolId, newId);
}

// ---------- Absences ----------

async function teacherAssignmentIds(tx: Tx, schoolId: string, teacherProfileId: string) {
  const rows = await tx.teachingAssignment.findMany({
    where: { schoolId, teacherProfileId, pacedPerWeek: { not: null } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function createAbsence(
  actor: Actor,
  input: { teacherProfileId: string; startDate: string; endDate: string; reason: string },
) {
  return prisma.$transaction(async (tx) => {
    const teacher = await tx.teacherProfile.findFirst({
      where: { id: input.teacherProfileId, schoolId: actor.schoolId },
    });
    if (!teacher) throw notFound('Teacher');
    const absence = await tx.absence.create({
      data: {
        schoolId: actor.schoolId,
        teacherProfileId: teacher.id,
        startDate: toDbDate(input.startDate),
        endDate: toDbDate(input.endDate),
        reason: input.reason,
        approvedById: actor.userId,
      },
    });
    const ids = await teacherAssignmentIds(tx, actor.schoolId, teacher.id);
    await lockAssignmentsInOrder(tx, actor.schoolId, ids);
    {
      const cache = newSyncCache();
      for (const id of [...ids].sort()) await syncAssignment(tx, id, { generate: false }, cache);
    }
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: 'absence.approved',
      entityType: 'Absence',
      entityId: absence.id,
      metadata: {
        teacherProfileId: teacher.id,
        startDate: input.startDate,
        endDate: input.endDate,
        reason: input.reason,
      },
      requestId: actor.requestId,
    });
    return absenceDto(absence);
  });
}

export async function revokeAbsence(actor: Actor, absenceId: string) {
  await prisma.$transaction(async (tx) => {
    const absence = await tx.absence.findFirst({
      where: { id: absenceId, schoolId: actor.schoolId, revokedAt: null },
    });
    if (!absence) throw notFound('Absence');
    await tx.absence.update({
      where: { id: absence.id },
      data: { revokedAt: new Date(), revokedById: actor.userId },
    });
    const ids = await teacherAssignmentIds(tx, actor.schoolId, absence.teacherProfileId);
    await lockAssignmentsInOrder(tx, actor.schoolId, ids);
    {
      const cache = newSyncCache();
      for (const id of [...ids].sort()) await syncAssignment(tx, id, { generate: false }, cache);
    }
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: 'absence.revoked',
      entityType: 'Absence',
      entityId: absence.id,
      requestId: actor.requestId,
    });
  });
}

export async function listAbsences(schoolId: string, teacherProfileId?: string) {
  const rows = await prisma.absence.findMany({
    where: { schoolId, ...(teacherProfileId ? { teacherProfileId } : {}) },
    include: { teacherProfile: { select: { id: true, user: { select: { fullName: true } } } } },
    orderBy: [{ startDate: 'desc' }, { id: 'asc' }],
    take: 200,
  });
  return rows.map((a) => ({ ...absenceDto(a), teacherName: a.teacherProfile.user.fullName }));
}

function absenceDto(a: {
  id: string;
  teacherProfileId: string;
  startDate: Date;
  endDate: Date;
  reason: string;
  revokedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: a.id,
    teacherProfileId: a.teacherProfileId,
    startDate: fromDbDate(a.startDate),
    endDate: fromDbDate(a.endDate),
    reason: a.reason,
    revokedAt: a.revokedAt,
    createdAt: a.createdAt,
  };
}
