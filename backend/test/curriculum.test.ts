import { existsSync, readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db.js';
import { extractSchemePdf } from '../src/modules/curriculum/pdfExtract.js';
import { acceptUpload } from '../src/modules/curriculum/curriculum.service.js';
import {
  createActiveTeacher,
  createSchoolWithHeadmaster,
  expectOk,
  resetDb,
  sampleImport,
  setupTerm,
} from './helpers.js';

beforeEach(resetDb);

describe('bulk approval of cut-off rows', () => {
  it('approves only rows whose sole flag is TRUNCATED, and audits it', async () => {
    const { client: head } = await createSchoolWithHeadmaster();
    const { termId } = await setupTerm(head, 0);
    const body = sampleImport(termId, { checksum: 'c'.repeat(64) });
    body.rows[0]!.indicator = 'B7.1.1.1.1 Model number quantities .......';
    body.rows[1]!.indicator = 'B7.1.1.2.1 Compare and order .......';
    // Truncated and with a wrong level code: must stay for individual review.
    body.rows[2]!.indicator = 'B8.1.1.3.1 Round off .......';
    const imp = expectOk(await head.post('/curriculum/imports', body));
    expect(imp.body.data.counts.truncatedOnlyPending).toBe(2);

    const bulk = expectOk(
      await head.post(`/curriculum/imports/${imp.body.data.id}/rows/bulk-review`, {
        flag: 'TRUNCATED',
      }),
    );
    expect(bulk.body.data.approved).toBe(2);

    const after = expectOk(await head.get(`/curriculum/imports/${imp.body.data.id}`));
    expect(after.body.data.counts.flaggedPending).toBe(1);
    expect(
      await prisma.auditLog.count({ where: { action: 'curriculum.rows_bulk_approved' } }),
    ).toBe(1);

    // The remaining flagged row still blocks approval until reviewed.
    expect((await head.post(`/curriculum/imports/${imp.body.data.id}/approve`)).status).toBe(409);
  });
});

describe('accepting an upload without review', () => {
  async function staged() {
    const { client: head, user } = await createSchoolWithHeadmaster();
    const { termId } = await setupTerm(head, 0);
    const body = sampleImport(termId);
    body.rows[0]!.indicator = 'B7.1.1.1.1 Model number quantities .......';
    body.rows[1]!.indicator = 'B8.1.1.2.1 Wrong level code';
    body.rows.push({ ...body.rows[2]!, subject: 'Underwater Basket Weaving' });
    const imp = expectOk(await head.post('/curriculum/imports', body));
    const actor = { schoolId: user.schoolId, userId: user.id, requestId: 'test' };
    return { head, actor, termId, batchId: imp.body.data.id as string };
  }

  it('publishes every row as printed, leaving out only unknown subjects', async () => {
    const { head, actor, batchId } = await staged();
    const res = await acceptUpload(actor, batchId, { publish: true });
    expect(res.published).toBe(true);
    expect(res.report.imported).toBe(12);
    expect(res.report.rejected).toBe(1);
    const scheme = await prisma.curriculumScheme.findUniqueOrThrow({ where: { id: res.schemeId } });
    expect(scheme.status).toBe('PUBLISHED');
    const cur = expectOk(await head.get('/curriculum?level=BASIC_7&weekNumber=1'));
    expect(cur.body.data.entries[0].isTruncated).toBe(true);
  });

  it('leaves a school admin’s upload as a draft for the headmaster', async () => {
    const { actor, batchId } = await staged();
    const res = await acceptUpload(actor, batchId, { publish: false });
    const scheme = await prisma.curriculumScheme.findUniqueOrThrow({ where: { id: res.schemeId } });
    expect(scheme.status).toBe('DRAFT');
  });
});

describe('editing a published topic', () => {
  it('lets the headmaster correct a topic, audits it, and keeps a used topic in its week', async () => {
    const { client: head, user } = await createSchoolWithHeadmaster();
    const { termId } = await setupTerm(head, 0);
    const imp = expectOk(await head.post('/curriculum/imports', sampleImport(termId)));
    await acceptUpload(
      { schoolId: user.schoolId, userId: user.id, requestId: 'test' },
      imp.body.data.id,
      { publish: true },
    );
    const entry = await prisma.curriculumEntry.findFirstOrThrow({ where: { weekNumber: 1 } });

    const fixed = expectOk(
      await head.patch(`/curriculum/entries/${entry.id}`, {
        indicator: 'B7.1.1.1.1 Model number quantities up to 1,000,000',
        weekNumber: 2,
      }),
    );
    expect(fixed.body.data.indicator).toContain('1,000,000');
    expect(fixed.body.data.weekNumber).toBe(2);
    expect(fixed.body.data.isTruncated).toBe(false);
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'curriculum.topic_edited', entityId: entry.id },
    });
    expect(log.metadata).toMatchObject({ before: { weekNumber: 1 }, after: { weekNumber: 2 } });

    expect((await head.patch(`/curriculum/entries/${entry.id}`, {})).status).toBe(422);

    // A teacher cannot edit the scheme.
    const { client: teacher } = await createActiveTeacher(head, {
      fullName: 'Ama Owusu',
      email: 'ama@test.example',
      staffId: 'GES-9',
      assignments: [],
    });
    expect(
      (await teacher.patch(`/curriculum/entries/${entry.id}`, { indicator: 'x' })).status,
    ).toBe(403);
  });
});

describe('PDF upload', () => {
  it('refuses a file that is not a PDF', async () => {
    const { client: head } = await createSchoolWithHeadmaster();
    const { termId } = await setupTerm(head, 0);
    const res = await head.agent
      .post(`/api/v1/curriculum/imports/pdf?termId=${termId}`)
      .set('Authorization', `Bearer ${head.token}`)
      .set('Content-Type', 'application/pdf')
      .send(Buffer.from('this is not a pdf at all'));
    expect(res.status).toBe(422);
    expect(res.body.error.details.fields.file).toBeDefined();
  });

  it('refuses other content types on the upload route', async () => {
    const { client: head } = await createSchoolWithHeadmaster();
    const { termId } = await setupTerm(head, 0);
    const res = await head.agent
      .post(`/api/v1/curriculum/imports/pdf?termId=${termId}`)
      .set('Authorization', `Bearer ${head.token}`)
      .set('Content-Type', 'text/plain')
      .send('hello');
    expect(res.status).toBe(422);
  });
});

// Runs only when the real CEPME PDF is available locally (it is not committed to the repository):
//   SCHEME_PDF=path/to/scheme.pdf pnpm --filter @school/api test
const schemePdf = process.env.SCHEME_PDF;
describe.skipIf(!schemePdf || !existsSync(schemePdf))('real scheme-of-learning PDF', () => {
  it('reads all 30 level-subject tables with the right special weeks', async () => {
    const result = await extractSchemePdf(new Uint8Array(readFileSync(schemePdf!)));
    const combos = new Set(result.rows.map((r) => `${r.level}|${r.subject}`));
    expect(combos.size).toBe(30);
    const kind = (level: string, w: number) =>
      result.weeks.find((x) => x.level === level && x.weekNumber === w)?.kind;
    for (const level of ['BASIC_7', 'BASIC_8']) {
      expect(kind(level, 13)).toBe('REVISION');
      expect(kind(level, 14)).toBe('EXAMINATION');
    }
    expect(kind('BASIC_9', 11)).toBe('MOCK');
    expect(kind('BASIC_9', 12)).toBe('TEACHING');
    expect(kind('BASIC_9', 13)).toBe('TEACHING');
    expect(kind('BASIC_9', 14)).toBe('EXAMINATION');
    expect(result.rows.some((r) => r.level === 'BASIC_9' && r.weekNumber === 11)).toBe(false);
  });

  it('accepts and publishes the upload at once, idempotently', async () => {
    const { client: head } = await createSchoolWithHeadmaster();
    const { termId } = await setupTerm(head, 0);
    const send = () =>
      head.agent
        .post(`/api/v1/curriculum/imports/pdf?termId=${termId}&fileName=scheme.pdf`)
        .set('Authorization', `Bearer ${head.token}`)
        .set('Content-Type', 'application/pdf')
        .send(readFileSync(schemePdf!));
    const first = await send();
    expect(first.status).toBe(201);
    expect(first.body.data.counts.total).toBeGreaterThan(700);
    expect(first.body.data.report.warnings).toEqual([]);
    expect(first.body.data.status).toBe('IMPORTED');
    expect(first.body.data.scheme.status).toBe('PUBLISHED');
    expect(first.body.data.counts.decisions.PENDING).toBeUndefined();
    const second = await send();
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);
  });
});

describe.skipIf(!schemePdf || !existsSync(schemePdf))('real PDF, end to end', () => {
  it('upload publishes at once, and a teacher records a lesson against a real topic', async () => {
    const { client: head } = await createSchoolWithHeadmaster();
    const { termId } = await setupTerm(head, 3);
    const upload = await head.agent
      .post(`/api/v1/curriculum/imports/pdf?termId=${termId}&fileName=scheme.pdf`)
      .set('Authorization', `Bearer ${head.token}`)
      .set('Content-Type', 'application/pdf')
      .send(readFileSync(schemePdf!));
    expect(upload.status).toBe(201);
    expect(upload.body.data.scheme.status).toBe('PUBLISHED');
    expect(upload.body.data.report.imported).toBeGreaterThan(700);

    // Basic 9 has no topics in the mock week.
    const mock = await prisma.curriculumEntry.count({
      where: { level: 'BASIC_9', weekNumber: 11 },
    });
    expect(mock).toBe(0);

    // A Basic 7 Mathematics teacher can now record week 1 against a topic from the PDF.
    const cls = expectOk(await head.post('/classes', { level: 'BASIC_7', name: 'B7A' }));
    const subjects = expectOk(await head.get('/subjects'));
    const math = (subjects.body.data as { id: string; name: string }[]).find(
      (s) => s.name === 'Mathematics',
    )!;
    const { client: teacher, teacher: t } = await createActiveTeacher(head, {
      fullName: 'Kofi Boateng',
      email: 'kofi@test.example',
      staffId: 'GES-1',
      assignments: [{ subjectId: math.id, classId: cls.body.data.id }],
    });
    const assignment = expectOk(await head.get(`/assignments?teacherProfileId=${t.id}`)).body
      .data[0];
    expectOk(
      await head.post('/timetable-entries', {
        assignmentId: assignment.id,
        weekday: 1,
        startTime: '08:00',
        endTime: '09:00',
      }),
    );
    expectOk(await head.post('/timetable/publish', { termId }));
    const lesson = await prisma.lesson.findFirstOrThrow({
      where: { assignmentId: assignment.id, weekNumber: 1 },
    });
    const topics = expectOk(await teacher.get(`/curriculum/topics?lessonId=${lesson.id}`));
    const entries = topics.body.data.entries as { id: string; indicator: string }[];
    expect(entries.some((e) => e.indicator.startsWith('B7.1.1.1.1'))).toBe(true);
    const rec = await teacher.post('/teaching-records', {
      lessonId: lesson.id,
      entryIds: [entries[0]!.id],
      taughtSummary: 'Modelled number quantities with place value charts.',
      status: 'SUBMITTED',
    });
    expect(rec.status).toBe(201);
  });
});

describe('names', () => {
  it('lets the headmaster rename the school and correct their own name, but not a teacher', async () => {
    const { client: head } = await createSchoolWithHeadmaster();
    expectOk(await head.patch('/school', { name: 'Accra Model JHS' }));
    const me = expectOk(await head.patch('/auth/me', { fullName: 'Ama K. Mensah' }));
    expect(me.body.data.fullName).toBe('Ama K. Mensah');
    expect(me.body.data.school.name).toBe('Accra Model JHS');
    expect(
      await prisma.auditLog.count({
        where: { action: { in: ['school.renamed', 'user.name_changed'] } },
      }),
    ).toBe(2);

    const { client: teacher } = await createActiveTeacher(head, {
      fullName: 'Kofi Boateng',
      email: 'kofi@test.example',
      staffId: 'GES-1',
    });
    expect((await teacher.patch('/auth/me', { fullName: 'Someone Else' })).status).toBe(403);
    expect((await teacher.patch('/school', { name: 'Hijacked' })).status).toBe(403);
  });
});
