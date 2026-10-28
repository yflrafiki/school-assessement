import type { z } from 'zod';
import { createImportBody } from '@school/shared';
import type {
  CreateImportBody,
  Level,
  curriculumQuery,
  listImportRowsQuery,
  reviewImportRowBody,
  updateEntryBody,
} from '@school/shared';
import { prisma, type Prisma } from '../../lib/db.js';
import { AppError, conflict, notFound, validation } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { logger } from '../../config/logger.js';
import { pageArgs, pageMeta } from '../../lib/pagination.js';
import { syncSchoolAssignments } from '../lessons/lessons.service.js';
import { loadTermCalendar } from '../lessons/weekKinds.js';
import { naturalKey, rowFlags, subjectCodeFor, validateBatch } from './validation.js';
import { TooManyPagesError, extractSchemePdf } from './pdfExtract.js';

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
  // Rows whose only problem is text cut off in the source can be approved together.
  const truncatedOnlyPending = await prisma.importRow.count({
    where: { batchId, decision: 'PENDING', flags: { equals: ['TRUNCATED'] } },
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
      truncatedOnlyPending,
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

/**
 * Reads the PDF, stages it through the same pipeline as an uploaded extraction, then accepts
 * every row (and publishes, when the uploader may) so the topics are live straight away.
 */
export async function createImportFromPdf(
  actor: Actor,
  input: { termId: string; fileName: string; data: Uint8Array; publish: boolean },
) {
  let extraction;
  try {
    extraction = await extractSchemePdf(input.data);
  } catch (err) {
    // Keep the real reason in the logs; the headmaster gets a plain message.
    logger.warn(
      { err, requestId: actor.requestId, fileName: input.fileName },
      'PDF extraction failed',
    );
    if (err instanceof TooManyPagesError) {
      throw validation({
        file: [
          `This PDF has ${err.pages} pages. A scheme of learning has far fewer; check that it is the right file.`,
        ],
      });
    }
    throw validation({
      file: ['This PDF could not be read. Check that it is the scheme-of-learning file.'],
    });
  }
  if (!extraction.rows.length) {
    throw validation({
      file: [
        'No scheme-of-learning tables were found in this PDF. Check that it is the right file.',
      ],
    });
  }
  const body = createImportBody.parse({
    termId: input.termId,
    fileName: input.fileName,
    checksum: extraction.checksum,
    notes: extraction.notes,
    weeks: extraction.weeks,
    rows: extraction.rows,
  });
  const staged = await createImport(actor, body);
  // The same file again returns the earlier import; one left staged by the old review flow
  // is accepted now.
  if (staged.batch.status === 'STAGED') {
    await acceptUpload(actor, staged.batch.id, { publish: input.publish });
    return { batch: await getImport(actor.schoolId, staged.batch.id), created: staged.created };
  }
  return staged;
}

export async function bulkApprove(
  actor: Actor,
  batchId: string,
  input: { flag: 'TRUNCATED'; note: string },
) {
  return prisma.$transaction(async (tx) => {
    const batch = await tx.importBatch.findFirst({
      where: { id: batchId, schoolId: actor.schoolId },
    });
    if (!batch) throw notFound('Import');
    if (batch.status !== 'STAGED') throw conflict('This import has already been processed');
    const { count } = await tx.importRow.updateMany({
      where: { batchId, decision: 'PENDING', flags: { equals: [input.flag] } },
      data: {
        decision: 'APPROVED',
        reviewNote: input.note,
        reviewedById: actor.userId,
        reviewedAt: new Date(),
      },
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: 'curriculum.rows_bulk_approved',
      entityType: 'ImportBatch',
      entityId: batchId,
      metadata: { flag: input.flag, approved: count, note: input.note },
      requestId: actor.requestId,
    });
    return { approved: count };
  });
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
  return prisma.$transaction((tx) => approveBatch(tx, actor, batchId, { acceptAll: false }), {
    timeout: 120_000,
  });
}

/**
 * The headmaster's upload: every row is accepted as printed and the scheme goes live at once.
 * Rows for subjects the system does not know are left out and counted in the report. Topics
 * are corrected afterwards (updateEntry). A school admin's upload stays a draft for the
 * headmaster to publish.
 */
export async function acceptUpload(actor: Actor, batchId: string, opts: { publish: boolean }) {
  return prisma.$transaction(
    async (tx) => {
      const approved = await approveBatch(tx, actor, batchId, { acceptAll: true });
      if (opts.publish) await publishInTx(tx, actor, approved.schemeId);
      return { ...approved, published: opts.publish };
    },
    { timeout: 120_000 },
  );
}

async function approveBatch(
  tx: Prisma.TransactionClient,
  actor: Actor,
  batchId: string,
  opts: { acceptAll: boolean },
) {
  const batch = await tx.importBatch.findFirst({
    where: { id: batchId, schoolId: actor.schoolId },
  });
  if (!batch) throw notFound('Import');
  if (batch.status !== 'STAGED') throw conflict('This import has already been processed');

  const subjects = await tx.subject.findMany({ where: { schoolId: null } });
  const subjectByCode = new Map(subjects.map((s) => [s.code, s]));
  const isKnown = (name: string) => {
    const code = subjectCodeFor(name);
    return !!code && subjectByCode.has(code);
  };

  if (opts.acceptAll) {
    const pending = await tx.importRow.findMany({
      where: { batchId, decision: 'PENDING' },
      select: { id: true, subjectName: true },
    });
    const unknownIds = pending.filter((r) => !isKnown(r.subjectName)).map((r) => r.id);
    const now = new Date();
    if (unknownIds.length) {
      await tx.importRow.updateMany({
        where: { id: { in: unknownIds } },
        data: {
          decision: 'REJECTED',
          reviewNote: 'Left out on upload: the subject is not one the system knows.',
          reviewedById: actor.userId,
          reviewedAt: now,
        },
      });
    }
    await tx.importRow.updateMany({
      where: { batchId, decision: 'PENDING' },
      data: {
        decision: 'APPROVED',
        reviewNote: 'Accepted as printed on upload.',
        reviewedById: actor.userId,
        reviewedAt: now,
      },
    });
  } else {
    const pendingFlagged = await tx.importRow.count({
      where: { batchId, decision: 'PENDING', NOT: { flags: { isEmpty: true } } },
    });
    if (pendingFlagged) {
      throw new AppError(
        'CONFLICT',
        `${pendingFlagged} flagged rows still need a review decision`,
        {
          pendingFlagged,
        },
      );
    }
  }

  const rows = await tx.importRow.findMany({
    where: { batchId },
    orderBy: { rowIndex: 'asc' },
  });

  const unknown = new Set<string>();
  for (const r of rows) {
    if (r.decision !== 'REJECTED' && !isKnown(r.subjectName)) unknown.add(r.subjectName);
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
  return prisma.$transaction((tx) => publishInTx(tx, actor, schemeId), { timeout: 120_000 });
}

async function publishInTx(tx: Prisma.TransactionClient, actor: Actor, schemeId: string) {
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
}

/**
 * Deletes an uploaded PDF with everything it created, so it (or a corrected file) can be
 * uploaded again. Refused once teachers have recorded lessons against its topics: uploading a
 * replacement instead archives it and keeps those records. When the live scheme is deleted,
 * the term's previous version (if any) goes live again; lessons are re-planned either way.
 */
export async function deleteImport(actor: Actor, batchId: string) {
  return prisma.$transaction(
    async (tx) => {
      const batch = await tx.importBatch.findFirst({
        where: { id: batchId, schoolId: actor.schoolId },
        include: { scheme: true },
      });
      if (!batch) throw notFound('Import');
      const scheme = batch.scheme;
      let restored: { id: string; version: number } | null = null;
      if (scheme) {
        const used = await tx.teachingRecordTopic.count({
          where: { entry: { schemeId: scheme.id } },
        });
        if (used) {
          throw new AppError(
            'CONFLICT',
            `Teachers have recorded lessons against topics from this PDF (${used} times), so it cannot be deleted. Upload the corrected PDF instead: it replaces this one and keeps those records.`,
            { used },
          );
        }
        await tx.curriculumEntry.deleteMany({ where: { schemeId: scheme.id } });
        await tx.curriculumWeek.deleteMany({ where: { schemeId: scheme.id } });
        await tx.curriculumScheme.delete({ where: { id: scheme.id } });
        if (scheme.status === 'PUBLISHED') {
          const previous = await tx.curriculumScheme.findFirst({
            where: { termId: scheme.termId, status: 'ARCHIVED' },
            orderBy: { version: 'desc' },
          });
          if (previous) {
            await tx.curriculumScheme.update({
              where: { id: previous.id },
              data: { status: 'PUBLISHED' },
            });
            await tx.curriculumEntry.updateMany({
              where: { schemeId: previous.id },
              data: { retiredAt: null },
            });
            restored = { id: previous.id, version: previous.version };
          }
          await syncSchoolAssignments(tx, actor.schoolId, { termId: scheme.termId });
        }
      }
      await tx.importRow.deleteMany({ where: { batchId } });
      await tx.importBatch.delete({ where: { id: batchId } });
      await audit(tx, {
        schoolId: actor.schoolId,
        actorId: actor.userId,
        action: 'curriculum.import_deleted',
        entityType: 'ImportBatch',
        entityId: batchId,
        metadata: {
          fileName: batch.fileName,
          schemeId: scheme?.id ?? null,
          wasLive: scheme?.status === 'PUBLISHED',
          restored,
        },
        requestId: actor.requestId,
      });
      return { restored };
    },
    { timeout: 120_000 },
  );
}

// ---------- Editing topics ----------

/**
 * Corrects one topic of a live or draft scheme. Lesson records point at topics, so a fix to
 * the wording shows on them too; moving a topic another week is refused once lessons have
 * been recorded against it, because those records belong to the week they were taught in.
 */
export async function updateEntry(
  actor: Actor,
  entryId: string,
  input: z.infer<typeof updateEntryBody>,
) {
  return prisma.$transaction(async (tx) => {
    const entry = await tx.curriculumEntry.findFirst({
      where: { id: entryId, schoolId: actor.schoolId },
      include: { scheme: { select: { status: true } }, _count: { select: { topics: true } } },
    });
    if (!entry) throw notFound('Topic');
    if (entry.scheme.status === 'ARCHIVED' || entry.retiredAt) {
      throw conflict('This topic belongs to an older scheme and can no longer be changed');
    }
    const next = {
      strand: input.strand ?? entry.strand,
      subStrand: input.subStrand ?? entry.subStrand,
      contentStandard: input.contentStandard ?? entry.contentStandard,
      indicator: input.indicator ?? entry.indicator,
      weekNumber: input.weekNumber ?? entry.weekNumber,
    };
    if (next.weekNumber !== entry.weekNumber && entry._count.topics) {
      throw conflict(
        'Lessons have already been recorded against this topic, so it cannot move to another week',
      );
    }
    const updated = await tx.curriculumEntry.update({
      where: { id: entry.id },
      data: {
        ...next,
        isTruncated: /(\.{4,}|…)/.test(`${next.contentStandard} ${next.indicator}`),
        naturalKey: naturalKey(entry.level, entry.subjectId, next.weekNumber, next),
      },
      select: entrySelect,
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: 'curriculum.topic_edited',
      entityType: 'CurriculumEntry',
      entityId: entry.id,
      metadata: {
        before: {
          strand: entry.strand,
          subStrand: entry.subStrand,
          contentStandard: entry.contentStandard,
          indicator: entry.indicator,
          weekNumber: entry.weekNumber,
        },
        after: next,
      },
      requestId: actor.requestId,
    });
    return updated;
  });
}

/** Removes one topic, for example a row the PDF repeated or misread. */
export async function deleteEntry(actor: Actor, entryId: string) {
  await prisma.$transaction(async (tx) => {
    const entry = await tx.curriculumEntry.findFirst({
      where: { id: entryId, schoolId: actor.schoolId },
      include: { scheme: { select: { status: true } }, _count: { select: { topics: true } } },
    });
    if (!entry) throw notFound('Topic');
    if (entry.scheme.status === 'ARCHIVED' || entry.retiredAt) {
      throw conflict('This topic belongs to an older scheme and can no longer be changed');
    }
    if (entry._count.topics) {
      throw conflict(
        'Lessons have already been recorded against this topic, so it cannot be deleted. Edit its wording instead.',
      );
    }
    await tx.curriculumEntry.delete({ where: { id: entry.id } });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: 'curriculum.topic_deleted',
      entityType: 'CurriculumEntry',
      entityId: entry.id,
      metadata: {
        level: entry.level,
        subjectId: entry.subjectId,
        weekNumber: entry.weekNumber,
        strand: entry.strand,
        indicator: entry.indicator,
      },
      requestId: actor.requestId,
    });
  });
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
