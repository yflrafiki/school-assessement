import { z } from 'zod';
import { LESSON_STATES, LEVELS } from './enums.js';
import { isoDate, paginationQuery, timeOfDay, timeToMinutes, trimmed, uuid } from './common.js';

export const timetableEntryBody = z
  .object({
    assignmentId: uuid,
    weekday: z.number().int().min(1).max(5),
    startTime: timeOfDay,
    endTime: timeOfDay,
    validFrom: isoDate.optional(),
    validTo: isoDate.optional(),
  })
  .refine((v) => timeToMinutes(v.startTime) < timeToMinutes(v.endTime), {
    message: 'End time must be after start time',
    path: ['endTime'],
  });
export type TimetableEntryBody = z.infer<typeof timetableEntryBody>;

export const updateTimetableEntryBody = z.object({
  weekday: z.number().int().min(1).max(5).optional(),
  startTime: timeOfDay.optional(),
  endTime: timeOfDay.optional(),
  validFrom: isoDate.optional(),
  validTo: isoDate.optional(),
});

/** One lesson slot read from an uploaded timetable file (the browser turns the file into rows). */
export const timetableImportRow = z.object({
  className: z.string().trim().min(1).max(40),
  subject: z.string().trim().min(1).max(100),
  weekday: z.number().int().min(1).max(5),
  startTime: timeOfDay,
  endTime: timeOfDay,
});
export type TimetableImportRow = z.infer<typeof timetableImportRow>;

export const importTimetableBody = z.object({
  termId: uuid,
  rows: z.array(timetableImportRow).min(1).max(2000),
  /** Check only: nothing is saved, every row comes back with its match or problem. */
  dryRun: z.boolean().default(true),
});

export const listTimetableQuery = z.object({
  termId: uuid.optional(),
  classId: uuid.optional(),
  teacherProfileId: uuid.optional(),
});

export const publishTimetableBody = z.object({
  termId: uuid,
  /** Must be true when publishing changes the weekly lesson count of an assignment with records. */
  confirmRepace: z.boolean().default(false),
  dryRun: z.boolean().default(false),
});

export const listLessonsQuery = paginationQuery.extend({
  date: isoDate.optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  teacherProfileId: uuid.optional(),
  classId: uuid.optional(),
  subjectId: uuid.optional(),
  level: z.enum(LEVELS).optional(),
  state: z.enum(LESSON_STATES).optional(),
  assignmentId: uuid.optional(),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListLessonsQuery = z.infer<typeof listLessonsQuery>;

export const cancelLessonBody = z.object({
  reason: trimmed(3, 300),
});

export const rescheduleLessonBody = z
  .object({
    date: isoDate,
    startTime: timeOfDay,
    endTime: timeOfDay,
    reason: trimmed(3, 300),
  })
  .refine((v) => timeToMinutes(v.startTime) < timeToMinutes(v.endTime), {
    message: 'End time must be after start time',
    path: ['endTime'],
  });

export const waiveLessonBody = z.object({
  reason: trimmed(3, 300),
});

/** Starting to use the system part-way through a term: earlier lessons need no records. */
export const waiveBeforeBody = z.object({
  termId: uuid,
  date: isoDate,
  reason: trimmed(3, 300).default('Before the school started recording lessons in the system'),
});

export const createAbsenceBody = z
  .object({
    teacherProfileId: uuid,
    startDate: isoDate,
    endDate: isoDate,
    reason: trimmed(3, 300),
  })
  .refine((v) => v.startDate <= v.endDate, {
    message: 'End date must be on or after start date',
    path: ['endDate'],
  });

export const dailyBoardQuery = z.object({
  date: isoDate.optional(),
});
