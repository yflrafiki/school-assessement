// Pure pacing: decides which curriculum week each lesson of one assignment belongs to.
// No database access, so every rule is unit-testable.

export interface PacingLesson {
  id: string;
  /** Sort key: lesson date (YYYY-MM-DD) then start minute. */
  date: string;
  startMinute: number;
  status: 'SCHEDULED' | 'CANCELLED' | 'RESCHEDULED' | 'WAIVED';
  /** A submitted record freezes the lesson to its current week. */
  hasSubmittedRecord: boolean;
  currentWeek: number | null;
}

export interface PacingResult {
  /** Lesson id -> curriculum week, or null when cancelled, rescheduled or beyond the scheme. */
  weeks: Map<string, number | null>;
  /** Required lesson slots that the remaining lessons cannot fill. */
  shortfall: number;
}

/**
 * Lessons in date order fill the earliest required week with free capacity (N per week).
 * Cancelled and rescheduled lessons leave the sequence. Lessons with a submitted record,
 * and waived lessons, keep the week they already hold.
 */
export function paceLessons(
  lessons: PacingLesson[],
  requiredWeeks: number[],
  perWeek: number,
): PacingResult {
  const weeks = new Map<string, number | null>();
  const required = [...new Set(requiredWeeks)].sort((a, b) => a - b);
  const capacity = new Map<number, number>(required.map((w) => [w, perWeek]));

  const ordered = [...lessons].sort((a, b) =>
    a.date === b.date
      ? a.startMinute - b.startMinute || a.id.localeCompare(b.id)
      : a.date < b.date
        ? -1
        : 1,
  );

  // Submitted work never moves, even if its week later stops being required.
  const isFrozen = (l: PacingLesson) =>
    (l.hasSubmittedRecord || l.status === 'WAIVED') && l.currentWeek !== null;

  // Frozen lessons claim their capacity first so moving lessons never displace them.
  for (const l of ordered) {
    if (l.status === 'CANCELLED' || l.status === 'RESCHEDULED') {
      // A submitted record on a lesson that later left the sequence still keeps its week.
      weeks.set(l.id, l.hasSubmittedRecord ? l.currentWeek : null);
      continue;
    }
    if (isFrozen(l)) {
      const week = l.currentWeek as number;
      weeks.set(l.id, week);
      capacity.set(week, (capacity.get(week) ?? 0) - 1);
    }
  }

  for (const l of ordered) {
    if (weeks.has(l.id)) continue;
    const week = required.find((w) => (capacity.get(w) ?? 0) > 0);
    if (week === undefined) {
      weeks.set(l.id, null);
      continue;
    }
    weeks.set(l.id, week);
    capacity.set(week, (capacity.get(week) ?? 0) - 1);
  }

  let shortfall = 0;
  for (const left of capacity.values()) shortfall += Math.max(0, left);
  return { weeks, shortfall };
}

export interface WeekLesson {
  weekNumber: number | null;
  status: PacingLesson['status'];
  hasSubmittedRecord: boolean;
}

/** A week is complete when it holds N lessons and every one is completed or waived. */
export function isWeekComplete(week: number, lessons: WeekLesson[], perWeek: number): boolean {
  const inWeek = lessons.filter(
    (l) => l.weekNumber === week && (l.status === 'SCHEDULED' || l.status === 'WAIVED'),
  );
  if (perWeek <= 0 || inWeek.length < perWeek) return false;
  return inWeek.every((l) => l.status === 'WAIVED' || l.hasSubmittedRecord);
}
