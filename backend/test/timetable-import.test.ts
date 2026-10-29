import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db.js';
import {
  createActiveTeacher,
  createSchoolWithHeadmaster,
  expectOk,
  resetDb,
  setupTerm,
  subjectId,
} from './helpers.js';

beforeEach(resetDb);

async function world() {
  const { client: head } = await createSchoolWithHeadmaster();
  const { termId } = await setupTerm(head, 0);
  const b7a = expectOk(await head.post('/classes', { level: 'BASIC_7', name: 'B7A' }));
  await createActiveTeacher(head, {
    fullName: 'Kofi Boateng',
    email: 'kofi@test.example',
    staffId: 'GES-1',
    assignments: [
      { subjectId: await subjectId(head, 'Mathematics'), classId: b7a.body.data.id },
      { subjectId: await subjectId(head, 'Science'), classId: b7a.body.data.id },
    ],
  });
  return { head, termId };
}

const slot = (subject: string, weekday: number, startTime: string, endTime: string) => ({
  className: 'b7 a',
  subject,
  weekday,
  startTime,
  endTime,
});

describe('uploading a timetable', () => {
  it('checks every row first, matching short subject names, and saves nothing on a check', async () => {
    const { head, termId } = await world();
    const res = expectOk(
      await head.post('/timetable/import', {
        termId,
        rows: [
          slot('Maths', 1, '08:00', '09:00'),
          slot('Integrated Science', 2, '08:00', '09:00'),
          { ...slot('Maths', 3, '08:00', '09:00'), className: 'B9Z' },
          slot('French', 4, '08:00', '09:00'),
          // The same teacher cannot be in two places at once.
          slot('Science', 1, '08:30', '09:30'),
        ],
      }),
    );
    const rows = res.body.data.rows;
    expect(res.body.data.saved).toBe(false);
    expect(rows[0]).toMatchObject({ className: 'B7A', matchedSubject: 'Mathematics' });
    expect(rows[0].teacher).toBe('Kofi Boateng');
    expect(rows[1].matchedSubject).toBe('Science');
    expect(rows[2].error).toMatch(/no class called "B9Z"/);
    expect(rows[3].error).toMatch(/No teacher is assigned to "French"/);
    expect(rows[4].error).toMatch(/already teaches/);
    expect(await prisma.timetableEntry.count()).toBe(0);
  });

  it('refuses to save while any row has a problem', async () => {
    const { head, termId } = await world();
    const res = expectOk(
      await head.post('/timetable/import', {
        termId,
        dryRun: false,
        rows: [slot('Maths', 1, '08:00', '09:00'), slot('Dance', 2, '08:00', '09:00')],
      }),
    );
    expect(res.body.data.saved).toBe(false);
    expect(await prisma.timetableEntry.count()).toBe(0);
  });

  it('saves a clean file, replaces the class slots on a second upload, and audits it', async () => {
    const { head, termId } = await world();
    const first = expectOk(
      await head.post('/timetable/import', {
        termId,
        dryRun: false,
        rows: [slot('Maths', 1, '08:00', '09:00'), slot('Science', 2, '10:00', '11:00')],
      }),
    );
    expect(first.body.data).toMatchObject({ saved: true, created: 2, replaced: 0 });

    const second = expectOk(
      await head.post('/timetable/import', {
        termId,
        dryRun: false,
        rows: [slot('Maths', 1, '07:30', '08:30')],
      }),
    );
    expect(second.body.data).toMatchObject({ saved: true, created: 1, replaced: 2 });
    const live = await prisma.timetableEntry.findMany({ where: { deletedAt: null } });
    expect(live).toHaveLength(1);
    expect(live[0]!.startMinute).toBe(7 * 60 + 30);
    expect(await prisma.auditLog.count({ where: { action: 'timetable.imported' } })).toBe(2);

    // Each slot's time can still be edited afterwards.
    const entries = expectOk(await head.get(`/timetable-entries?termId=${termId}`));
    const edited = expectOk(
      await head.patch(`/timetable-entries/${entries.body.data[0].id}`, {
        startTime: '08:00',
        endTime: '09:10',
      }),
    );
    expect(edited.body.data).toMatchObject({ startTime: '08:00', endTime: '09:10' });
  });
});
