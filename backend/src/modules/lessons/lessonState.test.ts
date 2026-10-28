import { describe, expect, it } from 'vitest';
import { lessonState, nextSchoolDay } from './lessonState.js';
import { localNow } from '../../lib/dates.js';
import { lastSchoolDayOnOrBefore } from './lessons.service.js';

const none = new Set<string>();
const base = {
  startMinute: 8 * 60,
  status: 'SCHEDULED' as const,
  hasSubmittedRecord: false,
  weekNumber: 1,
};

describe('nextSchoolDay', () => {
  it('skips weekends', () => {
    expect(nextSchoolDay('2026-10-23', none)).toBe('2026-10-26'); // Friday -> Monday
  });
  it('skips holidays and closures', () => {
    expect(nextSchoolDay('2026-10-23', new Set(['2026-10-26', '2026-10-27']))).toBe('2026-10-28');
  });
});

describe('lessonState', () => {
  it('is upcoming before the start time and due from the start time (no grace period)', () => {
    const lesson = { ...base, date: '2026-10-27' };
    expect(lessonState(lesson, { date: '2026-10-27', minutes: 479 }, none)).toBe('UPCOMING');
    expect(lessonState(lesson, { date: '2026-10-27', minutes: 480 }, none)).toBe('DUE');
  });

  it('becomes overdue at 00:00 on the next school day', () => {
    const lesson = { ...base, date: '2026-10-27' }; // Tuesday
    expect(lessonState(lesson, { date: '2026-10-27', minutes: 1439 }, none)).toBe('DUE');
    expect(lessonState(lesson, { date: '2026-10-28', minutes: 0 }, none)).toBe('OVERDUE');
  });

  it('is never overdue over a weekend', () => {
    const friday = { ...base, date: '2026-10-23' };
    expect(lessonState(friday, { date: '2026-10-24', minutes: 600 }, none)).toBe('DUE');
    expect(lessonState(friday, { date: '2026-10-25', minutes: 600 }, none)).toBe('DUE');
    expect(lessonState(friday, { date: '2026-10-26', minutes: 0 }, none)).toBe('OVERDUE');
  });

  it('waits past a holiday before becoming overdue', () => {
    const friday = { ...base, date: '2026-10-23' };
    const holiday = new Set(['2026-10-26']);
    expect(lessonState(friday, { date: '2026-10-26', minutes: 600 }, holiday)).toBe('DUE');
    expect(lessonState(friday, { date: '2026-10-27', minutes: 0 }, holiday)).toBe('OVERDUE');
  });

  it('reports completed, cancelled, rescheduled and waived lessons as such', () => {
    const now = { date: '2026-11-30', minutes: 0 };
    expect(lessonState({ ...base, date: '2026-10-20', hasSubmittedRecord: true }, now, none)).toBe(
      'COMPLETED',
    );
    expect(lessonState({ ...base, date: '2026-10-20', status: 'CANCELLED' }, now, none)).toBe(
      'CANCELLED',
    );
    expect(lessonState({ ...base, date: '2026-10-20', status: 'RESCHEDULED' }, now, none)).toBe(
      'RESCHEDULED',
    );
    expect(lessonState({ ...base, date: '2026-10-20', status: 'WAIVED' }, now, none)).toBe(
      'WAIVED',
    );
  });

  it('never marks lessons beyond the scheme as overdue', () => {
    expect(
      lessonState(
        { ...base, date: '2026-10-20', weekNumber: null },
        { date: '2026-11-30', minutes: 0 },
        none,
      ),
    ).toBe('DUE');
  });
});

describe('lastSchoolDayOnOrBefore agrees with nextSchoolDay', () => {
  it('a lesson is overdue exactly when its date is before the last school day', () => {
    const closed = new Set(['2026-10-26']);
    for (const today of ['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28']) {
      for (const date of ['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-27']) {
        if (date > today) continue;
        const viaState =
          lessonState({ ...base, date, startMinute: 0 }, { date: today, minutes: 0 }, closed) ===
          'OVERDUE';
        const viaFilter = date < lastSchoolDayOnOrBefore(today, closed);
        expect(viaFilter, `${date} on ${today}`).toBe(viaState);
      }
    }
  });
});

describe('localNow in Africa/Accra', () => {
  it('uses GMT with no daylight saving', () => {
    expect(localNow('Africa/Accra', new Date('2026-07-01T23:59:00Z'))).toEqual({
      date: '2026-07-01',
      minutes: 1439,
    });
    expect(localNow('Africa/Accra', new Date('2026-12-31T00:00:00Z'))).toEqual({
      date: '2026-12-31',
      minutes: 0,
    });
  });
});
