import { minutesToTime, timeToMinutes, type TimetableEntryBody } from '@school/shared';
import { prisma, type Tx } from '../../lib/db.js';
import { AppError, isExclusionViolation, notFound } from '../../lib/errors.js';
import { fromDbDate, toDbDate } from '../../lib/dates.js';
import { audit } from '../../lib/audit.js';
import { lockAssignment, syncAssignment, type SyncResult } from '../lessons/lessons.service.js';

interface Actor {
  schoolId: string;
  userId: string;
  requestId: string;
}

const entryInclude = {
  assignment: {
    select: {
      id: true,
      termId: true,
      subject: { select: { id: true, name: true } },
      schoolClass: { select: { id: true, name: true, level: true } },
      teacherProfile: { select: { id: true, user: { select: { fullName: true } } } },
    },
  },
} as const;

function toDto(e: {
  id: string;
  weekday: number;
  startMinute: number;
  endMinute: number;
  validFrom: Date;
  validTo: Date;
  assignment: {
    id: string;
    termId: string;
    subject: { id: string; name: string };
    schoolClass: { id: string; name: string; level: string };
    teacherProfile: { id: string; user: { fullName: string } };
  };
}) {
  return {
    id: e.id,
    weekday: e.weekday,
    startTime: minutesToTime(e.startMinute),
    endTime: minutesToTime(e.endMinute),
    validFrom: fromDbDate(e.validFrom),
    validTo: fromDbDate(e.validTo),
    assignment: {
      id: e.assignment.id,
      termId: e.assignment.termId,
      subject: e.assignment.subject,
      schoolClass: e.assignment.schoolClass,
      teacher: {
        id: e.assignment.teacherProfile.id,
        fullName: e.assignment.teacherProfile.user.fullName,
      },
    },
  };
}

export async function listEntries(
  schoolId: string,
  filters: {
    termId?: string | undefined;
    classId?: string | undefined;
    teacherProfileId?: string | undefined;
  },
) {
  const rows = await prisma.timetableEntry.findMany({
    where: {
      schoolId,
      deletedAt: null,
      ...(filters.classId ? { classId: filters.classId } : {}),
      ...(filters.teacherProfileId ? { teacherProfileId: filters.teacherProfileId } : {}),
      ...(filters.termId ? { assignment: { termId: filters.termId } } : {}),
    },
    include: entryInclude,
    orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }, { id: 'asc' }],
  });
  return rows.map(toDto);
}

async function assertNoOverlap(
  tx: Tx,
  data: {
    schoolId: string;
    teacherProfileId: string;
    classId: string;
    weekday: number;
    startMinute: number;
    endMinute: number;
    validFrom: Date;
    validTo: Date;
  },
  ignoreId?: string,
) {
  const overlapping = await tx.timetableEntry.findFirst({
    where: {
      schoolId: data.schoolId,
      deletedAt: null,
      weekday: data.weekday,
      startMinute: { lt: data.endMinute },
      endMinute: { gt: data.startMinute },
      validFrom: { lte: data.validTo },
      validTo: { gte: data.validFrom },
      OR: [{ teacherProfileId: data.teacherProfileId }, { classId: data.classId }],
      ...(ignoreId ? { id: { not: ignoreId } } : {}),
    },
    include: entryInclude,
  });
  if (overlapping) {
    const who =
      overlapping.teacherProfileId === data.teacherProfileId
        ? `${overlapping.assignment.teacherProfile.user.fullName} already teaches`
        : `${overlapping.assignment.schoolClass.name} already has`;
    throw new AppError(
      'CONFLICT',
      `${who} ${overlapping.assignment.subject.name} (${overlapping.assignment.schoolClass.name}) from ${minutesToTime(overlapping.startMinute)} to ${minutesToTime(overlapping.endMinute)} on that day`,
      { conflictingEntryId: overlapping.id },
    );
  }
}

async function insertEntry(tx: Tx, actor: Actor, input: TimetableEntryBody) {
  const assignment = await tx.teachingAssignment.findFirst({
    where: { id: input.assignmentId, schoolId: actor.schoolId, isActive: true },
    include: { term: true },
  });
  if (!assignment) throw notFound('Assignment');

  const termStart = fromDbDate(assignment.term.startDate);
  const termEnd = fromDbDate(assignment.term.endDate);
  const validFrom = input.validFrom ?? termStart;
  const validTo = input.validTo ?? termEnd;
  if (validFrom > validTo || validFrom < termStart || validTo > termEnd) {
    throw new AppError('VALIDATION_ERROR', 'Please check the dates', {
      fields: {
        validTo: ['Valid dates must fall within the term, with the end on or after the start'],
      },
    });
  }

  const data = {
    schoolId: actor.schoolId,
    assignmentId: assignment.id,
    teacherProfileId: assignment.teacherProfileId,
    classId: assignment.classId,
    weekday: input.weekday,
    startMinute: timeToMinutes(input.startTime),
    endMinute: timeToMinutes(input.endTime),
    validFrom: toDbDate(validFrom),
    validTo: toDbDate(validTo),
  };
  await assertNoOverlap(tx, data);
  try {
    return await tx.timetableEntry.create({ data, include: entryInclude });
  } catch (err) {
    // The exclusion constraints are the real guard against concurrent inserts.
    if (isExclusionViolation(err))
      throw new AppError('CONFLICT', 'This slot overlaps another lesson for the teacher or class');
    throw err;
  }
}

export async function createEntry(actor: Actor, input: TimetableEntryBody) {
  const entry = await prisma.$transaction(async (tx) => {
    const created = await insertEntry(tx, actor, input);
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: 'timetable.entry_created',
      entityType: 'TimetableEntry',
      entityId: created.id,
      metadata: {
        assignmentId: input.assignmentId,
        weekday: input.weekday,
        startTime: input.startTime,
        endTime: input.endTime,
      },
      requestId: actor.requestId,
    });
    return created;
  });
  return toDto(entry);
}

/** Editing replaces the entry, so lessons already generated from the old slot keep their history. */
export async function updateEntry(
  actor: Actor,
  id: string,
  patch: {
    weekday?: number | undefined;
    startTime?: string | undefined;
    endTime?: string | undefined;
    validFrom?: string | undefined;
    validTo?: string | undefined;
  },
) {
  const entry = await prisma.$transaction(async (tx) => {
    const old = await tx.timetableEntry.findFirst({
      where: { id, schoolId: actor.schoolId, deletedAt: null },
    });
    if (!old) throw notFound('Timetable entry');
    await tx.timetableEntry.update({ where: { id }, data: { deletedAt: new Date() } });
    const next: TimetableEntryBody = {
      assignmentId: old.assignmentId,
      weekday: patch.weekday ?? old.weekday,
      startTime: patch.startTime ?? minutesToTime(old.startMinute),
      endTime: patch.endTime ?? minutesToTime(old.endMinute),
      validFrom: patch.validFrom ?? fromDbDate(old.validFrom),
      validTo: patch.validTo ?? fromDbDate(old.validTo),
    };
    if (timeToMinutes(next.startTime) >= timeToMinutes(next.endTime)) {
      throw new AppError('VALIDATION_ERROR', 'Please check the times', {
        fields: { endTime: ['End time must be after start time'] },
      });
    }
    const created = await insertEntry(tx, actor, next);
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: 'timetable.entry_updated',
      entityType: 'TimetableEntry',
      entityId: created.id,
      metadata: { replacedEntryId: id, ...patch },
      requestId: actor.requestId,
    });
    return created;
  });
  return toDto(entry);
}

export async function deleteEntry(actor: Actor, id: string) {
  await prisma.$transaction(async (tx) => {
    const old = await tx.timetableEntry.findFirst({
      where: { id, schoolId: actor.schoolId, deletedAt: null },
    });
    if (!old) throw notFound('Timetable entry');
    await tx.timetableEntry.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: 'timetable.entry_deleted',
      entityType: 'TimetableEntry',
      entityId: id,
      requestId: actor.requestId,
    });
  });
}

class DryRunRollback extends Error {
  constructor(readonly results: SyncResult[]) {
    super('dry run');
  }
}

/**
 * Generates lessons for every assignment of the term and re-paces them. Changing the weekly
 * lesson count of an assignment that already has submitted records needs explicit confirmation.
 * A dry run performs the same work and rolls it back, returning the preview.
 */
export async function publish(
  actor: Actor,
  input: { termId: string; confirmRepace: boolean; dryRun: boolean },
) {
  const term = await prisma.term.findFirst({
    where: { id: input.termId, schoolId: actor.schoolId },
  });
  if (!term) throw notFound('Term');
  const weekCount = await prisma.termWeek.count({ where: { termId: term.id } });
  if (weekCount === 0) {
    throw new AppError('CONFLICT', 'Set up the term weeks before publishing the timetable');
  }

  let results: SyncResult[];
  try {
    results = await prisma.$transaction(
      async (tx) => {
        const assignments = await tx.teachingAssignment.findMany({
          where: { schoolId: actor.schoolId, termId: term.id, isActive: true },
          select: { id: true },
          orderBy: { id: 'asc' },
        });
        const out: SyncResult[] = [];
        for (const a of assignments) {
          await lockAssignment(tx, actor.schoolId, a.id);
          out.push(await syncAssignment(tx, a.id, { generate: true }));
        }

        const needsConfirm = out.filter(
          (r) =>
            r.previousPerWeek !== null && r.previousPerWeek !== r.perWeek && r.hasSubmittedRecords,
        );
        if (needsConfirm.length && !input.confirmRepace && !input.dryRun) {
          throw new AppError(
            'CONFLICT',
            'Some assignments change their weekly lesson count mid-term. Review the preview and confirm re-pacing.',
            {
              assignments: needsConfirm.map((r) => ({
                assignmentId: r.assignmentId,
                from: r.previousPerWeek,
                to: r.perWeek,
              })),
            },
          );
        }
        if (input.dryRun) throw new DryRunRollback(out);

        await audit(tx, {
          schoolId: actor.schoolId,
          actorId: actor.userId,
          action: 'timetable.published',
          entityType: 'Term',
          entityId: term.id,
          metadata: {
            assignments: out.length,
            lessonsCreated: out.reduce((s, r) => s + r.lessonsCreated, 0),
            repaced: needsConfirm.map((r) => r.assignmentId),
          },
          requestId: actor.requestId,
        });
        return out;
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  } catch (err) {
    if (err instanceof DryRunRollback) results = err.results;
    else throw err;
  }

  const details = await prisma.teachingAssignment.findMany({
    where: { id: { in: results.map((r) => r.assignmentId) } },
    select: {
      id: true,
      subject: { select: { name: true } },
      schoolClass: { select: { name: true } },
      teacherProfile: { select: { user: { select: { fullName: true } } } },
    },
  });
  const byId = new Map(details.map((d) => [d.id, d]));
  return {
    dryRun: input.dryRun,
    assignments: results.map((r) => {
      const d = byId.get(r.assignmentId);
      return {
        assignmentId: r.assignmentId,
        subject: d?.subject.name ?? '',
        className: d?.schoolClass.name ?? '',
        teacher: d?.teacherProfile.user.fullName ?? '',
        perWeek: r.perWeek,
        previousPerWeek: r.previousPerWeek,
        requiredWeeks: r.requiredWeeks.length,
        shortfall: r.shortfall,
        lessonsCreated: r.lessonsCreated,
        lessonsRemoved: r.lessonsRemoved,
        needsConfirmation:
          r.previousPerWeek !== null && r.previousPerWeek !== r.perWeek && r.hasSubmittedRecords,
      };
    }),
  };
}
