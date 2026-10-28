import { z } from 'zod';
import { IMPORT_FLAGS, LEVELS, WEEK_KINDS } from './enums.js';
import { paginationQuery, uuid } from './common.js';

/** One row produced by the PDF extractor (tools/curriculum-extract). */
export const extractedRow = z.object({
  level: z.enum(LEVELS),
  subject: z.string().min(1).max(100),
  weekNumber: z.number().int().min(1).max(20),
  strand: z.string().max(500).default(''),
  subStrand: z.string().max(500).default(''),
  contentStandard: z.string().max(4000).default(''),
  indicator: z.string().max(4000).default(''),
  sourcePage: z.number().int().min(1).max(500),
  flags: z.array(z.enum(IMPORT_FLAGS)).default([]),
});
export type ExtractedRow = z.infer<typeof extractedRow>;

export const extractedWeek = z.object({
  level: z.enum(LEVELS),
  weekNumber: z.number().int().min(1).max(20),
  kind: z.enum(WEEK_KINDS),
  label: z.string().max(100).optional(),
});

export const createImportBody = z.object({
  termId: uuid,
  fileName: z.string().min(1).max(200),
  checksum: z.string().regex(/^[a-f0-9]{64}$/, 'SHA-256 hex checksum'),
  notes: z.array(z.string().max(1000)).max(50).default([]),
  weeks: z.array(extractedWeek).min(1).max(100),
  rows: z.array(extractedRow).min(1).max(10000),
});
export type CreateImportBody = z.infer<typeof createImportBody>;

export const reviewImportRowBody = z.object({
  decision: z.enum(['APPROVED', 'CORRECTED', 'REJECTED']),
  note: z.string().trim().max(1000).optional(),
  corrected: z
    .object({
      strand: z.string().max(500).optional(),
      subStrand: z.string().max(500).optional(),
      contentStandard: z.string().max(4000).optional(),
      indicator: z.string().max(4000).optional(),
      weekNumber: z.number().int().min(1).max(20).optional(),
    })
    .optional(),
});

export const listImportRowsQuery = paginationQuery.extend({
  flagged: z.enum(['true', 'false']).optional(),
  decision: z.enum(['PENDING', 'APPROVED', 'CORRECTED', 'REJECTED']).optional(),
  level: z.enum(LEVELS).optional(),
  subject: z.string().max(100).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const curriculumQuery = z.object({
  termId: uuid.optional(),
  level: z.enum(LEVELS).optional(),
  subjectId: uuid.optional(),
  weekNumber: z.coerce.number().int().min(1).max(20).optional(),
});
