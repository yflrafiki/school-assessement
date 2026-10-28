import { Router } from 'express';
import { z } from 'zod';
import { LEVELS, isoDate, paginationQuery, uuid } from '@school/shared';
import { prisma } from '../../lib/db.js';
import { auth, query, teacherAuth } from '../../lib/http.js';
import { addDays, fromDbDate, toDbDate, zonedMidnightUtc } from '../../lib/dates.js';
import { pageArgs, pageMeta } from '../../lib/pagination.js';
import { requirePermission, requireRole } from '../../middleware/requireRole.js';
import { dailyBoard, listLessons, schoolNow } from '../lessons/lessons.service.js';
import {
  schoolTeacherProgress,
  teacherProgress,
  weeklyCompletion,
} from '../progress/progress.service.js';

export const reportsRouter = Router();

reportsRouter.get('/dashboard/teacher', requireRole('TEACHER'), async (req, res) => {
  const a = teacherAuth(req);
  const now = await schoolNow(a.schoolId);
  const [today, progress, unread, overdue] = await Promise.all([
    listLessons(
      a.schoolId,
      { date: now.date, page: 1, pageSize: 100 },
      { teacherProfileId: a.teacherProfileId },
    ),
    teacherProgress(a.schoolId, a.teacherProfileId),
    prisma.notification.count({ where: { recipientId: a.userId, readAt: null } }),
    listLessons(
      a.schoolId,
      { state: 'OVERDUE', page: 1, pageSize: 20 },
      { teacherProfileId: a.teacherProfileId },
    ),
  ]);
  res.json({
    data: {
      date: now.date,
      todayLessons: today.data,
      overdueLessons: overdue.data,
      overdueTotal: overdue.meta.total,
      unreadNotifications: unread,
      assignments: progress.assignments.map((p) => ({ ...p, weeks: undefined })),
    },
  });
});

reportsRouter.get('/dashboard/headmaster', requirePermission('reports.view'), async (req, res) => {
  const a = auth(req);
  const now = await schoolNow(a.schoolId);
  const school = await prisma.school.findUniqueOrThrow({
    where: { id: a.schoolId },
    select: { timezone: true },
  });
  const dayStart = zonedMidnightUtc(now.date, school.timezone);
  const dayEnd = zonedMidnightUtc(addDays(now.date, 1), school.timezone);
  const [board, teacherCounts, submittedToday, teachers, completion, term] = await Promise.all([
    dailyBoard(a.schoolId, now.date),
    prisma.user.groupBy({
      by: ['status'],
      where: { schoolId: a.schoolId, role: 'TEACHER' },
      _count: { _all: true },
    }),
    // Activity, counted by submission time in the school's timezone.
    prisma.teachingRecord.count({
      where: {
        schoolId: a.schoolId,
        status: 'SUBMITTED',
        submittedAt: { gte: dayStart, lt: dayEnd },
      },
    }),
    schoolTeacherProgress(a.schoolId),
    weeklyCompletion(a.schoolId),
    prisma.term.findFirst({
      where: { schoolId: a.schoolId, isCurrent: true },
      include: { weeks: true },
    }),
  ]);
  const currentTermWeek =
    term?.weeks.find(
      (w) => fromDbDate(w.startDate) <= now.date && now.date <= fromDbDate(w.endDate),
    )?.weekNumber ?? null;
  res.json({
    data: {
      date: now.date,
      term: term ? { id: term.id, name: term.name, currentWeek: currentTermWeek } : null,
      teachers: Object.fromEntries(teacherCounts.map((t) => [t.status, t._count._all])),
      today: { counts: board.counts, total: board.lessons.length, isClosed: board.isClosed },
      activity: { recordsSubmittedToday: submittedToday },
      upToDate: teachers.filter((t) => t.upToDate).length,
      behind: teachers
        .filter((t) => !t.upToDate)
        .slice(0, 10)
        .map((t) => ({
          teacher: t.teacher,
          overdueLessons: t.overdueLessons,
          oldestOverdue: t.oldestOverdue,
        })),
      weeklyCompletion: completion.weeks,
    },
  });
});

const weeklyQuery = z.object({
  termId: uuid.optional(),
  level: z.enum(LEVELS).optional(),
  subjectId: uuid.optional(),
  classId: uuid.optional(),
});

reportsRouter.get(
  '/reports/weekly-progress',
  requirePermission('reports.view'),
  async (req, res) => {
    const a = auth(req);
    const q = query(req, weeklyQuery);
    const filters = {
      ...(q.subjectId ? { subjectId: q.subjectId } : {}),
      ...(q.classId ? { classId: q.classId } : {}),
      ...(q.level ? { schoolClass: { level: q.level } } : {}),
    };
    const [completion, teachers] = await Promise.all([
      weeklyCompletion(a.schoolId, q.termId, filters),
      schoolTeacherProgress(a.schoolId, q.termId),
    ]);
    res.json({ data: { ...completion, teachers } });
  },
);

const activityQuery = paginationQuery.extend({
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  teacherProfileId: uuid.optional(),
});

/** Records submitted per teacher in a date range: activity, not completion. */
reportsRouter.get(
  '/reports/teaching-activity',
  requirePermission('reports.view'),
  async (req, res) => {
    const a = auth(req);
    const q = query(req, activityQuery);
    const now = await schoolNow(a.schoolId);
    const dateTo = q.dateTo ?? now.date;
    const dateFrom = q.dateFrom ?? fromDbDate(new Date(toDbDate(dateTo).getTime() - 6 * 86400000));
    const where = {
      schoolId: a.schoolId,
      status: 'SUBMITTED' as const,
      lesson: { date: { gte: toDbDate(dateFrom), lte: toDbDate(dateTo) } },
      ...(q.teacherProfileId ? { teacherProfileId: q.teacherProfileId } : {}),
    };
    const grouped = await prisma.teachingRecord.groupBy({
      by: ['teacherProfileId', 'isLate'],
      where,
      _count: { _all: true },
    });
    const ids = [...new Set(grouped.map((g) => g.teacherProfileId))];
    const profiles = await prisma.teacherProfile.findMany({
      where: { id: { in: ids } },
      select: { id: true, staffId: true, user: { select: { fullName: true } } },
      orderBy: [{ user: { fullName: 'asc' } }, { id: 'asc' }],
      ...pageArgs(q.page, q.pageSize),
    });
    res.json({
      data: {
        dateFrom,
        dateTo,
        rows: profiles.map((p) => {
          const onTime =
            grouped.find((g) => g.teacherProfileId === p.id && !g.isLate)?._count._all ?? 0;
          const late =
            grouped.find((g) => g.teacherProfileId === p.id && g.isLate)?._count._all ?? 0;
          return {
            teacher: { id: p.id, staffId: p.staffId, fullName: p.user.fullName },
            submitted: onTime + late,
            onTime,
            late,
          };
        }),
      },
      meta: pageMeta(q.page, q.pageSize, ids.length),
    });
  },
);

const auditQuery = paginationQuery.extend({ action: z.string().max(60).optional() });

reportsRouter.get('/audit', requirePermission('reports.view'), async (req, res) => {
  const a = auth(req);
  const q = query(req, auditQuery);
  const where = { schoolId: a.schoolId, ...(q.action ? { action: { startsWith: q.action } } : {}) };
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { actor: { select: { fullName: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...pageArgs(q.page, q.pageSize),
    }),
    prisma.auditLog.count({ where }),
  ]);
  res.json({
    data: rows.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      actorName: r.actor?.fullName ?? 'System',
      metadata: r.metadata,
      createdAt: r.createdAt,
    })),
    meta: pageMeta(q.page, q.pageSize, total),
  });
});
