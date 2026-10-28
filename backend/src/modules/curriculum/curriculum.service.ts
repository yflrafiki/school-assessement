import type { z } from 'zod';
import type {
  CreateImportBody,
  Level,
  curriculumQuery,
  listImportRowsQuery,
  reviewImportRowBody,
} from '@school/shared';
import { prisma, type Prisma } from '../../lib/db.js';
import { AppError, conflict, notFound, validation } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { pageArgs, pageMeta } from '../../lib/pagination.js';
import { syncSchoolAssignments } from '../lessons/lessons.service.js';
import { loadTermCalendar } from '../lessons/weekKinds.js';
import { naturalKey, rowFlags, subjectCodeFor, validateBatch } from './validation.js';

interface Actor {
  schoolId: string;
  userId: string;
  requestId: string;
}

// ---------- Import batches ----------

export async function createImport(actor: Actor, input: CreateImportBody) {
  const term = await prisma.term.findFirst({
    where: { id: input.termId, schoolId: actor.schoolId },
  });
  if (!term) throw notFound('Term');

  // Idempotent: the same file for the same term returns the existing batch.
  const existing = await prisma.importBatch.findUnique({
    where: {
      schoolId_termId_checksum: {
        schoolId: actor.schoolId,
        termId: term.id,
        checksum: input.checksum,
      },
    },
  });
  if (existing) return { batch: await getImport(actor.schoolId, existing.id), created: false };

  const { warnings } = validateBatch(input.rows, input.weeks);
  const rows = input.rows.map((r, i) => {
    const flags = rowFlags(r);
    return {
      rowIndex: i,
      level: r.level,
      subjectName: r.subject,
      weekNumber: r.weekNumber,
      strand: r.strand,
      subStrand: r.subStrand,
      contentStandard: r.contentStandard,
      indicator: r.indicator,
      sourcePage: r.sourcePage,
      flags,
    };
  });

  const batch = await prisma.$transaction(async (tx) => {
    const b = await tx.importBatch.create({
      data: {
        schoolId: actor.schoolId,
        termId: term.id,
        fileName: input.fileName,
        checksum: input.checksum,
        weeks: input.weeks,
        report: { notes: input.notes, warnings },
        createdById: actor.userId,
      },
    });
    await tx.importRow.createMany({ data: rows.map((r) => ({ ...r, batchId: b.id })) });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: 'curriculum.import_staged',
      entityType: 'ImportBatch',
      entityId: b.id,
      metadata: {
        fileName: input.fileName,
        rows: rows.length,
        flagged: rows.filter((r) => r.flags.length).length,
      },
      requestId: actor.requestId,
    });
    return b;
  });
  return { batch: await getImport(actor.schoolId, batch.id), created: true };
}

export async function listImports(schoolId: string) {
  const batches = await prisma.importBatch.findMany({
    where: { schoolId },
    include: {
      term: { select: { name: true } },
      scheme: { select: { id: true, status: true, version: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return batches.map((b) => ({
    id: b.id,
    fileName: b.fileName,
    termId: b.termId,
    termName: b.term.name,
    status: b.status,
    createdAt: b.createdAt,
    importedAt: b.importedAt,
    scheme: b.scheme,
  }));
}

export async function getImport(schoolId: string, batchId: string) {
  const b = await prisma.importBatch.findFirst({
    where: { id: batchId, schoolId },
    include: {
      term: { select: { id: true, name: true } },
      scheme: { select: { id: true, status: true, version: true } },
    },
  });
  if (!b) throw notFound('Import');
  const [total, flagged, byDecision] = await Promise.all([
    prisma.importRow.count({ where: { batchId } }),
    prisma.importRow.count({ where: { batchId, NOT: { flags: { isEmpty: true } } } }),
    prisma.importRow.groupBy({ by: ['decision'], where: { batchId }, _count: { _all: true } }),
  ]);
  const flaggedPending = await prisma.importRow.count({
    where: { batchId, decision: 'PENDING', NOT: { flags: { isEmpty: true } } },
  });
  return {
    id: b.id,
    fileName: b.fileName,
    checksum: b.checksum,
    term: b.term,
    status: b.status,
    weeks: b.weeks,
    report: b.report,
    createdAt: b.createdAt,
    importedAt: b.importedAt,
    scheme: b.scheme,
    counts: {
      total,
      flagged,
      flaggedPending,
      decisions: Object.fromEntries(byDecision.map((d) => [d.decision, d._count._all])),
    },
  };
}

export async function listImportRows(
  schoolId: string,
  batchId: string,
  q: z.infer<typeof listImportRowsQuery>,
) {
  const b = await prisma.importBatch.findFirst({
    where: { id: batchId, schoolId },
    select: { id: true },
  });
  if (!b) throw notFound('Import');
  const where: Prisma.ImportRowWhereInput = {
    batchId,
    ...(q.flagged === 'true' ? { NOT: { flags: { isEmpty: true } } } : {}),
    ...(q.flagged === 'false' ? { flags: { isEmpty: true } } : {}),
    ...(q.decision ? { decision: q.decision } : {}),
    ...(q.level ? { level: q.level } : {}),
    ...(q.subject ? { subjectName: { contains: q.subject, mode: 'insensitive' } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.importRow.findMany({
      where,
      orderBy: [{ level: 'asc' }, { sourcePage: 'asc' }, { rowIndex: 'asc' }],
      ...pageArgs(q.page, q.pageSize),
    }),
    prisma.importRow.count({ where }),
  ]);
  return { data: rows, meta: pageMeta(q.page, q.pageSize, total) };
}

export async function reviewRow(
  actor: Actor,
  batchId: string,
  rowId: string,
  input: z.infer<typeof reviewImportRowBody>,
) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.importRow.findFirst({
      where: { id: rowId, batchId, batch: { schoolId: actor.schoolId } },
      include: { batch: true },
    });
    if (!row) throw notFound('Import row');
    if (row.batch.status !== 'STAGED') throw conflict('This import has already been processed');
    if (input.decision === 'CORRECTED' && (!input.corrected || !input.note)) {
      throw validation({
        note: ['A correction needs the corrected text and a note explaining it'],
      });
    }
    const updated = await tx.importRow.update({
      where: { id: row.id },
      data: {
        decision: input.decision,
        reviewNote: input.note ?? null,
        corrected: input.decision === 'CORRECTED' ? (input.corrected ?? {}) : undefined,
        reviewedById: actor.userId,
        reviewedAt: new Date(),
      },
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: 'curriculum.row_reviewed',
      entityType: 'ImportRow',
      entityId: row.id,
      metadata: { decision: input.decision, note: input.note ?? null },
      requestId: actor.requestId,
    });
    return updated;
  });
}

/**
 * Turns a fully reviewed batch into a draft scheme in one transaction. Flagged rows must all
 * be reviewed; unflagged pending rows are approved as extracted.
 */
export async function approveImport(actor: Actor, batchId: string) {
  return prisma.$transaction(
    async (tx) => {
      const batch = await tx.importBatch.findFirst({
        where: { id: batchId, schoolId: actor.schoolId },
      });
      if (!batch) throw notFound('Import');
      if (batch.status !== 'STAGED') throw conflict('This import has already been processed');

      const pendingFlagged = await tx.importRow.count({
        where: { batchId, decision: 'PENDING', NOT: { flags: { isEmpty: true } } },
      });
      if (pendingFlagged) {
        throw new AppError(
          'CONFLICT',
          `${pendingFlagged} flagged rows still need a review decision`,
          { pendingFlagged },
        );
      }

      const subjects = await tx.subject.findMany({ where: { schoolId: null } });
      const subjectByCode = new Map(subjects.map((s) => [s.code, s]));
      const rows = await tx.importRow.findMany({
        where: { batchId },
        orderBy: { rowIndex: 'asc' },
      });

      const unknown = new Set<string>();
      for (const r of rows) {
        const code = subjectCodeFor(r.subjectName);
        if (!code || !subjectByCode.has(code)) unknown.add(r.subjectName);
      }
      if (unknown.size) {
        throw validation({
          subjects: [...unknown].map(
            (s) => `Unknown subject "${s}". Reject these rows or fix the extraction.`,
          ),
        });
      }

      const version = (await tx.curriculumScheme.count({ where: { termId: batch.termId } })) + 1;
      const term = await tx.term.findUniqueOrThrow({ where: { id: batch.termId } });
      const scheme = await tx.curriculumScheme.create({
        data: {
          schoolId: actor.schoolId,
          termId: batch.termId,
          version,
          title: `${term.name} scheme of learning v${version}`,
          importBatchId: batch.id,
        },
      });

      const weeks = batch.weeks as {
        level: Level;
        weekNumber: number;
        kind: 'TEACHING' | 'REVISION' | 'MOCK' | 'EXAMINATION';
        label?: string;
      }[];
      await tx.curriculumWeek.createMany({
        data: weeks.map((w) => ({
          schemeId: scheme.id,
          level: w.level,
          weekNumber: w.weekNumber,
          kind: w.kind,
          label: w.label ?? null,
        })),
        skipDuplicates: true,
      });

      let imported = 0;
      let rejected = 0;
      let duplicates = 0;
      const seen = new Set<string>();
      const entries: Prisma.CurriculumEntryCreateManyInput[] = [];
      for (const r of rows) {
        if (r.decision === 'REJECTED') {
          rejected += 1;
          continue;
        }
        const c = (r.decision === 'CORRECTED' ? r.corrected : null) as Record<
          string,
          string | number | undefined
        > | null;
        const text = {
          strand: String(c?.strand ?? r.strand),
          subStrand: String(c?.subStrand ?? r.subStrand),
          contentStandard: String(c?.contentStandard ?? r.contentStandard),
          indicator: String(c?.indicator ?? r.indicator),
        };
        const weekNumber = Number(c?.weekNumber ?? r.weekNumber);
        const subject = subjectByCode.get(subjectCodeFor(r.subjectName) as string)!;
        const key = naturalKey(r.level, subject.id, weekNumber, text);
        if (seen.has(key)) {
          duplicates += 1;
          continue;
        }
        seen.add(key);
        entries.push({
          schoolId: actor.schoolId,
          schemeId: scheme.id,
          level: r.level,
          subjectId: subject.id,
          weekNumber,
          ...text,
          isTruncated:
            r.flags.includes('TRUNCATED') &&
            /(\.{4,}|…)/.test(`${text.contentStandard} ${text.indicator}`),
          sourcePage: r.sourcePage,
          naturalKey: key,
          sortOrder: r.rowIndex,
        });
        imported += 1;
      }
      await tx.curriculumEntry.createMany({ data: entries, skipDuplicates: true });

      const report = {
        ...(batch.report as Record<string, unknown>),
        imported,
        rejected,
        duplicates,
        skipped: rejected + duplicates,
        corrected: rows.filter((r) => r.decision === 'CORRECTED').length,
        flagged: rows.filter((r) => r.flags.length).length,
        schemeId: scheme.id,
        version,
      };
      await tx.importBatch.update({
        where: { id: batch.id },
        data: { status: 'IMPORTED', importedAt: new Date(), report },
      });
      await tx.importRow.updateMany({
        where: { batchId, decision: 'PENDING' },
        data: { decision: 'APPROVED' },
      });
      await audit(tx, {
        schoolId: actor.schoolId,
        actorId: actor.userId,
        action: 'curriculum.import_approved',
        entityType: 'ImportBatch',
        entityId: batch.id,
        metadata: report,
        requestId: actor.requestId,
      });
      return { schemeId: scheme.id, report };
    },
    { timeout: 120_000 },
  );
}

// ---------- Schemes ----------

export async function listSchemes(schoolId: string, termId?: string) {
  const rows = await prisma.curriculumScheme.findMany({
    where: { schoolId, ...(termId ? { termId } : {}) },
    include: { term: { select: { name: true } }, _count: { select: { entries: true } } },
    orderBy: [{ createdAt: 'desc' }],
  });
  return rows.map((s) => ({
    id: s.id,
    termId: s.termId,
    termName: s.term.name,
    version: s.version,
    title: s.title,
    status: s.status,
    publishedAt: s.publishedAt,
    entryCount: s._count.entries,
  }));
}

export async function publishScheme(actor: Actor, schemeId: string) {
  return prisma.$transaction(
    async (tx) => {
      const scheme = await tx.curriculumScheme.findFirst({
        where: { id: schemeId, schoolId: actor.schoolId },
      });
      if (!scheme) throw notFound('Scheme');
      if (scheme.status === 'PUBLISHED') throw conflict('This scheme is already published');
      const previous = await tx.curriculumScheme.findFirst({
        where: { termId: scheme.termId, status: 'PUBLISHED' },
        select: { id: true },
      });
      if (previous) {
        await tx.curriculumScheme.update({
          where: { id: previous.id },
          data: { status: 'ARCHIVED' },
        });
        // Entries of the old version stay for records that reference them, but are retired.
        await tx.curriculumEntry.updateMany({
          where: { schemeId: previous.id, retiredAt: null },
          data: { retiredAt: new Date() },
        });
      }
      await tx.curriculumScheme.update({
        where: { id: scheme.id },
        data: { status: 'PUBLISHED', publishedAt: new Date(), publishedById: actor.userId },
      });
      const synced = await syncSchoolAssignments(tx, actor.schoolId, { termId: scheme.termId });
      await audit(tx, {
        schoolId: actor.schoolId,
        actorId: actor.userId,
        action: 'curriculum.scheme_published',
        entityType: 'CurriculumScheme',
        entityId: scheme.id,
        metadata: {
          version: scheme.version,
          replaced: previous?.id ?? null,
          assignmentsRepaced: synced,
        },
        requestId: actor.requestId,
      });
      return { id: scheme.id, status: 'PUBLISHED' as const };
    },
    { timeout: 120_000 },
  );
}

// ---------- Reading the curriculum ----------

const entrySelect = {
  id: true,
  level: true,
  subjectId: true,
  weekNumber: true,
  strand: true,
  subStrand: true,
  contentStandard: true,
  indicator: true,
  isTruncated: true,
  sourcePage: true,
} satisfies Prisma.CurriculumEntrySelect;

/** Weeks (with kinds) and entries of the published scheme, optionally narrowed. */
export async function getCurriculum(schoolId: string, q: z.infer<typeof curriculumQuery>) {
  const termId =
    q.termId ?? (await prisma.term.findFirst({ where: { schoolId, isCurrent: true } }))?.id;
  if (!termId) return { scheme: null, weeks: [], entries: [] };
  const scheme = await prisma.curriculumScheme.findFirst({
    where: { schoolId, termId, status: 'PUBLISHED' },
  });
  if (!scheme) return { scheme: null, weeks: [], entries: [] };

  let subjectIds: string[] | undefined;
  if (q.subjectId) {
    const s = await prisma.subject.findFirst({
      where: { id: q.subjectId, OR: [{ schoolId: null }, { schoolId }] },
    });
    if (!s) throw notFound('Subject');
    subjectIds = s.parentSubjectId ? [s.id, s.parentSubjectId] : [s.id];
  }
  const [weeks, entries] = await Promise.all([
    prisma.curriculumWeek.findMany({
      where: { schemeId: scheme.id, ...(q.level ? { level: q.level } : {}) },
      orderBy: [{ level: 'asc' }, { weekNumber: 'asc' }],
    }),
    prisma.curriculumEntry.findMany({
      where: {
        schemeId: scheme.id,
        ...(q.level ? { level: q.level } : {}),
        ...(subjectIds ? { subjectId: { in: subjectIds } } : {}),
        ...(q.weekNumber ? { weekNumber: q.weekNumber } : {}),
      },
      select: entrySelect,
      orderBy: [{ level: 'asc' }, { weekNumber: 'asc' }, { sortOrder: 'asc' }],
      take: 2000,
    }),
  ]);
  return {
    scheme: { id: scheme.id, version: scheme.version, title: scheme.title, termId },
    weeks: weeks.map((w) => ({
      level: w.level,
      weekNumber: w.weekNumber,
      kind: w.kind,
      label: w.label,
    })),
    entries,
  };
}

/**
 * Topics available for an assignment in a curriculum week: language-specific entries
 * when the language has its own, otherwise the shared framework entries.
 */
export async function topicsFor(
  db: Prisma.TransactionClient | typeof prisma,
  schoolId: string,
  termId: string,
  level: Level,
  subject: { id: string; parentSubjectId: string | null },
  weekNumber: number,
) {
  const scheme = await db.curriculumScheme.findFirst({
    where: { schoolId, termId, status: 'PUBLISHED' },
  });
  if (!scheme) return [];
  const own = await db.curriculumEntry.findMany({
    where: { schemeId: scheme.id, level, subjectId: subject.id, weekNumber },
    select: entrySelect,
    orderBy: { sortOrder: 'asc' },
  });
  if (own.length || !subject.parentSubjectId) return own;
  return db.curriculumEntry.findMany({
    where: { schemeId: scheme.id, level, subjectId: subject.parentSubjectId, weekNumber },
    select: entrySelect,
    orderBy: { sortOrder: 'asc' },
  });
}

/** Topics for the curriculum week a lesson is paced onto (record form). */
export async function topicsForLesson(
  schoolId: string,
  lessonId: string,
  teacherProfileId?: string,
) {
  const lesson = await prisma.lesson.findFirst({
    where: {
      id: lessonId,
      schoolId,
      ...(teacherProfileId ? { assignment: { teacherProfileId } } : {}),
    },
    include: { assignment: { include: { subject: true, schoolClass: true } } },
  });
  if (!lesson) throw notFound('Lesson');
  if (lesson.weekNumber === null) return { weekNumber: null, kind: null, entries: [] };
  const calendar = await loadTermCalendar(
    prisma,
    schoolId,
    lesson.assignment.termId,
    lesson.assignment.classId,
    lesson.assignment.schoolClass.level,
  );
  const entries = await topicsFor(
    prisma,
    schoolId,
    lesson.assignment.termId,
    lesson.assignment.schoolClass.level,
    lesson.assignment.subject,
    lesson.weekNumber,
  );
  return {
    weekNumber: lesson.weekNumber,
    kind: calendar.kinds.get(lesson.weekNumber) ?? 'TEACHING',
    entries,
  };
}
