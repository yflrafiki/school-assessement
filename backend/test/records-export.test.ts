import ExcelJS from 'exceljs';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db.js';
import { hashPassword } from '../src/lib/password.js';
import { addDays } from '../src/lib/dates.js';
import {
  Client,
  createActiveTeacher,
  createSchoolWithHeadmaster,
  expectOk,
  mondayOf,
  PASSWORD,
  publishSampleScheme,
  resetDb,
  setupTerm,
  subjectId,
  today,
} from './helpers.js';

beforeEach(resetDb);

/** Downloads a file and opens it as a workbook. */
async function download(client: Client, path: string) {
  const res = await client
    .get(path)
    .buffer(true)
    .parse((r, done) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => done(null, Buffer.concat(chunks)));
    });
  if (res.status !== 200) return { res, wb: null };
  const wb = new ExcelJS.Workbook();
  // exceljs is typed for an older Buffer; the bytes are the same.
  await wb.xlsx.load(res.body as never);
  return { res, wb };
}

/** The table rows of a sheet (below the title, period note and header). */
function rows(wb: ExcelJS.Workbook, name: string) {
  const ws = wb.getWorksheet(name)!;
  const out: unknown[][] = [];
  ws.eachRow((row, n) => {
    if (n > 4) out.push((row.values as unknown[]).slice(1));
  });
  return out;
}

describe('downloading every teacher’s records', () => {
  it('gives the headmaster and the admin a workbook of records, gaps and changes', async () => {
    const { client: head } = await createSchoolWithHeadmaster();
    const { termId } = await setupTerm(head, 1);
    const cls = expectOk(await head.post('/classes', { level: 'BASIC_7', name: 'B7A' }));
    const { teacher, client } = await createActiveTeacher(head, {
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
        startTime: '06:00',
        endTime: '07:00',
      }),
    );
    await publishSampleScheme(head, termId);
    expectOk(await head.post('/timetable/publish', { termId }));

    // Last Monday's lesson is recorded; this Monday's is not.
    const lastMonday = addDays(mondayOf(today()), -7);
    const lesson = await prisma.lesson.findFirstOrThrow({
      where: { assignmentId, date: new Date(`${lastMonday}T00:00:00Z`) },
    });
    const topics = expectOk(await client.get(`/curriculum/topics?lessonId=${lesson.id}`));
    expectOk(
      await client.post('/teaching-records', {
        lessonId: lesson.id,
        entryIds: [topics.body.data.entries[0].id],
        taughtSummary: 'Taught rounding off whole numbers with number lines.',
        challenges: 'Some learners confused tens and hundreds.',
        assessments: ['CLASS_TEST'],
        assessmentNote: 'Test on rounding, 10 marks',
        status: 'SUBMITTED',
      }),
    );

    // A teacher cannot download the school's records.
    expect((await client.get('/reports/records-export')).status).toBe(403);

    const { res, wb } = await download(head, `/reports/records-export?termId=${termId}`);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="teaching-records-/);
    expect(wb!.worksheets.map((w) => w.name)).toEqual([
      'Summary by teacher',
      'Lesson records',
      'Topics taught',
      'Not recorded',
      'Cancelled or moved',
    ]);

    const [summary] = rows(wb!, 'Summary by teacher');
    // Needed a record: 2. Submitted 1 (late: recorded after the day), not recorded 1, 50%, 1 test.
    expect(summary).toEqual(['Kofi Boateng', 'GES-1', 2, 1, 0, 1, 1, 50, 0, 0, 1, 'Active']);

    const [record] = rows(wb!, 'Lesson records');
    expect(record).toEqual(
      expect.arrayContaining([
        lastMonday,
        'Monday',
        '06:00–07:00',
        'Kofi Boateng',
        'B7A',
        'Mathematics',
        'Taught rounding off whole numbers with number lines.',
        'Some learners confused tens and hundreds.',
        'Class test',
        'Test on rounding, 10 marks',
        'Late',
      ]),
    );

    // Each topic taught, with the scheme's wording and what the teacher wrote.
    const entry = topics.body.data.entries[0];
    expect(rows(wb!, 'Topics taught')).toEqual([
      [
        'B7A',
        'Mathematics',
        lastMonday,
        lesson.weekNumber,
        'Kofi Boateng',
        entry.strand,
        entry.subStrand,
        entry.contentStandard,
        entry.indicator,
        'Taught rounding off whole numbers with number lines.',
        'Class test',
      ],
    ]);

    const missing = rows(wb!, 'Not recorded');
    expect(missing).toHaveLength(1);
    expect(missing[0]!.slice(0, 1)).toEqual([mondayOf(today())]);

    // The download is kept in the activity log.
    const logged = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'records.exported' },
    });
    expect(logged.metadata).toMatchObject({ records: 1, notRecorded: 1 });

    // The admin can download the same records.
    await prisma.user.create({
      data: {
        schoolId: null,
        email: 'owner@test.example',
        fullName: 'System Owner',
        role: 'SYSTEM_ADMIN',
        status: 'ACTIVE',
        passwordHash: await hashPassword(PASSWORD),
      },
    });
    const admin = new Client();
    expectOk(await admin.login('owner@test.example'));
    const fromAdmin = await download(admin, '/admin/records-export');
    expect(rows(fromAdmin.wb!, 'Lesson records')).toHaveLength(1);
  });
});
