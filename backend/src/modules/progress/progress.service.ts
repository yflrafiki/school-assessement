// Weekly completion is computed from lessons and records; nothing here is stored.
import { REQUIRED_WEEK_KINDS, type LessonState, type WeekKind } from '@school/shared';
import { prisma, type Prisma } from '../../lib/db.js';
import { notFound } from '../../lib/errors.js';
import { fromDbDate } from '../../lib/dates.js';
import { closedDates, schoolNow } from '../lessons/lessons.service.js';
import { lessonState } from '../lessons/lessonState.js';
import { isWeekComplete } from '../lessons/pacing.js';
import { loadTermCalendar, type TermCalendar } from '../lessons/weekKinds.js';

export interface WeekStatus {
  weekNumber: number;
  kind: WeekKind;
  required: boolean;
  lessonsPaced: number;
  completed: number;
  waived: number;
  outstanding: number;
  overdue: number;
  complete: boolean;
  unlocked: boolean;
  /** Why the week is locked, in plain words, when it is. */
  lockedReason: string | null;
}

export interface AssignmentProgress {
  assignmentId: string;
  subject: { id: string; name: string };
  schoolClass: { id: string; name: string; level: string };
  teacher: { id: string; fullName: string };
  perWeek: number;
  published: boolean;
  weeks: WeekStatus[];
  completedWeeks: number;
  requiredWeeks: number;
  /** Earliest required week that is not complete; null when all are complete. */
  currentWeek: number | null;
  overdueLessons: number;
  oldestOverdue: string | null;
  upToDate: boolean;
  lessonsBeyondScheme: number;
}

const assignmentInclude = {
  subject: { select: { id: true, name: true } },
  schoolClass: { select: { id: true, name: true, level: true } },
  teacherProfile: { select: { id: true, user: { select: { fullName: true } } } },
  _count: { select: { timetableEntries: { where: { deletedAt: null } } } },
  lessons: {
    select: {
      id: true,
      date: true,
      startMinute: true,
      status: true,
      weekNumber: true,
      record: { select: { status: true } },
    },
  },
} satisfies Prisma.TeachingAssignmentInclude;

type AssignmentRow = Prisma.TeachingAssignmentGetPayload<{ include: typeof assignmentInclude }>;

function computeProgress(
  a: AssignmentRow,
  calendar: TermCalendar,
  now: { date: string; minutes: number },
  closed: ReadonlySet<string>,
): AssignmentProgress {
  const perWeek = a.pacedPerWeek ?? a._count.timetableEntries;
  const lessons = a.lessons.map((l) => {
    const date = fromDbDate(l.date);
    const hasSubmittedRecord = l.record?.status === 'SUBMITTED';
    return {
      date,
      status: l.status,
      weekNumber: l.weekNumber,
      hasSubmittedRecord,
      state: lessonState(
        {
          date,
          startMinute: l.startMinute,
          status: l.status,
          hasSubmittedRecord,
          weekNumber: l.weekNumber,
        },
        now,
        closed,
      ),
    };
  });

  const weeks: WeekStatus[] = [];
  let blockedBy: number | null = null;
  for (const [weekNumber, kind] of [...calendar.kinds.entries()].sort((x, y) => x[0] - y[0])) {
    const required = REQUIRED_WEEK_KINDS.includes(kind);
    const inWeek = lessons.filter(
      (l) => l.weekNumber === weekNumber && (l.status === 'SCHEDULED' || l.status === 'WAIVED'),
    );
    const completed = inWeek.filter((l) => l.hasSubmittedRecord).length;
    const waived = inWeek.filter((l) => l.status === 'WAIVED').length;
    const complete = required ? isWeekComplete(weekNumber, lessons, perWeek) : true;
    weeks.push({
      weekNumber,
      kind,
      required,
      lessonsPaced: inWeek.length,
      completed,
      waived,
      outstanding: required ? Math.max(0, perWeek - completed - waived) : 0,
      overdue: inWeek.filter((l) => l.state === 'OVERDUE').length,
      complete,
      unlocked: blockedBy === null,
      lockedReason:
        blockedBy === null
          ? null
          : `Week ${blockedBy} is not complete. Record its outstanding lessons or ask the headmaster for an exception.`,
    });
    if (required && !complete && blockedBy === null) blockedBy = weekNumber;
  }

  const overdue = lessons
    .filter((l) => l.state === 'OVERDUE')
    .sort((x, y) => (x.date < y.date ? -1 : 1));
  const requiredWeeks = weeks.filter((w) => w.required);
  const currentWeek = requiredWeeks.find((w) => !w.complete)?.weekNumber ?? null;
  // An earlier week is incomplete only when it is already in the past.
  const pastIncomplete = requiredWeeks.some((w) => {
    if (w.complete) return false;
    const tw = calendar.termWeeks.find((t) => t.weekNumber === w.weekNumber);
    return tw ? tw.endDate < now.date : false;
  });

  return {
    assignmentId: a.id,
    subject: a.subject,
    schoolClass: a.schoolClass,
    teacher: { id: a.teacherProfile.id, fullName: a.teacherProfile.user.fullName },
    perWeek,
    published: a.pacedPerWeek !== null,
    weeks,
    completedWeeks: requiredWeeks.filter((w) => w.complete).length,
    requiredWeeks: requiredWeeks.length,
    currentWeek,
    overdueLessons: overdue.length,
    oldestOverdue: overdue[0]?.date ?? null,
    upToDate: overdue.length === 0 && !pastIncomplete,
    lessonsBeyondScheme: lessons.filter((l) => l.weekNumber === null && l.status === 'SCHEDULED')
      .length,
  };
}

/** Loads and computes progress for many assignments with one query per kind of data. */
export async function progressFor(schoolId: string, where: Prisma.TeachingAssignmentWhereInput) {
  const [assignments, now, closed] = await Promise.all([
    prisma.teachingAssignment.findMany({
      where: { schoolId, isActive: true, ...where },
      include: assignmentInclude,
      orderBy: [{ schoolClass: { name: 'asc' } }, { subject: { sortOrder: 'asc' } }, { id: 'asc' }],
    }),
    schoolNow(schoolId),
    closedDates(prisma, schoolId),
  ]);
  const calendars = new Map<string, TermCalendar>();
  const out: AssignmentProgress[] = [];
  for (const a of assignments) {
    const key = `${a.termId}|${a.classId}`;
    let calendar = calendars.get(key);
    if (!calendar) {
      calendar = await loadTermCalendar(prisma, schoolId, a.termId, a.classId, a.schoolClass.level);
      calendars.set(key, calendar);
    }
    out.push(computeProgress(a, calendar, now, closed));
  }
  return out;
}

async function currentTermId(schoolId: string) {
  const term = await prisma.term.findFirst({
    where: { schoolId, isCurrent: true },
    select: { id: true },
  });
  return term?.id ?? null;
}

export async function teacherProgress(schoolId: string, teacherProfileId: string, termId?: string) {
  const teacher = await prisma.teacherProfile.findFirst({
    where: { id: teacherProfileId, schoolId },
    select: { id: true },
  });
  if (!teacher) throw notFound('Teacher');
  const term = termId ?? (await currentTermId(schoolId));
  if (!term) return { termId: null, assignments: [] };
  return {
    termId: term,
    assignments: await progressFor(schoolId, { teacherProfileId, termId: term }),
  };
}

export async function assignmentWeekStatus(
  schoolId: string,
  assignmentId: string,
  weekNumber: number,
) {
  const [p] = await progressFor(schoolId, { id: assignmentId });
  return p?.weeks.find((w) => w.weekNumber === weekNumber) ?? null;
}

/** Lessons of one curriculum week for each of a teacher's assignments (Weekly Scheme of Work). */
export async function teacherWeek(schoolId: string, teacherProfileId: string, weekNumber: number) {
  const termId = await currentTermId(schoolId);
  if (!termId) return { weekNumber, assignments: [] };
  const [progress, lessons, now, closed] = await Promise.all([
    progressFor(schoolId, { teacherProfileId, termId }),
    prisma.lesson.findMany({
      where: { schoolId, weekNumber, assignment: { teacherProfileId, termId } },
      include: { record: { select: { id: true, status: true } } },
      orderBy: [{ date: 'asc' }, { startMinute: 'asc' }],
    }),
    schoolNow(schoolId),
    closedDates(prisma, schoolId),
  ]);
  return {
    weekNumber,
    assignments: progress.map((p) => ({
      ...p,
      week: p.weeks.find((w) => w.weekNumber === weekNumber) ?? null,
      weeks: undefined,
      lessons: lessons
        .filter((l) => l.assignmentId === p.assignmentId)
        .map((l) => {
          const date = fromDbDate(l.date);
          const state: LessonState = lessonState(
            {
              date,
              startMinute: l.startMinute,
              status: l.status,
              hasSubmittedRecord: l.record?.status === 'SUBMITTED',
              weekNumber: l.weekNumber,
            },
            now,
            closed,
          );
          return {
            id: l.id,
            date,
            startMinute: l.startMinute,
            endMinute: l.endMinute,
            status: l.status,
            state,
            record: l.record,
          };
        }),
    })),
  };
}

/** Per-teacher summary for the headmaster. Up to date: no overdue lesson and no past incomplete week. */
export async function schoolTeacherProgress(schoolId: string, termId?: string) {
  const term = termId ?? (await currentTermId(schoolId));
  if (!term) return [];
  const progress = await progressFor(schoolId, { termId: term });
  const byTeacher = new Map<
    string,
    { teacher: AssignmentProgress['teacher']; assignments: AssignmentProgress[] }
  >();
  for (const p of progress) {
    const entry = byTeacher.get(p.teacher.id) ?? { teacher: p.teacher, assignments: [] };
    entry.assignments.push(p);
    byTeacher.set(p.teacher.id, entry);
  }
  return [...byTeacher.values()]
    .map(({ teacher, assignments }) => {
      const overdue = assignments.reduce((s, a) => s + a.overdueLessons, 0);
      const oldest =
        assignments
          .map((a) => a.oldestOverdue)
          .filter((d): d is string => !!d)
          .sort()[0] ?? null;
      return {
        teacher,
        assignments: assignments.map((a) => ({
          assignmentId: a.assignmentId,
          subject: a.subject,
          schoolClass: a.schoolClass,
          completedWeeks: a.completedWeeks,
          requiredWeeks: a.requiredWeeks,
          currentWeek: a.currentWeek,
          overdueLessons: a.overdueLessons,
          upToDate: a.upToDate,
        })),
        overdueLessons: overdue,
        oldestOverdue: oldest,
        upToDate: assignments.every((a) => a.upToDate),
      };
    })
    .sort(
      (x, y) =>
        y.overdueLessons - x.overdueLessons || x.teacher.fullName.localeCompare(y.teacher.fullName),
    );
}

/**
 * Weekly completion rate for week w: assignments with week w complete divided by
 * assignments that have lessons paced to w. Never a count of records.
 */
export async function weeklyCompletion(
  schoolId: string,
  termId?: string,
  filters: Prisma.TeachingAssignmentWhereInput = {},
) {
  const term = termId ?? (await currentTermId(schoolId));
  if (!term) return { termId: null, weeks: [] };
  const progress = await progressFor(schoolId, { termId: term, ...filters });
  const numbers = new Set<number>();
  for (const p of progress) for (const w of p.weeks) if (w.required) numbers.add(w.weekNumber);
  const weeks = [...numbers]
    .sort((a, b) => a - b)
    .map((weekNumber) => {
      const withLessons = progress.filter((p) =>
        p.weeks.some((w) => w.weekNumber === weekNumber && w.required && w.lessonsPaced > 0),
      );
      const complete = withLessons.filter(
        (p) => p.weeks.find((w) => w.weekNumber === weekNumber)?.complete,
      );
      return {
        weekNumber,
        assignmentsWithLessons: withLessons.length,
        assignmentsComplete: complete.length,
        rate: withLessons.length ? complete.length / withLessons.length : null,
      };
    });
  return { termId: term, weeks };
}
