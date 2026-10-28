import type { LessonState, LessonStatus } from '@school/shared';
import { addDays, isWeekend } from '../../lib/dates.js';

/** The first weekday after `date` that is not a holiday or closure. */
export function nextSchoolDay(date: string, closedDates: ReadonlySet<string>): string {
  let d = addDays(date, 1);
  // A term never has a year of consecutive closures; the bound only guards bad data.
  for (let i = 0; i < 366; i += 1) {
    if (!isWeekend(d) && !closedDates.has(d)) return d;
    d = addDays(d, 1);
  }
  return d;
}

export interface StateInput {
  date: string;
  startMinute: number;
  status: LessonStatus;
  hasSubmittedRecord: boolean;
  /** Lessons beyond the scheme cannot be recorded, so they never become overdue. */
  weekNumber: number | null;
}

/**
 * Due from the scheduled start time, overdue from 00:00 on the next school day
 * when no record has been submitted. Times are local to the school.
 */
export function lessonState(
  lesson: StateInput,
  now: { date: string; minutes: number },
  closedDates: ReadonlySet<string>,
): LessonState {
  switch (lesson.status) {
    case 'CANCELLED':
      return 'CANCELLED';
    case 'RESCHEDULED':
      return 'RESCHEDULED';
    case 'WAIVED':
      return 'WAIVED';
    case 'SCHEDULED':
      break;
  }
  if (lesson.hasSubmittedRecord) return 'COMPLETED';
  if (lesson.date > now.date || (lesson.date === now.date && lesson.startMinute > now.minutes)) {
    return 'UPCOMING';
  }
  if (lesson.weekNumber === null) return 'DUE';
  return now.date >= nextSchoolDay(lesson.date, closedDates) ? 'OVERDUE' : 'DUE';
}
