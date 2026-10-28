// Mirrors the Prisma enums. Kept here so the web app never imports the database client.

export const ROLES = ['TEACHER', 'HEADMASTER', 'SCHOOL_ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export const USER_STATUSES = ['PENDING_ACTIVATION', 'ACTIVE', 'DEACTIVATED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const LEVELS = ['BASIC_7', 'BASIC_8', 'BASIC_9'] as const;
export type Level = (typeof LEVELS)[number];

export const LEVEL_LABELS: Record<Level, string> = {
  BASIC_7: 'Basic 7',
  BASIC_8: 'Basic 8',
  BASIC_9: 'Basic 9',
};

export const WEEK_KINDS = ['TEACHING', 'REVISION', 'MOCK', 'EXAMINATION'] as const;
export type WeekKind = (typeof WEEK_KINDS)[number];

/** Week kinds that require lessons and records, and can therefore block later weeks. */
export const REQUIRED_WEEK_KINDS: readonly WeekKind[] = ['TEACHING', 'REVISION'];

export const CALENDAR_DAY_KINDS = ['HOLIDAY', 'CLOSURE'] as const;
export type CalendarDayKind = (typeof CALENDAR_DAY_KINDS)[number];

export const LESSON_STATUSES = ['SCHEDULED', 'CANCELLED', 'RESCHEDULED', 'WAIVED'] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];

export const CANCEL_REASONS = [
  'HOLIDAY',
  'SPECIAL_WEEK',
  'ABSENCE',
  'SCHOOL_CANCELLATION',
] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

/** Derived lesson state shown to users. */
export const LESSON_STATES = [
  'COMPLETED',
  'WAIVED',
  'CANCELLED',
  'RESCHEDULED',
  'UPCOMING',
  'DUE',
  'OVERDUE',
] as const;
export type LessonState = (typeof LESSON_STATES)[number];

export const RECORD_STATUSES = ['DRAFT', 'SUBMITTED'] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

export const SCHEME_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type SchemeStatus = (typeof SCHEME_STATUSES)[number];

export const IMPORT_FLAGS = [
  'TRUNCATED',
  'CODE_LEVEL_MISMATCH',
  'MERGED_CELL_INHERITED',
  'OCR_OR_SPACING_NOISE',
  'UNREADABLE',
] as const;
export type ImportFlag = (typeof IMPORT_FLAGS)[number];

export const IMPORT_ROW_DECISIONS = ['PENDING', 'APPROVED', 'CORRECTED', 'REJECTED'] as const;
export type ImportRowDecision = (typeof IMPORT_ROW_DECISIONS)[number];

export const WEEKDAYS = [1, 2, 3, 4, 5] as const;
export const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
};
