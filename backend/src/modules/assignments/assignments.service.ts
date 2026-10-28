import { prisma, type Prisma, type Tx } from '../../lib/db.js';
import {
  AppError,
  isExclusionViolation,
  isUniqueViolation,
  notFound,
  validation,
} from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { lockAssignment } from '../lessons/lessons.service.js';

interface Actor {
  schoolId: string;
  userId: string;
  requestId: string;
}

export const assignmentSelect = {
  id: true,
  termId: true,
  isActive: true,
  pacedPerWeek: true,
  subject: { select: { id: true, name: true, parentSubjectId: true } },
  schoolClass: { select: { id: true, name: true, level: true } },
  term: { select: { id: true, name: true, isCurrent: true } },
  teacherProfile: { select: { id: true, staffId: true, user: { select: { fullName: true } } } },
  _count: { select: { timetableEntries: { where: { deletedAt: null } } } },
} satisfies Prisma.TeachingAssignmentSelect;

type AssignmentRow = Prisma.TeachingAssignmentGetPayload<{ select: typeof assignmentSelect }>;

export function assignmentDto(a: AssignmentRow) {
  return {
    id: a.id,
    termId: a.termId,
    term: a.term,
    isActive: a.isActive,
    subject: a.subject,
    schoolClass: a.schoolClass,
    teacher: {
      id: a.teacherProfile.id,
      staffId: a.teacherProfile.staffId,
      fullName: a.teacherProfile.user.fullName,
    },
    lessonsPerWeek: a._count.timetableEntries,
    published: a.pacedPerWeek !== null,
  };
}

/**
 * Validates subject-class pairs for one school and term and creates the assignments.
 * Runs inside the caller's transaction.
 */
export async function createAssignments(
  tx: Tx,
  actor: Actor,
  teacherProfileId: string,
  termId: string,
  pairs: { subjectId: string; classId: string }[],
) {
  if (!pairs.length) return [];
  const term = await tx.term.findFirst({ where: { id: termId, schoolId: actor.schoolId } });
  if (!term) throw validation({ termId: ['Choose a term of this school'] });

  const keys = new Set<string>();
  const problems: string[] = [];
  for (const p of pairs) {
    const key = `${p.subjectId}|${p.classId}`;
    if (keys.has(key)) problems.push('The same subject and class is listed twice');
    keys.add(key);
  }

  const subjects = await tx.subject.findMany({
    where: {
      id: { in: pairs.map((p) => p.subjectId) },
      OR: [{ schoolId: null }, { schoolId: actor.schoolId }],
    },
  });
  const classes = await tx.schoolClass.findMany({
    where: { id: { in: pairs.map((p) => p.classId) }, schoolId: actor.schoolId, isActive: true },
  });
  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  const classById = new Map(classes.map((c) => [c.id, c]));

  for (const p of pairs) {
    const s = subjectById.get(p.subjectId);
    if (!s || !s.isActive) problems.push('A chosen subject does not exist');
    else if (s.isFramework)
      problems.push(
        'Assign a specific Ghanaian language, not the general Ghanaian Language subject',
      );
    if (!classById.get(p.classId)) problems.push('A chosen class does not exist');
  }

  const taken = await tx.teachingAssignment.findMany({
    where: { termId, OR: pairs.map((p) => ({ subjectId: p.subjectId, classId: p.classId })) },
    include: { teacherProfile: { include: { user: { select: { fullName: true } } } } },
  });
  for (const t of taken) {
    const subject = subjectById.get(t.subjectId)?.name ?? 'This subject';
    const cls = classById.get(t.classId)?.name ?? 'this class';
    problems.push(
      `${subject} for ${cls} is already assigned to ${t.teacherProfile.user.fullName} this term`,
    );
  }
  if (problems.length) throw validation({ assignments: [...new Set(problems)] });

  const created = [];
  for (const p of pairs) {
    const a = await tx.teachingAssignment.create({
      data: {
        schoolId: actor.schoolId,
        termId,
        teacherProfileId,
        subjectId: p.subjectId,
        classId: p.classId,
      },
      select: assignmentSelect,
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: 'assignment.created',
      entityType: 'TeachingAssignment',
      entityId: a.id,
      metadata: { teacherProfileId, subjectId: p.subjectId, classId: p.classId, termId },
      requestId: actor.requestId,
    });
    created.push(a);
  }
  return created.map(assignmentDto);
}

export async function createAssignment(
  actor: Actor,
  input: { teacherProfileId: string; subjectId: string; classId: string; termId: string },
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const teacher = await tx.teacherProfile.findFirst({
        where: { id: input.teacherProfileId, schoolId: actor.schoolId },
        include: { user: true },
      });
      if (!teacher || teacher.user.status === 'DEACTIVATED')
        throw validation({ teacherProfileId: ['Choose an active teacher'] });
      const [a] = await createAssignments(tx, actor, teacher.id, input.termId, [input]);
      return a;
    });
  } catch (err) {
    if (isUniqueViolation(err))
      throw validation({ assignments: ['This subject and class is already assigned this term'] });
    throw err;
  }
}

/** Reassigns to another teacher or (de)activates. Timetable slots move with the assignment. */
export async function updateAssignment(
  actor: Actor,
  id: string,
  input: { teacherProfileId?: string | undefined; isActive?: boolean | undefined },
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const locked = await lockAssignment(tx, actor.schoolId, id);
      if (!locked) throw notFound('Assignment');
      const before = await tx.teachingAssignment.findUniqueOrThrow({ where: { id } });

      if (input.teacherProfileId && input.teacherProfileId !== before.teacherProfileId) {
        const teacher = await tx.teacherProfile.findFirst({
          where: { id: input.teacherProfileId, schoolId: actor.schoolId },
          include: { user: true },
        });
        if (!teacher || teacher.user.status === 'DEACTIVATED')
          throw validation({ teacherProfileId: ['Choose an active teacher'] });
        await tx.timetableEntry.updateMany({
          where: { assignmentId: id, deletedAt: null },
          data: { teacherProfileId: teacher.id },
        });
      }
      const a = await tx.teachingAssignment.update({
        where: { id },
        data: {
          ...(input.teacherProfileId ? { teacherProfileId: input.teacherProfileId } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
        select: assignmentSelect,
      });
      await audit(tx, {
        schoolId: actor.schoolId,
        actorId: actor.userId,
        action: 'assignment.updated',
        entityType: 'TeachingAssignment',
        entityId: id,
        metadata: {
          from: { teacherProfileId: before.teacherProfileId, isActive: before.isActive },
          to: input,
        },
        requestId: actor.requestId,
      });
      return assignmentDto(a);
    });
  } catch (err) {
    if (isExclusionViolation(err)) {
      throw new AppError(
        'CONFLICT',
        'The new teacher already teaches at one of this assignment’s timetable slots',
      );
    }
    throw err;
  }
}

export async function listAssignments(
  schoolId: string,
  filters: {
    termId?: string | undefined;
    teacherProfileId?: string | undefined;
    classId?: string | undefined;
  },
) {
  const rows = await prisma.teachingAssignment.findMany({
    where: {
      schoolId,
      ...(filters.termId ? { termId: filters.termId } : {}),
      ...(filters.teacherProfileId ? { teacherProfileId: filters.teacherProfileId } : {}),
      ...(filters.classId ? { classId: filters.classId } : {}),
    },
    select: assignmentSelect,
    orderBy: [{ schoolClass: { name: 'asc' } }, { subject: { sortOrder: 'asc' } }, { id: 'asc' }],
  });
  return rows.map(assignmentDto);
}

/** Copies active assignments from one term to another, skipping pairs already taken. */
export async function carryForward(actor: Actor, fromTermId: string, toTermId: string) {
  return prisma.$transaction(async (tx) => {
    const terms = await tx.term.findMany({
      where: { id: { in: [fromTermId, toTermId] }, schoolId: actor.schoolId },
    });
    if (terms.length !== 2) throw notFound('Term');
    const source = await tx.teachingAssignment.findMany({
      where: {
        schoolId: actor.schoolId,
        termId: fromTermId,
        isActive: true,
        teacherProfile: { user: { status: { not: 'DEACTIVATED' } } },
      },
    });
    const existing = await tx.teachingAssignment.findMany({
      where: { termId: toTermId },
      select: { subjectId: true, classId: true },
    });
    const taken = new Set(existing.map((e) => `${e.subjectId}|${e.classId}`));
    let created = 0;
    for (const a of source) {
      if (taken.has(`${a.subjectId}|${a.classId}`)) continue;
      await tx.teachingAssignment.create({
        data: {
          schoolId: actor.schoolId,
          termId: toTermId,
          teacherProfileId: a.teacherProfileId,
          subjectId: a.subjectId,
          classId: a.classId,
        },
      });
      created += 1;
    }
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: 'assignment.carried_forward',
      entityType: 'Term',
      entityId: toTermId,
      metadata: { fromTermId, created, skipped: source.length - created },
      requestId: actor.requestId,
    });
    return { created, skipped: source.length - created };
  });
}

/**
 * Removes an assignment with its timetable slots and lessons. Refused once a teacher has
 * written a lesson record for it: records are the school's evidence and are never deleted.
 * Ending the assignment (isActive: false) keeps everything instead.
 */
export async function deleteAssignment(actor: Actor, id: string) {
  await prisma.$transaction(async (tx) => {
    const locked = await lockAssignment(tx, actor.schoolId, id);
    if (!locked) throw notFound('Assignment');
    await removeAssignmentData(tx, id);
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: 'assignment.deleted',
      entityType: 'TeachingAssignment',
      entityId: id,
      requestId: actor.requestId,
    });
  });
}

export async function removeAssignmentData(tx: Tx, id: string) {
  const records = await tx.teachingRecord.count({ where: { assignmentId: id } });
  if (records) {
    throw new AppError(
      'CONFLICT',
      `${records} lesson record${records === 1 ? ' has' : 's have'} been written for this class subject, so it cannot be deleted. End it instead; the records are kept.`,
      { records },
    );
  }
  await tx.lesson.updateMany({ where: { assignmentId: id }, data: { rescheduledFromId: null } });
  await tx.lesson.deleteMany({ where: { assignmentId: id } });
  await tx.timetableEntry.deleteMany({ where: { assignmentId: id } });
  await tx.teachingAssignment.delete({ where: { id } });
}
