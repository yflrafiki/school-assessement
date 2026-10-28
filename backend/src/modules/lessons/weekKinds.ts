import { REQUIRED_WEEK_KINDS, type Level, type WeekKind } from '@school/shared';
import type { Db } from '../../lib/db.js';
import { fromDbDate } from '../../lib/dates.js';

export interface TermCalendar {
  termId: string;
  /** Term week number -> its date window. */
  termWeeks: { weekNumber: number; startDate: string; endDate: string }[];
  /** Effective kind per week number for one class. */
  kinds: Map<number, WeekKind>;
  /** Weeks of kind TEACHING or REVISION, ascending. */
  requiredWeeks: number[];
  schemeId: string | null;
}

/**
 * Effective week kind: a class policy beats a level policy, which beats the
 * published scheme's default for the level. Weeks with none of these are TEACHING.
 */
export async function loadTermCalendar(
  db: Db,
  schoolId: string,
  termId: string,
  classId: string,
  level: Level,
): Promise<TermCalendar> {
  // Sequential on purpose: callers often pass a transaction, which runs one query at a time.
  const termWeeks = await db.termWeek.findMany({
    where: { schoolId, termId },
    orderBy: { weekNumber: 'asc' },
  });
  const scheme = await db.curriculumScheme.findFirst({
    where: { schoolId, termId, status: 'PUBLISHED' },
    include: { weeks: { where: { level } } },
  });
  const policies = await db.weekPolicy.findMany({
    where: { schoolId, termId, OR: [{ classId }, { level, classId: null }] },
  });

  const kinds = new Map<number, WeekKind>();
  const numbers = new Set<number>(termWeeks.map((w) => w.weekNumber));
  for (const w of scheme?.weeks ?? []) {
    numbers.add(w.weekNumber);
    kinds.set(w.weekNumber, w.kind);
  }
  for (const n of numbers) if (!kinds.has(n)) kinds.set(n, 'TEACHING');
  for (const p of policies.filter((p) => p.level !== null)) kinds.set(p.weekNumber, p.kind);
  for (const p of policies.filter((p) => p.classId !== null)) kinds.set(p.weekNumber, p.kind);

  const requiredWeeks = [...kinds.entries()]
    .filter(([, kind]) => REQUIRED_WEEK_KINDS.includes(kind))
    .map(([n]) => n)
    .sort((a, b) => a - b);

  return {
    termId,
    termWeeks: termWeeks.map((w) => ({
      weekNumber: w.weekNumber,
      startDate: fromDbDate(w.startDate),
      endDate: fromDbDate(w.endDate),
    })),
    kinds,
    requiredWeeks,
    schemeId: scheme?.id ?? null,
  };
}

/** The term week whose window contains the date, if any. */
export function termWeekOf(calendar: TermCalendar, date: string): number | null {
  const w = calendar.termWeeks.find((tw) => tw.startDate <= date && date <= tw.endDate);
  return w ? w.weekNumber : null;
}

/** Mock and examination weeks need no lessons; lessons dated in them are cancelled. */
export function isSpecialWeekDate(calendar: TermCalendar, date: string): boolean {
  const week = termWeekOf(calendar, date);
  if (week === null) return false;
  const kind = calendar.kinds.get(week);
  return kind === 'MOCK' || kind === 'EXAMINATION';
}
