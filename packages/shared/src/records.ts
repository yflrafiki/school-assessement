import { z } from 'zod';
import { LEVELS, RECORD_STATUSES } from './enums.js';
import { isoDate, optionalText, paginationQuery, uuid } from './common.js';

export const RECORD_EDIT_WINDOW_HOURS = 48;

export const submitRecordBody = z.object({
  lessonId: uuid,
  entryIds: z.array(uuid).max(30).default([]),
  taughtSummary: z
    .string()
    .trim()
    .min(10, 'Describe what was taught (at least 10 characters)')
    .max(4000),
  topicNote: optionalText(500),
  outcomes: optionalText(2000),
  challenges: optionalText(2000),
  remarks: optionalText(2000),
  status: z.enum(RECORD_STATUSES),
});
export type SubmitRecordBody = z.infer<typeof submitRecordBody>;

/** Drafts may be saved with a shorter summary. */
export const draftRecordBody = submitRecordBody.extend({
  taughtSummary: z.string().trim().max(4000),
});

export const editRecordBody = z.object({
  taughtSummary: z.string().trim().min(10).max(4000).optional(),
  topicNote: optionalText(500),
  outcomes: optionalText(2000),
  challenges: optionalText(2000),
  remarks: optionalText(2000),
});

export const listRecordsQuery = paginationQuery.extend({
  q: z.string().trim().max(100).optional(),
  teacherProfileId: uuid.optional(),
  level: z.enum(LEVELS).optional(),
  subjectId: uuid.optional(),
  classId: uuid.optional(),
  weekNumber: z.coerce.number().int().min(1).max(20).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  status: z.enum(RECORD_STATUSES).optional(),
  completion: z.enum(['ON_TIME', 'LATE']).optional(),
  sort: z.enum(['-lessonDate', 'lessonDate', '-submittedAt', 'submittedAt']).default('-lessonDate'),
});
export type ListRecordsQuery = z.infer<typeof listRecordsQuery>;

export const notificationsQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  unreadOnly: z.enum(['true', 'false']).optional(),
});
