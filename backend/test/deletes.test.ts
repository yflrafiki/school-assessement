import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db.js';
import {
  type Client,
  createActiveTeacher,
  createSchoolWithHeadmaster,
  expectOk,
  publishSampleScheme,
  resetDb,
  sampleImport,
  setupTerm,
  subjectId,
} from './helpers.js';

beforeEach(resetDb);

/** A Basic 7 Mathematics teacher with a Monday lesson, a published timetable and scheme. */
async function world() {
  const { client: head } = await createSchoolWithHeadmaster();
  const { termId } = await setupTerm(head, 3);
  const cls = expectOk(await head.post('/classes', { level: 'BASIC_7', name: 'B7A' }));
  const math = await subjectId(head, 'Mathematics');
  const { teacher, client } = await createActiveTeacher(head, {
    fullName: 'Kofi Boateng',
    email: 'kofi@test.example',
    staffId: 'GES-1001',
    assignments: [{ subjectId: math, classId: cls.body.data.id }],
  });
  const assignmentId = expectOk(await head.get(`/assignments?teacherProfileId=${teacher.id}`)).body
    .data[0].id as string;
  expectOk(
    await head.post('/timetable-entries', {
      assignmentId,
      weekday: 1,
      startTime: '08:00',
      endTime: '09:00',
    }),
  );
  const schemeId = await publishSampleScheme(head, termId);
  expectOk(await head.post('/timetable/publish', { termId }));
  const batchId = (await prisma.curriculumScheme.findUniqueOrThrow({ where: { id: schemeId } }))
    .importBatchId!;
  return {
    head,
    teacher: client,
    teacherId: teacher.id,
    termId,
    classId: cls.body.data.id as string,
    assignmentId,
    schemeId,
    batchId,
  };
}

async function recordWeekOne(w: { teacher: Client; assignmentId: string }) {
  const lesson = await prisma.lesson.findFirstOrThrow({
    where: { assignmentId: w.assignmentId, weekNumber: 1 },
  });
  const topics = expectOk(await w.teacher.get(`/curriculum/topics?lessonId=${lesson.id}`));
  const entryId = topics.body.data.entries[0].id as string;
  expectOk(
    await w.teacher.post('/teaching-records', {
      lessonId: lesson.id,
      entryIds: [entryId],
      taughtSummary: 'Introduced place value with base ten blocks.',
      status: 'SUBMITTED',
    }),
  );
  return entryId;
}

describe('deleting the uploaded scheme of learning', () => {
  it('removes it with its topics so it can be uploaded again, and audits it', async () => {
    const w = await world();
    expectOk(await w.head.delete(`/curriculum/imports/${w.batchId}`));
    expect(await prisma.curriculumScheme.count()).toBe(0);
    expect(await prisma.curriculumEntry.count()).toBe(0);
    expect(await prisma.importBatch.count()).toBe(0);
    // Lessons are re-planned without a scheme rather than left pointing at deleted weeks.
    expect(await prisma.lesson.count({ where: { assignmentId: w.assignmentId } })).toBeGreaterThan(
      0,
    );
    expect(await prisma.auditLog.count({ where: { action: 'curriculum.import_deleted' } })).toBe(1);
    // The same file is accepted again.
    expect((await w.head.post('/curriculum/imports', sampleImport(w.termId))).status).toBe(201);
  });

  it('brings the previous version back when the live one is deleted', async () => {
    const w = await world();
    const v2 = expectOk(
      await w.head.post(
        '/curriculum/imports',
        sampleImport(w.termId, { checksum: 'b'.repeat(64) }),
      ),
    );
    const approved = expectOk(await w.head.post(`/curriculum/imports/${v2.body.data.id}/approve`));
    expectOk(await w.head.post(`/curriculum/schemes/${approved.body.data.schemeId}/publish`));

    const res = expectOk(await w.head.delete(`/curriculum/imports/${v2.body.data.id}`));
    expect(res.body.data.restored.id).toBe(w.schemeId);
    const v1 = await prisma.curriculumScheme.findUniqueOrThrow({ where: { id: w.schemeId } });
    expect(v1.status).toBe('PUBLISHED');
    expect(await prisma.curriculumEntry.count({ where: { retiredAt: { not: null } } })).toBe(0);
  });

  it('is refused once a teacher has recorded a lesson against its topics', async () => {
    const w = await world();
    await recordWeekOne(w);
    const res = await w.head.delete(`/curriculum/imports/${w.batchId}`);
    expect(res.status).toBe(409);
    expect(await prisma.curriculumScheme.count()).toBe(1);
  });

  it('is the headmaster’s call, not a teacher’s', async () => {
    const w = await world();
    expect((await w.teacher.delete(`/curriculum/imports/${w.batchId}`)).status).toBe(403);
  });
});

describe('deleting a topic', () => {
  it('deletes an unused topic and refuses one with lessons recorded against it', async () => {
    const w = await world();
    const used = await recordWeekOne(w);
    const unused = await prisma.curriculumEntry.findFirstOrThrow({ where: { weekNumber: 5 } });
    expectOk(await w.head.delete(`/curriculum/entries/${unused.id}`));
    expect(await prisma.curriculumEntry.findUnique({ where: { id: unused.id } })).toBeNull();
    expect((await w.head.delete(`/curriculum/entries/${used}`)).status).toBe(409);
  });
});

describe('deleting a class subject', () => {
  it('deletes it with its lessons and slots while no record exists', async () => {
    const w = await world();
    expectOk(await w.head.delete(`/assignments/${w.assignmentId}`));
    expect(await prisma.teachingAssignment.count()).toBe(0);
    expect(await prisma.lesson.count()).toBe(0);
    expect(await prisma.timetableEntry.count()).toBe(0);
  });

  it('is refused once a lesson record exists', async () => {
    const w = await world();
    await recordWeekOne(w);
    const res = await w.head.delete(`/assignments/${w.assignmentId}`);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/End it instead/);
    // Its class then can only be deactivated, and says so.
    const cls = await w.head.delete(`/classes/${w.classId}`);
    expect(cls.status).toBe(409);
    expect(cls.body.error.message).toMatch(/1 lesson record for it.*Deactivate it instead/);
  });
});

describe('deleting classes, terms and years', () => {
  it('refuses while things depend on them and deletes once they are empty', async () => {
    const w = await world();
    expect((await w.head.delete(`/classes/${w.classId}`)).status).toBe(409);
    expect((await w.head.delete(`/terms/${w.termId}`)).status).toBe(409);

    const empty = expectOk(await w.head.post('/classes', { level: 'BASIC_8', name: 'B8Z' }));
    expectOk(await w.head.delete(`/classes/${empty.body.data.id}`));

    const year = expectOk(
      await w.head.post('/academic-years', {
        name: '2030/2031',
        startDate: '2030-09-01',
        endDate: '2031-07-31',
      }),
    );
    const term = expectOk(
      await w.head.post('/terms', {
        academicYearId: year.body.data.id,
        number: 1,
        name: 'First Term',
        startDate: '2030-09-07',
        endDate: '2030-12-11',
      }),
    );
    expect((await w.head.delete(`/academic-years/${year.body.data.id}`)).status).toBe(409);
    expectOk(await w.head.patch(`/academic-years/${year.body.data.id}`, { name: '2031/2032' }));
    expectOk(await w.head.delete(`/terms/${term.body.data.id}`));
    expectOk(await w.head.delete(`/academic-years/${year.body.data.id}`));
    expect(await prisma.academicYear.count()).toBe(1);
  });

  it('keeps a current term when the current one is deleted', async () => {
    const { client: head } = await createSchoolWithHeadmaster();
    const { termId } = await setupTerm(head, 0);
    const year = (await prisma.term.findUniqueOrThrow({ where: { id: termId } })).academicYearId;
    const yearRow = await prisma.academicYear.findUniqueOrThrow({ where: { id: year } });
    const second = expectOk(
      await head.post('/terms', {
        academicYearId: year,
        number: 2,
        name: 'Second Term',
        startDate: yearRow.endDate.toISOString().slice(0, 10),
        endDate: yearRow.endDate.toISOString().slice(0, 10),
      }),
    );
    expectOk(await head.delete(`/terms/${termId}`));
    const current = await prisma.term.findFirstOrThrow({ where: { isCurrent: true } });
    expect(current.id).toBe(second.body.data.id);
  });
});

describe('deleting a teacher', () => {
  it('deletes a teacher who never activated, but only deactivates one who did', async () => {
    const w = await world();
    const cls = expectOk(await w.head.post('/classes', { level: 'BASIC_8', name: 'B8A' }));
    const pending = expectOk(
      await w.head.post('/teachers', {
        fullName: 'Wrong Email',
        email: 'wrong@test.example',
        staffId: 'GES-2002',
        assignments: [{ subjectId: await subjectId(w.head, 'Science'), classId: cls.body.data.id }],
      }),
    );
    expectOk(await w.head.delete(`/teachers/${pending.body.data.id}`));
    expect(await prisma.user.count({ where: { email: 'wrong@test.example' } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'teacher.deleted' } })).toBe(1);

    const res = await w.head.delete(`/teachers/${w.teacherId}`);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/Deactivate/);
  });
});
