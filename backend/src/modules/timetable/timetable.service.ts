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
import {
  lockAssignment,
  lockAssignmentsInOrder,
  newSyncCache,
  syncAssignment,
  type SyncResult,
} from '../lessons/lessons.service.js';

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

/**
 * A slot change takes effect at once: the subject's lessons are created, moved or removed in
 * the same transaction, so teachers see today's lessons without the headmaster publishing.
 * Before the term's week dates exist there is nothing to place lessons in, so this waits for
 * the first publish.
 */
async function applySlotChange(tx: Tx, actor: Actor, assignmentId: string) {
  const assignment = await tx.teachingAssignment.findUniqueOrThrow({
    where: { id: assignmentId },
    select: { termId: true, isActive: true },
  });
  if (!assignment.isActive) return;
  if (!(await tx.termWeek.count({ where: { termId: assignment.termId } }))) return;
  await lockAssignment(tx, actor.schoolId, assignmentId);
  await syncAssignment(tx, assignmentId, { generate: true });
}

export async function createEntry(actor: Actor, input: TimetableEntryBody) {
  const entry = await prisma.$transaction(async (tx) => {
    const created = await insertEntry(tx, actor, input);
    await applySlotChange(tx, actor, input.assignmentId);
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
    await applySlotChange(tx, actor, old.assignmentId);
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
    await applySlotChange(tx, actor, old.assignmentId);
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
  ctech: 'CT',
  cart: 'CAD',
  carts: 'CAD',
  creativeart: 'CAD',
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

  return prisma.$transaction(
    async (tx) => {
      const classes = await tx.schoolClass.findMany({ where: { schoolId: actor.schoolId } });
      const classByName = new Map(classes.map((c) => [squash(c.name), c]));
      // "Form 1" and "JHS 1" mean Basic 7. When the school has one class at that level,
      // that is the class meant.
      const classByLevelName = (name: string) => {
        const m = squash(name).match(/^(form|jhs|basic|b)(\d)$/);
        if (!m) return undefined;
        const n = Number(m[2]);
        const level = m[1] === 'form' || m[1] === 'jhs' ? n + 6 : n;
        const atLevel = classes.filter((c) => c.isActive && c.level === `BASIC_${level}`);
        return atLevel.length === 1 ? atLevel[0] : undefined;
      };
      const assignments = await tx.teachingAssignment.findMany({
        where: { schoolId: actor.schoolId, termId: term.id, isActive: true },
        include: {
          subject: { include: { parent: { select: { code: true } } } },
          teacherProfile: { include: { user: { select: { fullName: true } } } },
        },
      });

      const out: ImportedRow[] = input.rows.map((r, i) => ({ ...r, row: i + 1 }));
      const matched: { row: ImportedRow; assignment: (typeof assignments)[number] }[] = [];
      for (const r of out) {
        if (timeToMinutes(r.startTime) >= timeToMinutes(r.endTime)) {
          r.error = 'The end time must be after the start time';
          continue;
        }
        const cls = classByName.get(squash(r.className)) ?? classByLevelName(r.className);
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
          : own.filter((a) => code && (a.subject.code === code || a.subject.parent?.code === code));
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
        matched.push({ row: r, assignment: a });
      }

      // The classes in the file get exactly the file's slots: their current slots this term
      // are replaced. Every other slot that overlaps the term stays, and can clash.
      const classIds = [...new Set(matched.map((m) => m.assignment.classId))];
      const replacing = {
        schoolId: actor.schoolId,
        deletedAt: null,
        classId: { in: classIds },
        assignment: { termId: term.id },
      };
      const staying = await tx.timetableEntry.findMany({
        where: {
          schoolId: actor.schoolId,
          deletedAt: null,
          validFrom: { lte: term.endDate },
          validTo: { gte: term.startDate },
          NOT: { classId: { in: classIds }, assignment: { termId: term.id } },
        },
        include: entryInclude,
      });
      const className = new Map(classes.map((c) => [c.id, c.name]));

      // Clashes are checked here in memory (a remote database makes a check per row slow).
      // The database's exclusion constraints still refuse any overlap that gets past this.
      const taken = staying.map((e) => ({
        teacherProfileId: e.teacherProfileId,
        classId: e.classId,
        weekday: e.weekday,
        startMinute: e.startMinute,
        endMinute: e.endMinute,
        teacher: e.assignment.teacherProfile.user.fullName,
        subject: e.assignment.subject.name,
        className: e.assignment.schoolClass.name,
      }));
      const accepted: typeof matched = [];
      for (const m of matched) {
        const slot = {
          teacherProfileId: m.assignment.teacherProfileId,
          classId: m.assignment.classId,
          weekday: m.row.weekday,
          startMinute: timeToMinutes(m.row.startTime),
          endMinute: timeToMinutes(m.row.endTime),
          teacher: m.assignment.teacherProfile.user.fullName,
          subject: m.assignment.subject.name,
          className: className.get(m.assignment.classId) ?? '',
        };
        const clash = taken.find(
          (t) =>
            t.weekday === slot.weekday &&
            t.startMinute < slot.endMinute &&
            t.endMinute > slot.startMinute &&
            (t.teacherProfileId === slot.teacherProfileId || t.classId === slot.classId),
        );
        if (clash) {
          const who =
            clash.teacherProfileId === slot.teacherProfileId
              ? `${clash.teacher} already teaches`
              : `${clash.className} already has`;
          m.row.error = `${who} ${clash.subject} (${clash.className}) from ${minutesToTime(clash.startMinute)} to ${minutesToTime(clash.endMinute)} on that day`;
          continue;
        }
        taken.push(slot);
        accepted.push(m);
      }

      const created = accepted.length;
      // A check, or a file with problems, saves nothing.
      if (input.dryRun || out.some((r) => r.error)) {
        const replaced = await tx.timetableEntry.count({ where: replacing });
        return { rows: out, created, replaced };
      }

      const { count: replaced } = await tx.timetableEntry.updateMany({
        where: replacing,
        data: { deletedAt: new Date() },
      });
      try {
        await tx.timetableEntry.createMany({
          data: accepted.map((m) => ({
            schoolId: actor.schoolId,
            assignmentId: m.assignment.id,
            teacherProfileId: m.assignment.teacherProfileId,
            classId: m.assignment.classId,
            weekday: m.row.weekday,
            startMinute: timeToMinutes(m.row.startTime),
            endMinute: timeToMinutes(m.row.endTime),
            validFrom: term.startDate,
            validTo: term.endDate,
          })),
        });
      } catch (err) {
        // Someone else saved an overlapping slot at the same moment.
        if (isExclusionViolation(err))
          throw new AppError(
            'CONFLICT',
            'Another change to the timetable was saved at the same time. Upload the file again.',
          );
        throw err;
      }
      const result = { rows: out, created, replaced };

      // The new slots take effect at once: every subject of these classes gets its lessons.
      const touched = await tx.teachingAssignment.findMany({
        where: {
          schoolId: actor.schoolId,
          termId: term.id,
          classId: { in: classIds },
          isActive: true,
        },
        select: { id: true },
      });
      if (await tx.termWeek.count({ where: { termId: term.id } })) {
        const ids = touched.map((a) => a.id).sort();
        await lockAssignmentsInOrder(tx, actor.schoolId, ids);
        const cache = newSyncCache();
        for (const id of ids) await syncAssignment(tx, id, { generate: true }, cache);
      }
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
    throw new AppError(
      'CONFLICT',
      `The week dates for ${term.name} are not saved yet, so the lessons cannot be placed in weeks. Go to Settings → Term weeks, press "Fill weekly from term start", then "Save weeks", and publish again.`,
    );
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
        await lockAssignmentsInOrder(
          tx,
          actor.schoolId,
          assignments.map((a) => a.id),
        );
        const cache = newSyncCache();
        const out: SyncResult[] = [];
        for (const a of assignments) {
          out.push(await syncAssignment(tx, a.id, { generate: true }, cache));
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
