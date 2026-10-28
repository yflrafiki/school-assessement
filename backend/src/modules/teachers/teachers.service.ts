import type {
  CreateTeacherBody,
  InvitationStatus,
  ListTeachersQuery,
  UpdateTeacherBody,
} from '@school/shared';
import { prisma, type Prisma } from '../../lib/db.js';
import { conflict, isUniqueViolation, notFound, validation } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { fromDbDate, toDbDate } from '../../lib/dates.js';
import { pageArgs, pageMeta } from '../../lib/pagination.js';
import { issueInvitation, issuePasswordReset, revokeAllSessions } from '../auth/auth.service.js';
import { createAssignments, listAssignments } from '../assignments/assignments.service.js';
import { closedDates, lastSchoolDayOnOrBefore, schoolNow } from '../lessons/lessons.service.js';

interface Actor {
  schoolId: string;
  userId: string;
  requestId: string;
}

const teacherInclude = {
  user: {
    select: {
      id: true,
      email: true,
      fullName: true,
      status: true,
      passwordHash: true,
      lastLoginAt: true,
      createdAt: true,
      authTokens: {
        where: { type: 'INVITATION' as const },
        orderBy: { createdAt: 'desc' as const },
        take: 1,
        select: { expiresAt: true, consumedAt: true, revokedAt: true, createdAt: true },
      },
    },
  },
  assignments: {
    where: { isActive: true, term: { isCurrent: true } },
    select: {
      id: true,
      subject: { select: { id: true, name: true } },
      schoolClass: { select: { id: true, name: true, level: true } },
    },
  },
} satisfies Prisma.TeacherProfileInclude;

type TeacherRow = Prisma.TeacherProfileGetPayload<{ include: typeof teacherInclude }>;

function invitationStatus(t: TeacherRow): InvitationStatus {
  if (t.user.passwordHash) return 'ACCEPTED';
  const inv = t.user.authTokens[0];
  if (!inv) return 'NONE';
  if (!inv.consumedAt && !inv.revokedAt && inv.expiresAt.getTime() > Date.now()) return 'PENDING';
  return 'EXPIRED';
}

/** Overdue lessons per teacher: scheduled, paced, no submitted record, dated before the last school day. */
async function overdueSummary(schoolId: string, teacherProfileIds: string[]) {
  if (!teacherProfileIds.length) return new Map<string, { count: number; oldest: string }>();
  const where = await overdueLessonWhere(schoolId);
  const rows = await prisma.lesson.groupBy({
    by: ['assignmentId'],
    where: { ...where, assignment: { teacherProfileId: { in: teacherProfileIds } } },
    _count: { _all: true },
    _min: { date: true },
  });
  const assignments = await prisma.teachingAssignment.findMany({
    where: { id: { in: rows.map((r) => r.assignmentId) } },
    select: { id: true, teacherProfileId: true },
  });
  const owner = new Map(assignments.map((a) => [a.id, a.teacherProfileId]));
  const out = new Map<string, { count: number; oldest: string }>();
  for (const r of rows) {
    const tp = owner.get(r.assignmentId);
    if (!tp || !r._min.date) continue;
    const prev = out.get(tp);
    const oldest = fromDbDate(r._min.date);
    out.set(tp, {
      count: (prev?.count ?? 0) + r._count._all,
      oldest: prev && prev.oldest < oldest ? prev.oldest : oldest,
    });
  }
  return out;
}

export async function overdueLessonWhere(schoolId: string): Promise<Prisma.LessonWhereInput> {
  const [now, closed] = await Promise.all([schoolNow(schoolId), closedDates(prisma, schoolId)]);
  const before = lastSchoolDayOnOrBefore(now.date, closed);
  return {
    schoolId,
    status: 'SCHEDULED',
    weekNumber: { not: null },
    date: { lt: toDbDate(before) },
    assignment: { isActive: true, term: { isCurrent: true } },
    OR: [{ record: { is: null } }, { record: { is: { status: 'DRAFT' } } }],
  };
}

function toListDto(t: TeacherRow, overdue: { count: number; oldest: string } | undefined) {
  return {
    id: t.id,
    userId: t.user.id,
    fullName: t.user.fullName,
    email: t.user.email,
    staffId: t.staffId,
    phone: t.phone,
    status: t.user.status,
    invitationStatus: invitationStatus(t),
    lastLoginAt: t.user.lastLoginAt,
    createdAt: t.user.createdAt,
    assignments: t.assignments,
    overdueLessons: overdue?.count ?? 0,
    oldestOverdueDate: overdue?.oldest ?? null,
    progress: overdue?.count ? ('BEHIND' as const) : ('UP_TO_DATE' as const),
  };
}

export async function listTeachers(schoolId: string, q: ListTeachersQuery) {
  const now = new Date();
  const and: Prisma.TeacherProfileWhereInput[] = [];
  if (q.q) {
    const term = q.q;
    and.push({
      OR: [
        { user: { fullName: { contains: term, mode: 'insensitive' } } },
        { user: { email: { contains: term, mode: 'insensitive' } } },
        { staffId: { contains: term, mode: 'insensitive' } },
        {
          assignments: {
            some: {
              term: { isCurrent: true },
              subject: { name: { contains: term, mode: 'insensitive' } },
            },
          },
        },
      ],
    });
  }
  const assignmentFilter: Prisma.TeachingAssignmentWhereInput = {
    isActive: true,
    term: { isCurrent: true },
    ...(q.subjectId ? { subjectId: q.subjectId } : {}),
    ...(q.classId ? { classId: q.classId } : {}),
    ...(q.level ? { schoolClass: { level: q.level } } : {}),
  };
  if (q.subjectId || q.classId || q.level) and.push({ assignments: { some: assignmentFilter } });
  if (q.status) and.push({ user: { status: q.status } });

  if (q.invitationStatus) {
    const activeInvite = {
      type: 'INVITATION' as const,
      consumedAt: null,
      revokedAt: null,
      expiresAt: { gt: now },
    };
    switch (q.invitationStatus) {
      case 'ACCEPTED':
        and.push({ user: { passwordHash: { not: null } } });
        break;
      case 'PENDING':
        and.push({ user: { passwordHash: null, authTokens: { some: activeInvite } } });
        break;
      case 'EXPIRED':
        and.push({
          user: {
            passwordHash: null,
            authTokens: { some: { type: 'INVITATION' }, none: activeInvite },
          },
        });
        break;
      case 'NONE':
        and.push({ user: { passwordHash: null, authTokens: { none: { type: 'INVITATION' } } } });
        break;
    }
  }

  if (q.progress) {
    const overdue = await overdueLessonWhere(schoolId);
    const behind: Prisma.TeacherProfileWhereInput = {
      assignments: { some: { lessons: { some: overdue } } },
    };
    and.push(q.progress === 'BEHIND' ? behind : { NOT: behind });
  }

  const where: Prisma.TeacherProfileWhereInput = { schoolId, AND: and };
  const orderBy: Prisma.TeacherProfileOrderByWithRelationInput[] =
    q.sort === 'name' || q.sort === '-name'
      ? [{ user: { fullName: q.sort === 'name' ? 'asc' : 'desc' } }, { id: 'asc' }]
      : [{ createdAt: q.sort === 'createdAt' ? 'asc' : 'desc' }, { id: 'asc' }];

  const [rows, total] = await Promise.all([
    prisma.teacherProfile.findMany({
      where,
      include: teacherInclude,
      orderBy,
      ...pageArgs(q.page, q.pageSize),
    }),
    prisma.teacherProfile.count({ where }),
  ]);
  const overdue = await overdueSummary(
    schoolId,
    rows.map((r) => r.id),
  );
  return {
    data: rows.map((r) => toListDto(r, overdue.get(r.id))),
    meta: pageMeta(q.page, q.pageSize, total),
  };
}

async function findTeacher(schoolId: string, teacherProfileId: string) {
  const t = await prisma.teacherProfile.findFirst({
    where: { id: teacherProfileId, schoolId },
    include: teacherInclude,
  });
  if (!t) throw notFound('Teacher');
  return t;
}

export async function getTeacher(schoolId: string, teacherProfileId: string) {
  const t = await findTeacher(schoolId, teacherProfileId);
  const [overdue, assignments, absences] = await Promise.all([
    overdueSummary(schoolId, [t.id]),
    listAssignments(schoolId, { teacherProfileId: t.id }),
    prisma.absence.findMany({
      where: { schoolId, teacherProfileId: t.id },
      orderBy: { startDate: 'desc' },
      take: 50,
    }),
  ]);
  return {
    ...toListDto(t, overdue.get(t.id)),
    allAssignments: assignments,
    absences: absences.map((a) => ({
      id: a.id,
      startDate: fromDbDate(a.startDate),
      endDate: fromDbDate(a.endDate),
      reason: a.reason,
      revokedAt: a.revokedAt,
    })),
  };
}

function translateUnique(err: unknown): never {
  if (isUniqueViolation(err, 'email'))
    throw validation({ email: ['Another account already uses this email'] });
  if (isUniqueViolation(err, 'staff_id') || isUniqueViolation(err, 'staffId')) {
    throw validation({ staffId: ['Another teacher in this school already has this staff ID'] });
  }
  throw err;
}

export async function createTeacher(actor: Actor, input: CreateTeacherBody) {
  const termId =
    input.termId ??
    (await prisma.term.findFirst({ where: { schoolId: actor.schoolId, isCurrent: true } }))?.id;
  if (input.assignments.length && !termId) {
    throw validation({ termId: ['Create a term (and mark it current) before assigning subjects'] });
  }

  const [emailTaken, staffTaken] = await Promise.all([
    prisma.user.findUnique({ where: { email: input.email }, select: { id: true } }),
    prisma.teacherProfile.findFirst({
      where: { schoolId: actor.schoolId, staffId: input.staffId },
      select: { id: true },
    }),
  ]);
  const fields: Record<string, string[]> = {};
  if (emailTaken) fields.email = ['Another account already uses this email'];
  if (staffTaken) fields.staffId = ['Another teacher in this school already has this staff ID'];
  if (Object.keys(fields).length) throw validation(fields);

  try {
    const id = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          schoolId: actor.schoolId,
          email: input.email,
          fullName: input.fullName,
          role: 'TEACHER',
          status: 'PENDING_ACTIVATION',
        },
      });
      const profile = await tx.teacherProfile.create({
        data: {
          schoolId: actor.schoolId,
          userId: user.id,
          staffId: input.staffId,
          phone: input.phone ?? null,
        },
      });
      if (termId) await createAssignments(tx, actor, profile.id, termId, input.assignments);
      await issueInvitation(tx, user.id, actor.userId);
      await audit(tx, {
        schoolId: actor.schoolId,
        actorId: actor.userId,
        action: 'teacher.created',
        entityType: 'User',
        entityId: user.id,
        metadata: {
          teacherProfileId: profile.id,
          staffId: input.staffId,
          assignments: input.assignments.length,
        },
        requestId: actor.requestId,
      });
      return profile.id;
    });
    return getTeacher(actor.schoolId, id);
  } catch (err) {
    translateUnique(err);
  }
}

export async function updateTeacher(
  actor: Actor,
  teacherProfileId: string,
  input: UpdateTeacherBody,
) {
  const t = await findTeacher(actor.schoolId, teacherProfileId);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: t.user.id },
        data: {
          ...(input.fullName ? { fullName: input.fullName } : {}),
          ...(input.email ? { email: input.email } : {}),
        },
      });
      await tx.teacherProfile.update({
        where: { id: t.id },
        data: {
          ...(input.staffId ? { staffId: input.staffId } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
        },
      });
      // A pending teacher's invitation goes to the new address.
      if (input.email && input.email !== t.user.email && t.user.status === 'PENDING_ACTIVATION') {
        await issueInvitation(tx, t.user.id, actor.userId);
      }
      await audit(tx, {
        schoolId: actor.schoolId,
        actorId: actor.userId,
        action: 'teacher.updated',
        entityType: 'User',
        entityId: t.user.id,
        metadata: { changed: Object.keys(input) },
        requestId: actor.requestId,
      });
    });
  } catch (err) {
    translateUnique(err);
  }
  return getTeacher(actor.schoolId, teacherProfileId);
}

export async function deactivateTeacher(actor: Actor, teacherProfileId: string) {
  const t = await findTeacher(actor.schoolId, teacherProfileId);
  if (t.user.id === actor.userId) throw conflict('You cannot deactivate your own account');
  if (t.user.status === 'DEACTIVATED') throw conflict('This teacher is already deactivated');
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: t.user.id }, data: { status: 'DEACTIVATED' } });
    await revokeAllSessions(tx, t.user.id);
    await tx.authToken.updateMany({
      where: { userId: t.user.id, consumedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: 'teacher.deactivated',
      entityType: 'User',
      entityId: t.user.id,
      requestId: actor.requestId,
    });
  });
  return getTeacher(actor.schoolId, teacherProfileId);
}

export async function reactivateTeacher(actor: Actor, teacherProfileId: string) {
  const t = await findTeacher(actor.schoolId, teacherProfileId);
  if (t.user.status !== 'DEACTIVATED') throw conflict('This teacher is not deactivated');
  await prisma.$transaction(async (tx) => {
    const status = t.user.passwordHash ? 'ACTIVE' : 'PENDING_ACTIVATION';
    await tx.user.update({
      where: { id: t.user.id },
      data: { status, failedLoginCount: 0, lockedUntil: null },
    });
    if (status === 'PENDING_ACTIVATION') await issueInvitation(tx, t.user.id, actor.userId);
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: 'teacher.reactivated',
      entityType: 'User',
      entityId: t.user.id,
      metadata: { status },
      requestId: actor.requestId,
    });
  });
  return getTeacher(actor.schoolId, teacherProfileId);
}

export async function resendInvitation(actor: Actor, teacherProfileId: string) {
  const t = await findTeacher(actor.schoolId, teacherProfileId);
  if (t.user.status !== 'PENDING_ACTIVATION') {
    throw conflict('Only teachers who have not activated their account can be sent an invitation');
  }
  await prisma.$transaction(async (tx) => {
    await issueInvitation(tx, t.user.id, actor.userId);
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: 'teacher.invitation_resent',
      entityType: 'User',
      entityId: t.user.id,
      requestId: actor.requestId,
    });
  });
  return getTeacher(actor.schoolId, teacherProfileId);
}

export async function triggerPasswordReset(actor: Actor, teacherProfileId: string) {
  const t = await findTeacher(actor.schoolId, teacherProfileId);
  if (t.user.status !== 'ACTIVE') throw conflict('Password resets are only for active accounts');
  await prisma.$transaction(async (tx) => {
    await issuePasswordReset(tx, t.user.id, actor.userId);
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: 'teacher.password_reset_sent',
      entityType: 'User',
      entityId: t.user.id,
      requestId: actor.requestId,
    });
  });
}

export async function teacherAudit(
  schoolId: string,
  teacherProfileId: string,
  page: number,
  pageSize: number,
) {
  const t = await findTeacher(schoolId, teacherProfileId);
  const where: Prisma.AuditLogWhereInput = {
    schoolId,
    OR: [{ entityId: t.user.id }, { entityId: t.id }, { actorId: t.user.id }],
  };
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { actor: { select: { fullName: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...pageArgs(page, pageSize),
    }),
    prisma.auditLog.count({ where }),
  ]);
  return {
    data: rows.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      actorName: r.actor?.fullName ?? 'System',
      metadata: r.metadata,
      createdAt: r.createdAt,
    })),
    meta: pageMeta(page, pageSize, total),
  };
}
