import {
  minutesToTime,
  timeToMinutes,
  type TimetableEntryBody,
  type TimetableImportRow,
} from '@school/shared';
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

// ---------- Uploading a whole timetable ----------

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Short forms headmasters write on timetables, mapped to national subject codes. */
const SUBJECT_SHORT_FORMS: Record<string, string> = {
  english: 'ENG',
  englishlanguage: 'ENG',
  eng: 'ENG',
  maths: 'MATH',
  math: 'MATH',
  mathematics: 'MATH',
  science: 'SCI',
  sci: 'SCI',
  integratedscience: 'SCI',
  computing: 'COMP',
  ict: 'COMP',
  comp: 'COMP',
  socialstudies: 'SOC',
  social: 'SOC',
  soc: 'SOC',
  rme: 'RME',
  religiousandmoraleducation: 'RME',
  cad: 'CAD',
  creativearts: 'CAD',
  creativeartsanddesign: 'CAD',
  careertechnology: 'CT',
  careertech: 'CT',
  ct: 'CT',
  pretech: 'CT',
  french: 'FRE',
  fre: 'FRE',
  ghanaianlanguage: 'GHL',
  ghanaianlanguages: 'GHL',
  ghl: 'GHL',
  twi: 'GHL',
  asantetwi: 'GHL',
  akuapemtwi: 'GHL',
  fante: 'GHL',
  ga: 'GHL',
  ewe: 'GHL',
  dagbani: 'GHL',
  nzema: 'GHL',
};

export interface ImportedRow extends TimetableImportRow {
  row: number;
  teacher?: string;
  matchedSubject?: string;
  error?: string;
}

class ImportRollback extends Error {
  constructor(readonly result: { rows: ImportedRow[]; created: number; replaced: number }) {
    super('timetable import rolled back');
  }
}

/**
 * Saves a whole uploaded timetable in one transaction. Each row is matched to the class's
 * assigned subject (and so its teacher). The classes in the file get exactly the file's slots:
 * their existing slots are replaced, so uploading a corrected file again is safe. Clashes for a
 * teacher or a class are reported per row. Nothing is saved unless every row is fine, and a
 * dry run (the default) only reports. Lessons are created when the timetable is published.
 */
export async function importTimetable(
  actor: Actor,
  input: { termId: string; rows: TimetableImportRow[]; dryRun: boolean },
) {
  const term = await prisma.term.findFirst({
    where: { id: input.termId, schoolId: actor.schoolId },
  });
  if (!term) throw notFound('Term');

  try {
    return await prisma.$transaction(
      async (tx) => {
        const classes = await tx.schoolClass.findMany({ where: { schoolId: actor.schoolId } });
        const classByName = new Map(classes.map((c) => [squash(c.name), c]));
        const assignments = await tx.teachingAssignment.findMany({
          where: { schoolId: actor.schoolId, termId: term.id, isActive: true },
          include: {
            subject: { include: { parent: { select: { code: true } } } },
            teacherProfile: { include: { user: { select: { fullName: true } } } },
          },
        });

        const out: ImportedRow[] = input.rows.map((r, i) => ({ ...r, row: i + 1 }));
        const matched: { row: ImportedRow; assignmentId: string }[] = [];
        for (const r of out) {
          if (timeToMinutes(r.startTime) >= timeToMinutes(r.endTime)) {
            r.error = 'The end time must be after the start time';
            continue;
          }
          const cls = classByName.get(squash(r.className));
          if (!cls) {
            r.error = `There is no class called "${r.className}". Add it in Settings → Classes, or correct the name.`;
            continue;
          }
          const own = assignments.filter((a) => a.classId === cls.id);
          const wanted = squash(r.subject);
          const code = SUBJECT_SHORT_FORMS[wanted];
          const hits = own.filter((a) => squash(a.subject.name) === wanted);
          const byCode = hits.length
            ? hits
            : own.filter(
                (a) => code && (a.subject.code === code || a.subject.parent?.code === code),
              );
          if (byCode.length !== 1) {
            r.error = byCode.length
              ? `"${r.subject}" matches more than one subject of ${cls.name}. Use the full subject name.`
              : `No teacher is assigned to "${r.subject}" for ${cls.name}. Assign one under Subjects and classes, or correct the subject.`;
            continue;
          }
          const a = byCode[0]!;
          r.className = cls.name;
          r.matchedSubject = a.subject.name;
          r.teacher = a.teacherProfile.user.fullName;
          matched.push({ row: r, assignmentId: a.id });
        }

        // The classes in the file get exactly the file's slots.
        const classIds = [
          ...new Set(matched.map((m) => assignments.find((a) => a.id === m.assignmentId)!.classId)),
        ];
        const { count: replaced } = await tx.timetableEntry.updateMany({
          where: {
            schoolId: actor.schoolId,
            deletedAt: null,
            classId: { in: classIds },
            assignment: { termId: term.id },
          },
          data: { deletedAt: new Date() },
        });

        let created = 0;
        for (const m of matched) {
          try {
            await insertEntry(tx, actor, {
              assignmentId: m.assignmentId,
              weekday: m.row.weekday,
              startTime: m.row.startTime,
              endTime: m.row.endTime,
            });
            created += 1;
          } catch (err) {
            // A clash is found by a read before the insert, so the transaction stays usable.
            if (err instanceof AppError && err.code === 'CONFLICT') m.row.error = err.message;
            else throw err;
          }
        }

        const result = { rows: out, created, replaced };
        if (input.dryRun || out.some((r) => r.error)) throw new ImportRollback(result);
        await audit(tx, {
          schoolId: actor.schoolId,
          actorId: actor.userId,
          action: 'timetable.imported',
          entityType: 'Term',
          entityId: term.id,
          metadata: { rows: out.length, created, replaced, classes: classIds.length },
          requestId: actor.requestId,
        });
        return result;
      },
      { timeout: 120_000 },
    );
  } catch (err) {
    if (!(err instanceof ImportRollback)) throw err;
    return err.result;
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
