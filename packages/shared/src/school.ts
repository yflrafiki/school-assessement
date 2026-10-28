import { z } from 'zod';
import { CALENDAR_DAY_KINDS, LEVELS, WEEK_KINDS } from './enums.js';
import { isoDate, trimmed, uuid } from './common.js';

const endAfterStart = (v: { startDate: string; endDate: string }) => v.startDate <= v.endDate;
const endAfterStartIssue = {
  message: 'End date must be on or after start date',
  path: ['endDate'],
};

export const createAcademicYearBody = z
  .object({
    name: z
      .string()
      .trim()
      .regex(/^\d{4}\/\d{4}$/, 'Use the form 2026/2027'),
    startDate: isoDate,
    endDate: isoDate,
  })
  .refine(endAfterStart, endAfterStartIssue);

export const createTermBody = z
  .object({
    academicYearId: uuid,
    number: z.number().int().min(1).max(3),
    name: trimmed(1, 60),
    startDate: isoDate,
    endDate: isoDate,
  })
  .refine(endAfterStart, endAfterStartIssue);

export const updateTermBody = z.object({
  name: trimmed(1, 60).optional(),
  isCurrent: z.boolean().optional(),
});

export const termWeeksBody = z.object({
  weeks: z
    .array(
      z.object({
        weekNumber: z.number().int().min(1).max(20),
        startDate: isoDate,
        endDate: isoDate,
      }),
    )
    .min(1)
    .max(20),
});

export const createClassBody = z.object({
  level: z.enum(LEVELS),
  name: trimmed(1, 40),
});

export const updateClassBody = z.object({
  name: trimmed(1, 40).optional(),
  isActive: z.boolean().optional(),
});

export const createLanguageBody = z.object({
  name: trimmed(2, 60),
});

export const updateSubjectBody = z.object({
  name: trimmed(2, 60).optional(),
  isActive: z.boolean().optional(),
});

export const createCalendarDayBody = z.object({
  date: isoDate,
  kind: z.enum(CALENDAR_DAY_KINDS),
  description: trimmed(2, 200),
});

export const weekPolicyBody = z
  .object({
    termId: uuid,
    weekNumber: z.number().int().min(1).max(20),
    level: z.enum(LEVELS).optional(),
    classId: uuid.optional(),
    kind: z.enum(WEEK_KINDS).nullable(),
    note: z.string().trim().max(200).optional(),
  })
  .refine((v) => (v.level ? 1 : 0) + (v.classId ? 1 : 0) === 1, {
    message: 'Choose either a level or a class',
    path: ['level'],
  });
export type WeekPolicyBody = z.infer<typeof weekPolicyBody>;

export const createSchoolBody = z.object({
  name: trimmed(2, 160),
  timezone: z.string().default('Africa/Accra'),
});
