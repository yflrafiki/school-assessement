import { existsSync, readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
// The browser's rules for turning the grid into lessons, run here on the server's output.
import { rowsFromSheets } from '../../frontend/src/features/headmaster/timetableFile.js';
import {
  createActiveTeacher,
  createSchoolWithHeadmaster,
  expectOk,
  resetDb,
  setupTerm,
  subjectId,
} from './helpers.js';

beforeEach(resetDb);

describe('timetable PDF upload', () => {
  it('refuses a file that is not a PDF', async () => {
    const { client: head } = await createSchoolWithHeadmaster();
    const res = await head.agent
      .post('/api/v1/timetable/import/pdf')
      .set('Authorization', `Bearer ${head.token}`)
      .set('Content-Type', 'application/pdf')
      .send(Buffer.from('not a pdf'));
    expect(res.status).toBe(422);
  });
});

// Runs only with the school's real timetable (not committed):
//   TIMETABLE_PDF=path/to/timetable.pdf pnpm --filter @school/api test
const pdf = process.env.TIMETABLE_PDF;
describe.skipIf(!pdf || !existsSync(pdf))('real timetable PDF', () => {
  it('reads every form, and every lesson matches a class, subject and teacher without clashes', async () => {
    const { client: head } = await createSchoolWithHeadmaster();
    const { termId } = await setupTerm(head, 0);
    const classIds: string[] = [];
    for (const [level, name] of [
      ['BASIC_7', 'B7'],
      ['BASIC_8', 'B8'],
      ['BASIC_9', 'B9'],
    ] as const) {
      classIds.push(expectOk(await head.post('/classes', { level, name })).body.data.id);
    }
    expectOk(await head.post('/subjects', { name: 'Asante Twi' }));
    // One teacher per subject, teaching it in Form 1 to Form 3.
    const subjects = [
      'Mathematics',
      'English Language',
      'Science',
      'Social Studies',
      'Religious and Moral Education',
      'Computing',
      'Creative Arts and Design',
      'Career Technology',
      'French',
      'Asante Twi',
    ];
    for (const [n, name] of subjects.entries()) {
      const id = await subjectId(head, name);
      await createActiveTeacher(head, {
        fullName: `Teacher ${n + 1}`,
        email: `t${n + 1}@test.example`,
        staffId: `GES-${n + 1}`,
        assignments: classIds.map((classId) => ({ subjectId: id, classId })),
      });
    }

    const read = await head.agent
      .post('/api/v1/timetable/import/pdf')
      .set('Authorization', `Bearer ${head.token}`)
      .set('Content-Type', 'application/pdf')
      .send(readFileSync(pdf!));
    expect(read.status).toBe(200);
    const sheets = read.body.data.sheets as { name: string; rows: string[][] }[];
    expect(sheets.map((s) => s.name)).toEqual(['Form 1', 'Form 2', 'Form 3']);

    const { rows, notes } = rowsFromSheets(sheets);
    expect(rows.filter((r) => r.className === 'Form 1')).toHaveLength(22);
    expect(rows.filter((r) => r.className === 'Form 2')).toHaveLength(23);
    expect(rows.filter((r) => r.className === 'Form 3')).toHaveLength(30);
    expect(notes.join(' ')).toMatch(/R\.M\.E \/ Maths/);
    expect(rows).toContainEqual({
      className: 'Form 3',
      subject: 'Maths',
      weekday: 5,
      startTime: '15:00',
      endTime: '16:00',
    });

    const checked = expectOk(
      await head.post('/timetable/import', { termId, rows: rows.map((r) => ({ ...r })) }),
    );
    const problems = (checked.body.data.rows as { row: number; error?: string }[]).filter(
      (r) => r.error,
    );
    expect(problems).toEqual([]);

    const saved = expectOk(await head.post('/timetable/import', { termId, dryRun: false, rows }));
    expect(saved.body.data).toMatchObject({ saved: true, created: 75 });
  });
});
