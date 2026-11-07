// The headmaster's setup checklist: each step the system needs before teachers can record
// lessons, worked out from the school's real data so it is never out of date.
import { prisma } from '../../lib/db.js';
import { addDays, fromDbDate, isoWeekday, toDbDate } from '../../lib/dates.js';
import { schoolNow } from '../lessons/lessons.service.js';

export type SetupStepId =
  | 'term'
  | 'weeks'
  | 'classes'
  | 'scheme'
  | 'teachers'
  | 'subjects'
  | 'timetable'
  | 'publish'
  | 'start';

export interface SetupStep {
  id: SetupStepId;
  done: boolean;
  /** What the school has now, in plain words; shown under the step. */
  detail: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function setupStatus(schoolId: string) {
  const now = await schoolNow(schoolId);
  const term = await prisma.term.findFirst({ where: { schoolId, isCurrent: true } });
  const classes = await prisma.schoolClass.findMany({
    where: { schoolId, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  const teachers = await prisma.user.groupBy({
    by: ['status'],
    where: { schoolId, role: 'TEACHER' },
    _count: { _all: true },
  });
  const teacherCount = (s: string) => teachers.find((t) => t.status === s)?._count._all ?? 0;
  const activeTeachers = teacherCount('ACTIVE');
  const invited = teacherCount('PENDING_ACTIVATION');

  const steps: SetupStep[] = [];
  steps.push({
    id: 'term',
    done: !!term,
    detail: term
      ? `${term.name}: ${fromDbDate(term.startDate)} to ${fromDbDate(term.endDate)}`
      : 'No current term yet',
  });

  const weekCount = term ? await prisma.termWeek.count({ where: { termId: term.id } }) : 0;
  steps.push({
    id: 'weeks',
    done: weekCount > 0,
    detail: weekCount ? plural(weekCount, 'week') + ' set' : 'No week dates yet',
  });

  steps.push({
    id: 'classes',
    done: classes.length > 0,
    detail: classes.length ? classes.map((c) => c.name).join(', ') : 'No classes yet',
  });

  const scheme = term
    ? await prisma.curriculumScheme.findFirst({
        where: { termId: term.id, status: 'PUBLISHED' },
        include: { _count: { select: { entries: true } } },
      })
    : null;
  steps.push({
    id: 'scheme',
    done: !!scheme,
    detail: scheme ? `${plural(scheme._count.entries, 'topic')} live` : 'Not uploaded yet',
  });

  steps.push({
    id: 'teachers',
    done: activeTeachers + invited > 0,
    detail:
      activeTeachers + invited
        ? `${plural(activeTeachers, 'teacher')} signed in` +
          (invited ? `, ${invited} still to accept their invitation` : '')
        : 'No teachers yet',
  });

  const assignments = term
    ? await prisma.teachingAssignment.findMany({
        where: { schoolId, termId: term.id, isActive: true },
        select: {
          id: true,
          classId: true,
          pacedPerWeek: true,
          _count: { select: { timetableEntries: { where: { deletedAt: null } } } },
        },
      })
    : [];
  const classesWithout = classes.filter((c) => !assignments.some((a) => a.classId === c.id));
  steps.push({
    id: 'subjects',
    done: assignments.length > 0 && classesWithout.length === 0,
    detail: assignments.length
      ? `${plural(assignments.length, 'subject')} given to teachers` +
        (classesWithout.length
          ? `; nothing yet for ${classesWithout.map((c) => c.name).join(', ')}`
          : '')
      : 'No subjects given to teachers yet',
  });

  const withSlots = assignments.filter((a) => a._count.timetableEntries > 0);
  const slots = withSlots.reduce((s, a) => s + a._count.timetableEntries, 0);
  const missingSlots = assignments.length - withSlots.length;
  steps.push({
    id: 'timetable',
    done: withSlots.length > 0 && missingSlots === 0,
    detail: slots
      ? `${plural(slots, 'lesson')} a week` +
        (missingSlots ? `; ${plural(missingSlots, 'subject')} not on the timetable yet` : '')
      : 'No timetable yet',
  });

  // Published when every subject on the timetable has lessons for its current weekly count.
  const unpublished = withSlots.filter((a) => a.pacedPerWeek !== a._count.timetableEntries);
  const lessonCount = term
    ? await prisma.lesson.count({ where: { assignment: { termId: term.id } } })
    : 0;
  steps.push({
    id: 'publish',
    done: lessonCount > 0 && unpublished.length === 0,
    detail: !lessonCount
      ? 'Not published yet'
      : unpublished.length
        ? `${plural(unpublished.length, 'subject')} not matched to lessons yet: press "Check all lessons" on the Timetable page`
        : `${plural(lessonCount, 'lesson')} created for the term`,
  });

  // Only matters when the school starts part-way through the term.
  const monday = addDays(now.date, 1 - isoWeekday(now.date));
  const earlier = term
    ? await prisma.lesson.count({
        where: {
          assignment: { termId: term.id },
          status: 'SCHEDULED',
          weekNumber: { not: null },
          date: { lt: toDbDate(monday) },
          OR: [{ record: { is: null } }, { record: { is: { status: 'DRAFT' } } }],
        },
      })
    : 0;
  const midTerm = !!term && fromDbDate(term.startDate) < monday;
  steps.push({
    id: 'start',
    done: !midTerm || (lessonCount > 0 && earlier === 0),
    detail: !midTerm
      ? 'The term starts this week or later: nothing to do'
      : earlier
        ? `${plural(earlier, 'lesson')} before this week ${earlier === 1 ? 'has' : 'have'} no record`
        : lessonCount
          ? 'Teachers record from this week'
          : 'Publish the timetable first',
  });

  return { steps, complete: steps.every((s) => s.done) };
}
