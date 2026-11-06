import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db.js';
import { addDays } from '../src/lib/dates.js';
import {
  createActiveTeacher,
  createSchoolWithHeadmaster,
  expectOk,
  resetDb,
  setupTerm,
  subjectId,
} from './helpers.js';

beforeEach(resetDb);

describe('changing a term’s dates', () => {
  it('moves the timetable and lessons with the term, and keeps the weeks inside it', async () => {
    const { client: head } = await createSchoolWithHeadmaster();
    const { termId, start, end, weeks } = await setupTerm(head, 0);
    const cls = expectOk(await head.post('/classes', { level: 'BASIC_7', name: 'FORM 1' }));
    const { teacher } = await createActiveTeacher(head, {
      fullName: 'Kofi Boateng',
      email: 'kofi@test.example',
      staffId: 'GES-1',
      assignments: [{ subjectId: await subjectId(head, 'Mathematics'), classId: cls.body.data.id }],
    });
    const assignmentId = expectOk(await head.get(`/assignments?teacherProfileId=${teacher.id}`))
      .body.data[0].id as string;
    expectOk(
      await head.post('/timetable-entries', {
        assignmentId,
        weekday: 1,
        startTime: '08:00',
        endTime: '09:00',
      }),
    );
    expectOk(await head.post('/timetable/publish', { termId }));
    const before = await prisma.lesson.count({ where: { assignmentId } });

    // Shrinking past week 14 is refused, naming the week.
    const shrink = await head.patch(`/terms/${termId}`, {
      endDate: addDays(weeks[13]!.endDate, -1),
    });
    expect(shrink.status).toBe(422);
    expect(shrink.body.error.details.fields.endDate[0]).toMatch(/Week 14 would fall outside/);

    // Outside the academic year is refused.
    const far = await head.patch(`/terms/${termId}`, { endDate: '2099-01-01' });
    expect(far.status).toBe(422);

    // A week longer: the slot runs to the new end and gets one more Monday lesson.
    const newEnd = addDays(end, 7);
    const res = expectOk(await head.patch(`/terms/${termId}`, { endDate: newEnd }));
    expect(res.body.data).toMatchObject({ startDate: start, endDate: newEnd });
    const slot = await prisma.timetableEntry.findFirstOrThrow({ where: { assignmentId } });
    expect(slot.validTo.toISOString().slice(0, 10)).toBe(newEnd);
    expect(await prisma.lesson.count({ where: { assignmentId } })).toBe(before + 1);

    // Now a week 15 fits.
    expectOk(
      await head.put(`/terms/${termId}/weeks`, {
        weeks: [
          ...weeks,
          {
            weekNumber: 15,
            startDate: addDays(weeks[13]!.startDate, 7),
            endDate: addDays(weeks[13]!.endDate, 7),
          },
        ],
      }),
    );
  });

  it('explains week problems with their dates and how to fix them', async () => {
    const { client: head } = await createSchoolWithHeadmaster();
    const { termId, weeks, end } = await setupTerm(head, 0);
    const res = await head.put(`/terms/${termId}/weeks`, {
      weeks: [
        ...weeks.slice(0, 12),
        { weekNumber: 13, startDate: weeks[12]!.startDate, endDate: weeks[12]!.endDate },
        // Moved earlier to squeeze in, and still running past the term.
        { weekNumber: 14, startDate: weeks[12]!.endDate, endDate: addDays(end, 3) },
      ],
    });
    expect(res.status).toBe(422);
    const messages = (res.body.error.details.fields.weeks as string[]).join(' ');
    expect(messages).toMatch(/Week 14 \(.+\) falls outside the term, which runs from/);
    expect(messages).toMatch(/Week 14 starts on .+, before week 13 ends on/);
    expect(messages).toMatch(/Years and terms \(Edit dates\)/);
  });
});
