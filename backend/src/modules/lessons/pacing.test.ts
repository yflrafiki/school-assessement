import { describe, expect, it } from 'vitest';
import { isWeekComplete, paceLessons, type PacingLesson } from './pacing.js';

/** Two lessons a week (Mon, Wed) for `weeks` weeks starting on a Monday. */
function lessons(weeks: number, start = '2026-09-07'): PacingLesson[] {
  const out: PacingLesson[] = [];
  const base = new Date(`${start}T00:00:00Z`);
  for (let w = 0; w < weeks; w += 1) {
    for (const offset of [0, 2]) {
      const d = new Date(base);
      d.setUTCDate(d.getUTCDate() + w * 7 + offset);
      const date = d.toISOString().slice(0, 10);
      out.push({
        id: `${date}`,
        date,
        startMinute: 480,
        status: 'SCHEDULED',
        hasSubmittedRecord: false,
        currentWeek: null,
      });
    }
  }
  return out;
}

const weeksOf = (r: ReturnType<typeof paceLessons>, ls: PacingLesson[]) =>
  ls.map((l) => r.weeks.get(l.id));

describe('paceLessons', () => {
  it('fills weeks in date order, N lessons per week', () => {
    const ls = lessons(3);
    const r = paceLessons(ls, [1, 2, 3], 2);
    expect(weeksOf(r, ls)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(r.shortfall).toBe(0);
  });

  it('skips non-required weeks (Basic 9 mock week 11)', () => {
    const ls = lessons(2);
    const r = paceLessons(ls, [10, 12], 2);
    expect(weeksOf(r, ls)).toEqual([10, 10, 12, 12]);
  });

  it('shifts the curriculum later when a lesson is cancelled (holiday)', () => {
    const ls = lessons(3);
    ls[1]!.status = 'CANCELLED';
    const r = paceLessons(ls, [1, 2, 3], 2);
    expect(weeksOf(r, ls)).toEqual([1, null, 1, 2, 2, 3]);
    expect(r.shortfall).toBe(1);
  });

  it('treats rescheduled lessons like cancelled ones; the replacement joins the sequence', () => {
    const ls = lessons(2);
    ls[0]!.status = 'RESCHEDULED';
    ls.push({
      id: 'replacement',
      date: '2026-09-08',
      startMinute: 600,
      status: 'SCHEDULED',
      hasSubmittedRecord: false,
      currentWeek: null,
    });
    const r = paceLessons(ls, [1, 2], 2);
    expect(r.weeks.get(ls[0]!.id)).toBeNull();
    expect(r.weeks.get('replacement')).toBe(1);
    expect(r.weeks.get(ls[1]!.id)).toBe(1);
  });

  it('keeps waived lessons in place (content skipped)', () => {
    const ls = lessons(2);
    ls[0]!.status = 'WAIVED';
    ls[0]!.currentWeek = 1;
    const r = paceLessons(ls, [1, 2], 2);
    expect(weeksOf(r, ls)).toEqual([1, 1, 2, 2]);
  });

  it('never moves a lesson with a submitted record', () => {
    const ls = lessons(2);
    ls[2]!.hasSubmittedRecord = true;
    ls[2]!.currentWeek = 2;
    ls[0]!.status = 'CANCELLED';
    const r = paceLessons(ls, [1, 2], 2);
    // Week 2's frozen lesson stays; the others fill the earliest free capacity.
    expect(r.weeks.get(ls[2]!.id)).toBe(2);
    expect(r.weeks.get(ls[1]!.id)).toBe(1);
    expect(r.weeks.get(ls[3]!.id)).toBe(1);
  });

  it('marks lessons beyond the scheme as null', () => {
    const ls = lessons(3);
    const r = paceLessons(ls, [1, 2], 2);
    expect(weeksOf(r, ls)).toEqual([1, 1, 2, 2, null, null]);
  });

  it('reports a shortfall when lessons cannot fill the remaining weeks', () => {
    const ls = lessons(1);
    const r = paceLessons(ls, [1, 2, 3], 2);
    expect(r.shortfall).toBe(4);
  });

  it('is deterministic regardless of input order', () => {
    const ls = lessons(3);
    const a = paceLessons(ls, [1, 2, 3], 2);
    const b = paceLessons([...ls].reverse(), [1, 2, 3], 2);
    expect([...a.weeks.entries()].sort()).toEqual([...b.weeks.entries()].sort());
  });
});

describe('isWeekComplete', () => {
  const l = (weekNumber: number, status: PacingLesson['status'], hasSubmittedRecord: boolean) => ({
    weekNumber,
    status,
    hasSubmittedRecord,
  });

  it('needs N lessons, each completed or waived', () => {
    expect(isWeekComplete(1, [l(1, 'SCHEDULED', true), l(1, 'WAIVED', false)], 2)).toBe(true);
    expect(isWeekComplete(1, [l(1, 'SCHEDULED', true), l(1, 'SCHEDULED', false)], 2)).toBe(false);
  });

  it('is incomplete when the week holds fewer than N lessons', () => {
    expect(isWeekComplete(1, [l(1, 'SCHEDULED', true)], 2)).toBe(false);
  });

  it('ignores cancelled lessons', () => {
    expect(
      isWeekComplete(
        1,
        [l(1, 'SCHEDULED', true), l(1, 'SCHEDULED', true), l(1, 'CANCELLED', false)],
        2,
      ),
    ).toBe(true);
  });
});
