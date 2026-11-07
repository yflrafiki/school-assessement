// The system admin's read-only view of every school. Nothing here changes data.
import type { Prisma, Role, UserStatus } from '../../lib/db.js';
import { prisma } from '../../lib/db.js';
import { notFound } from '../../lib/errors.js';
import { addDays, isoWeekday, localNow, toDbDate } from '../../lib/dates.js';
import { pageArgs, pageMeta } from '../../lib/pagination.js';
import { SESSION_IDLE_MS } from '../../middleware/session.js';
import { setupStatus } from '../schools/setupStatus.js';

const ONLINE_MS = 15 * 60 * 1000;

function today() {
  // Every school so far runs on Africa/Accra time (UTC); per-school figures use their own zone.
  const now = localNow('Africa/Accra');
  return { date: now.date, monday: addDays(now.date, 1 - isoWeekday(now.date)) };
}

/** Lessons from earlier days that still have no submitted record. */
const unrecordedBefore = (date: string): Prisma.LessonWhereInput => ({
  status: 'SCHEDULED',
  weekNumber: { not: null },
  date: { lt: toDbDate(date) },
  OR: [{ record: { is: null } }, { record: { is: { status: 'DRAFT' } } }],
});

const activitySelect = {
  id: true,
  action: true,
  entityType: true,
  entityId: true,
  metadata: true,
  createdAt: true,
  actor: { select: { id: true, fullName: true, role: true } },
  school: { select: { id: true, name: true } },
} satisfies Prisma.AuditLogSelect;

export async function overview() {
  const { date, monday } = today();
  const now = Date.now();
  const [
    schools,
    users,
    signedIn,
    online,
    lessonsToday,
    recordsToday,
    recordsThisWeek,
    overdue,
    emails,
    locked,
    activity,
  ] = await Promise.all([
    prisma.school.count(),
    prisma.user.groupBy({ by: ['role', 'status'], _count: { _all: true } }),
    // People, not tabs: each open tab has its own session.
    prisma.session.groupBy({
      by: ['userId'],
      where: {
        revokedAt: null,
        expiresAt: { gt: new Date(now) },
        lastSeenAt: { gt: new Date(now - SESSION_IDLE_MS) },
      },
    }),
    prisma.session.groupBy({
      by: ['userId'],
      where: {
        revokedAt: null,
        expiresAt: { gt: new Date(now) },
        lastSeenAt: { gt: new Date(now - ONLINE_MS) },
      },
    }),
    prisma.lesson.count({ where: { date: toDbDate(date), status: 'SCHEDULED' } }),
    prisma.teachingRecord.count({
      where: { status: 'SUBMITTED', submittedAt: { gte: toDbDate(date) } },
    }),
    prisma.teachingRecord.count({
      where: { status: 'SUBMITTED', submittedAt: { gte: toDbDate(monday) } },
    }),
    prisma.lesson.count({ where: unrecordedBefore(date) }),
    prisma.emailOutbox.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.user.findMany({
      where: { lockedUntil: { gt: new Date(now) } },
      select: { id: true, fullName: true, email: true, school: { select: { name: true } } },
    }),
    prisma.auditLog.findMany({ select: activitySelect, orderBy: { createdAt: 'desc' }, take: 15 }),
  ]);
  const count = (role?: Role, status?: UserStatus) =>
    users
      .filter((u) => (!role || u.role === role) && (!status || u.status === status))
      .reduce((s, u) => s + u._count._all, 0);
  return {
    date,
    schools,
    people: {
      headmasters: count('HEADMASTER'),
      schoolAdmins: count('SCHOOL_ADMIN'),
      teachers: count('TEACHER', 'ACTIVE'),
      teachersInvited: count('TEACHER', 'PENDING_ACTIVATION'),
      deactivated: count(undefined, 'DEACTIVATED'),
    },
    sessions: { signedIn: signedIn.length, onlineNow: online.length },
    teaching: { lessonsToday, recordsToday, recordsThisWeek, overdue },
    emails: Object.fromEntries(emails.map((e) => [e.status, e._count._all])) as Record<
      string,
      number
    >,
    lockedAccounts: locked.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      school: u.school?.name ?? null,
    })),
    recentActivity: activity,
  };
}

export async function listSchools() {
  const { date, monday } = today();
  const schools = await prisma.school.findMany({ orderBy: { name: 'asc' } });
  return Promise.all(
    schools.map(async (s) => {
      const [people, classes, term, lessonsThisWeek, recordsThisWeek, overdue, last, setup] =
        await Promise.all([
          prisma.user.groupBy({
            by: ['role', 'status'],
            where: { schoolId: s.id },
            _count: { _all: true },
          }),
          prisma.schoolClass.count({ where: { schoolId: s.id, isActive: true } }),
          prisma.term.findFirst({
            where: { schoolId: s.id, isCurrent: true },
            select: { name: true, startDate: true, endDate: true },
          }),
          prisma.lesson.count({
            where: {
              schoolId: s.id,
              status: 'SCHEDULED',
              date: { gte: toDbDate(monday), lte: toDbDate(addDays(monday, 4)) },
            },
          }),
          prisma.teachingRecord.count({
            where: { schoolId: s.id, status: 'SUBMITTED', submittedAt: { gte: toDbDate(monday) } },
          }),
          prisma.lesson.count({ where: { schoolId: s.id, ...unrecordedBefore(date) } }),
          prisma.auditLog.findFirst({
            where: { schoolId: s.id },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
          }),
          setupStatus(s.id),
        ]);
      const n = (role: Role, status?: UserStatus) =>
        people
          .filter((p) => p.role === role && (!status || p.status === status))
          .reduce((t, p) => t + p._count._all, 0);
      return {
        id: s.id,
        name: s.name,
        createdAt: s.createdAt,
        headmasters: n('HEADMASTER'),
        teachers: n('TEACHER', 'ACTIVE'),
        teachersInvited: n('TEACHER', 'PENDING_ACTIVATION'),
        classes,
        term: term?.name ?? null,
        setup: {
          done: setup.steps.filter((x) => x.done).length,
          total: setup.steps.length,
          complete: setup.complete,
        },
        lessonsThisWeek,
        recordsThisWeek,
        overdue,
        lastActivityAt: last?.createdAt ?? null,
      };
    }),
  );
}

export async function getSchool(schoolId: string) {
  const school = await prisma.school.findUnique({ where: { id: schoolId } });
  if (!school) throw notFound('School');
  const now = localNow(school.timezone);
  const [setup, people, behind, records, activity] = await Promise.all([
    setupStatus(school.id),
    prisma.user.findMany({
      where: { schoolId: school.id },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        status: true,
        lastLoginAt: true,
        lockedUntil: true,
        failedLoginCount: true,
      },
      orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
    }),
    prisma.lesson.groupBy({
      by: ['assignmentId'],
      where: { schoolId: school.id, ...unrecordedBefore(now.date) },
      _count: { _all: true },
    }),
    prisma.teachingRecord.findMany({
      where: { schoolId: school.id, status: 'SUBMITTED' },
      orderBy: { submittedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        weekNumber: true,
        submittedAt: true,
        isLate: true,
        taughtSummary: true,
        teacherProfile: { select: { user: { select: { fullName: true } } } },
        assignment: {
          select: { subject: { select: { name: true } }, schoolClass: { select: { name: true } } },
        },
      },
    }),
    prisma.auditLog.findMany({
      where: { schoolId: school.id },
      select: activitySelect,
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
  ]);

  // Overdue lessons per teacher, most behind first.
  const assignments = await prisma.teachingAssignment.findMany({
    where: { id: { in: behind.map((b) => b.assignmentId) } },
    select: { id: true, teacherProfile: { select: { user: { select: { fullName: true } } } } },
  });
  const perTeacher = new Map<string, number>();
  for (const b of behind) {
    const name = assignments.find((a) => a.id === b.assignmentId)?.teacherProfile.user.fullName;
    if (name) perTeacher.set(name, (perTeacher.get(name) ?? 0) + b._count._all);
  }

  return {
    school: {
      id: school.id,
      name: school.name,
      timezone: school.timezone,
      createdAt: school.createdAt,
    },
    setup,
    people: people.map((p) => ({
      ...p,
      locked: !!p.lockedUntil && p.lockedUntil.getTime() > Date.now(),
    })),
    teachersBehind: [...perTeacher]
      .map(([fullName, overdueLessons]) => ({ fullName, overdueLessons }))
      .sort((a, b) => b.overdueLessons - a.overdueLessons),
    recentRecords: records.map((r) => ({
      id: r.id,
      teacher: r.teacherProfile.user.fullName,
      subject: r.assignment.subject.name,
      className: r.assignment.schoolClass.name,
      weekNumber: r.weekNumber,
      submittedAt: r.submittedAt,
      isLate: r.isLate,
      summary: r.taughtSummary,
    })),
    recentActivity: activity,
  };
}

export async function listUsers(q: {
  page: number;
  pageSize: number;
  search?: string | undefined;
  role?: Role | undefined;
  status?: UserStatus | undefined;
  schoolId?: string | undefined;
}) {
  const where: Prisma.UserWhereInput = {
    ...(q.role ? { role: q.role } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.schoolId ? { schoolId: q.schoolId } : {}),
    ...(q.search
      ? {
          OR: [
            { fullName: { contains: q.search, mode: 'insensitive' } },
            { email: { contains: q.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        status: true,
        lastLoginAt: true,
        lockedUntil: true,
        failedLoginCount: true,
        createdAt: true,
        school: { select: { id: true, name: true } },
      },
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
      ...pageArgs(q.page, q.pageSize),
    }),
    prisma.user.count({ where }),
  ]);
  return {
    data: rows.map((u) => ({
      ...u,
      locked: !!u.lockedUntil && u.lockedUntil.getTime() > Date.now(),
    })),
    meta: pageMeta(q.page, q.pageSize, total),
  };
}

export async function listActivity(q: {
  page: number;
  pageSize: number;
  schoolId?: string | undefined;
  action?: string | undefined;
}) {
  const where: Prisma.AuditLogWhereInput = {
    ...(q.schoolId ? { schoolId: q.schoolId } : {}),
    ...(q.action ? { action: { startsWith: q.action } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      select: activitySelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...pageArgs(q.page, q.pageSize),
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { data: rows, meta: pageMeta(q.page, q.pageSize, total) };
}
