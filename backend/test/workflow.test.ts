import type { AddressInfo } from 'node:net';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db.js';
import { addDays } from '../src/lib/dates.js';
import {
  type Client,
  app,
  createActiveTeacher,
  createSchoolWithHeadmaster,
  expectOk,
  publishSampleScheme,
  resetDb,
  sampleImport,
  setupTerm,
  subjectId,
  today,
} from './helpers.js';

beforeEach(resetDb);

interface World {
  head: Client;
  teacher: Client;
  teacherId: string;
  assignmentId: string;
  termId: string;
  classId: string;
  start: string;
}

/**
 * A school with one Basic 7 class, a Mathematics teacher with two lessons a week
 * (Monday and Wednesday 08:00), a published timetable and a published scheme.
 * Week 1 of the term started three weeks ago.
 */
async function world(): Promise<World> {
  const { client: head } = await createSchoolWithHeadmaster();
  const { termId, start } = await setupTerm(head, 3);
  const cls = expectOk(await head.post('/classes', { level: 'BASIC_7', name: 'B7A' }));
  const math = await subjectId(head, 'Mathematics');
  const { teacher, client } = await createActiveTeacher(head, {
    fullName: 'Kofi Boateng',
    email: 'kofi@test.example',
    staffId: 'GES-1001',
    assignments: [{ subjectId: math, classId: cls.body.data.id }],
  });
  const assignments = expectOk(await head.get(`/assignments?teacherProfileId=${teacher.id}`));
  const assignmentId = assignments.body.data[0].id;
  expectOk(
    await head.post('/timetable-entries', {
      assignmentId,
      weekday: 1,
      startTime: '08:00',
      endTime: '09:00',
    }),
  );
  expectOk(
    await head.post('/timetable-entries', {
      assignmentId,
      weekday: 3,
      startTime: '08:00',
      endTime: '09:00',
    }),
  );
  await publishSampleScheme(head, termId);
  expectOk(await head.post('/timetable/publish', { termId }));
  return {
    head,
    teacher: client,
    teacherId: teacher.id,
    assignmentId,
    termId,
    classId: cls.body.data.id,
    start,
  };
}

async function lessonsOfWeek(w: World, weekNumber: number) {
  return prisma.lesson.findMany({
    where: { assignmentId: w.assignmentId, weekNumber },
    orderBy: [{ date: 'asc' }, { startMinute: 'asc' }],
  });
}

async function topicFor(w: World, lessonId: string) {
  const res = expectOk(await w.teacher.get(`/curriculum/topics?lessonId=${lessonId}`));
  return res.body.data.entries[0].id as string;
}

async function submit(w: World, lessonId: string, status: 'SUBMITTED' | 'DRAFT' = 'SUBMITTED') {
  const entryId = await topicFor(w, lessonId);
  return w.teacher.post('/teaching-records', {
    lessonId,
    entryIds: [entryId],
    taughtSummary: 'Introduced place value with base ten blocks and worked examples.',
    status,
  });
}

describe('timetable and pacing', () => {
  it('generates lessons and paces two per week onto curriculum weeks', async () => {
    const w = await world();
    const week1 = await lessonsOfWeek(w, 1);
    expect(week1).toHaveLength(2);
    expect(week1[0]!.date.toISOString().slice(0, 10)).toBe(w.start);
    // Weeks 1-12 teaching plus 13 revision; week 14 is examination.
    const paced = await prisma.lesson.groupBy({
      by: ['weekNumber'],
      where: { assignmentId: w.assignmentId },
      _count: true,
    });
    const weeks = paced.map((p) => p.weekNumber).filter((n): n is number => n !== null);
    expect(Math.max(...weeks)).toBe(13);
  });

  it('refuses overlapping slots for the same teacher or class', async () => {
    const w = await world();
    const res = await w.head.post('/timetable-entries', {
      assignmentId: w.assignmentId,
      weekday: 1,
      startTime: '08:30',
      endTime: '09:30',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('a holiday cancels the lesson and shifts the curriculum later', async () => {
    const w = await world();
    const [first] = await lessonsOfWeek(w, 1);
    expectOk(
      await w.head.post('/calendar-days', {
        date: w.start,
        kind: 'HOLIDAY',
        description: 'Public holiday',
      }),
    );
    const after = await prisma.lesson.findUniqueOrThrow({ where: { id: first!.id } });
    expect(after.status).toBe('CANCELLED');
    expect(after.cancelReason).toBe('HOLIDAY');
    expect(after.weekNumber).toBeNull();
    // Week 1 is now made of the Wednesday and the following Monday.
    const week1 = await lessonsOfWeek(w, 1);
    expect(week1.map((l) => l.date.toISOString().slice(0, 10))).toEqual([
      addDays(w.start, 2),
      addDays(w.start, 7),
    ]);

    // Removing the holiday restores the lesson.
    const days = expectOk(await w.head.get('/calendar-days'));
    expectOk(await w.head.delete(`/calendar-days/${days.body.data[0].id}`));
    expect((await prisma.lesson.findUniqueOrThrow({ where: { id: first!.id } })).status).toBe(
      'SCHEDULED',
    );
  });

  it('a mock week policy cancels lessons dated in it', async () => {
    const w = await world();
    expectOk(
      await w.head.put('/week-policies', {
        termId: w.termId,
        weekNumber: 2,
        level: 'BASIC_7',
        kind: 'MOCK',
      }),
    );
    const inWeek2 = await prisma.lesson.findMany({
      where: {
        assignmentId: w.assignmentId,
        date: {
          gte: new Date(`${addDays(w.start, 7)}T00:00:00Z`),
          lte: new Date(`${addDays(w.start, 11)}T00:00:00Z`),
        },
      },
    });
    expect(
      inWeek2.every((l) => l.status === 'CANCELLED' && l.cancelReason === 'SPECIAL_WEEK'),
    ).toBe(true);
    // Curriculum week 2 is no longer required, so no lesson is paced to it.
    expect(await lessonsOfWeek(w, 2)).toHaveLength(0);
  });
});

describe('live notifications', () => {
  /** Opens the stream on a real HTTP server, as the browser does, and collects its events. */
  async function openStream(token: string | null) {
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const { port } = server.address() as AddressInfo;
    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/notifications/stream`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    });
    const events: { event: string; data: unknown }[] = [];
    let ended = false;
    if (res.ok && res.body) {
      void (async () => {
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let cut;
            while ((cut = buffer.indexOf('\n\n')) >= 0) {
              const block = buffer.slice(0, cut);
              buffer = buffer.slice(cut + 2);
              const event = /^event: (.*)$/m.exec(block)?.[1];
              const data = /^data: (.*)$/m.exec(block)?.[1];
              if (event) events.push({ event, data: data ? JSON.parse(data) : null });
            }
          }
        } catch {
          // Aborted by the test.
        }
        ended = true;
      })();
    }
    const waitFor = async (check: () => boolean, ms = 3000) => {
      const start = Date.now();
      while (!check()) {
        if (Date.now() - start > ms)
          throw new Error(`Timed out; events so far: ${JSON.stringify(events)}`);
        await new Promise((r) => setTimeout(r, 20));
      }
    };
    const close = () => {
      controller.abort();
      server.closeAllConnections();
      server.close();
    };
    return { res, events, waitFor, isEnded: () => ended, close };
  }

  it('refuses the stream without a valid session', async () => {
    const stream = await openStream(null);
    expect(stream.res.status).toBe(401);
    stream.close();
  });

  it('pushes a submitted record to the headmaster at once, without polling', async () => {
    const w = await world();
    const stream = await openStream(w.head.token);
    try {
      expect(stream.res.headers.get('content-type')).toContain('text/event-stream');
      await stream.waitFor(() => stream.events.some((e) => e.event === 'ready'));

      const [first] = await lessonsOfWeek(w, 1);
      const submitted = expectOk(await submit(w, first!.id));
      await stream.waitFor(() => stream.events.some((e) => e.event === 'notification'));

      const pushed = stream.events.find((e) => e.event === 'notification')!.data as {
        title: string;
        recordId: string;
      };
      expect(pushed.recordId).toBe(submitted.body.data.record.id);
      expect(pushed.title).toContain('Kofi Boateng recorded Mathematics, B7A');
    } finally {
      stream.close();
    }
  });

  it('does not push drafts', async () => {
    const w = await world();
    const stream = await openStream(w.head.token);
    try {
      await stream.waitFor(() => stream.events.some((e) => e.event === 'ready'));
      const [first] = await lessonsOfWeek(w, 1);
      expectOk(await submit(w, first!.id, 'DRAFT'));
      await new Promise((r) => setTimeout(r, 300));
      expect(stream.events.some((e) => e.event === 'notification')).toBe(false);
    } finally {
      stream.close();
    }
  });

  it('closes the stream when that tab signs out', async () => {
    const w = await world();
    const stream = await openStream(w.head.token);
    try {
      await stream.waitFor(() => stream.events.some((e) => e.event === 'ready'));
      expect((await w.head.post('/auth/logout')).status).toBe(204);
      await stream.waitFor(() => stream.events.some((e) => e.event === 'session-ended'));
      await stream.waitFor(() => stream.isEnded());
    } finally {
      stream.close();
    }
  });
});

describe('records and weekly locking', () => {
  it('submits a record, notifies the headmaster and audits it', async () => {
    const w = await world();
    const [first] = await lessonsOfWeek(w, 1);
    const res = expectOk(await submit(w, first!.id));
    expect(res.body.data.record.status).toBe('SUBMITTED');
    expect(res.body.data.record.isLate).toBe(true);

    const unread = expectOk(await w.head.get('/notifications/unread-count'));
    expect(unread.body.data.count).toBe(1);
    const list = expectOk(await w.head.get('/notifications'));
    expect(list.body.data[0].recordId).toBe(res.body.data.record.id);
    expect(await prisma.auditLog.count({ where: { action: 'record.submitted' } })).toBe(1);
  });

  it('locks a later week until the earlier one is complete', async () => {
    const w = await world();
    const week1 = await lessonsOfWeek(w, 1);
    const [w2first] = await lessonsOfWeek(w, 2);

    const locked = await submit(w, w2first!.id);
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('WEEK_LOCKED');
    expect(locked.body.error.details.blockingWeek).toBe(1);
    expect(locked.body.error.details.outstandingLessons).toHaveLength(2);

    // Drafts never count and are allowed.
    expectOk(await submit(w, w2first!.id, 'DRAFT'));

    for (const l of week1) expectOk(await submit(w, l.id));
    expectOk(await submit(w, w2first!.id));
  });

  it('a headmaster waiver unlocks the next week', async () => {
    const w = await world();
    const week1 = await lessonsOfWeek(w, 1);
    const [w2first] = await lessonsOfWeek(w, 2);
    expectOk(await submit(w, week1[0]!.id));
    expectOk(await w.head.post(`/lessons/${week1[1]!.id}/waive`, { reason: 'Sports festival' }));
    expectOk(await submit(w, w2first!.id));
    expect(await prisma.auditLog.count({ where: { action: 'lesson.waived' } })).toBe(1);
  });

  it('rejects duplicate records, including two concurrent submissions', async () => {
    const w = await world();
    const [first] = await lessonsOfWeek(w, 1);
    const entryId = await topicFor(w, first!.id);
    const body = {
      lessonId: first!.id,
      entryIds: [entryId],
      taughtSummary: 'Place value with base ten blocks.',
      status: 'SUBMITTED',
    };
    const results = await Promise.all([
      w.teacher.post('/teaching-records', body),
      w.teacher.post('/teaching-records', body),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe(
      'DUPLICATE_TEACHING_RECORD',
    );
    expect(await prisma.teachingRecord.count()).toBe(1);
    expect(await prisma.notification.count()).toBe(1);
  });

  it('refuses future lessons and topics from another week', async () => {
    const w = await world();
    const future = await prisma.lesson.findFirstOrThrow({
      where: {
        assignmentId: w.assignmentId,
        date: { gt: new Date(`${today()}T00:00:00Z`) },
        weekNumber: { not: null },
      },
      orderBy: { date: 'asc' },
    });
    const [first] = await lessonsOfWeek(w, 1);
    const [second] = await lessonsOfWeek(w, 2);
    const wrongTopic = await topicFor(w, second!.id);

    const res = await w.teacher.post('/teaching-records', {
      lessonId: first!.id,
      entryIds: [wrongTopic],
      taughtSummary: 'Place value with base ten blocks.',
      status: 'SUBMITTED',
    });
    expect(res.status).toBe(422);

    // Complete earlier weeks so the only remaining objection is the date.
    const all = await prisma.lesson.findMany({
      where: {
        assignmentId: w.assignmentId,
        date: { lt: future.date },
        status: 'SCHEDULED',
        weekNumber: { not: null },
      },
      orderBy: { date: 'asc' },
    });
    for (const l of all) await w.head.post(`/lessons/${l.id}/waive`, { reason: 'Test setup' });
    const futureRes = await submit(w, future.id);
    expect(futureRes.status).toBe(409);
    expect(futureRes.body.error.message).toMatch(/once it has started/);
  });

  it('allows text edits for 48 hours, audited, then refuses', async () => {
    const w = await world();
    const [first] = await lessonsOfWeek(w, 1);
    const rec = expectOk(await submit(w, first!.id)).body.data.record;
    expectOk(
      await w.teacher.patch(`/teaching-records/${rec.id}`, { remarks: 'Pupils enjoyed it.' }),
    );
    expect(await prisma.auditLog.count({ where: { action: 'record.edited' } })).toBe(1);
    await prisma.teachingRecord.update({
      where: { id: rec.id },
      data: { submittedAt: new Date(Date.now() - 49 * 3600 * 1000) },
    });
    expect(
      (await w.teacher.patch(`/teaching-records/${rec.id}`, { remarks: 'Too late' })).status,
    ).toBe(409);
  });

  it('an approved absence removes the overdue state at once', async () => {
    const w = await world();
    const overdue = expectOk(await w.teacher.get('/lessons?state=OVERDUE'));
    expect(overdue.body.meta.total).toBeGreaterThan(0);
    expectOk(
      await w.head.post('/absences', {
        teacherProfileId: w.teacherId,
        startDate: w.start,
        endDate: addDays(w.start, 30),
        reason: 'Approved leave',
      }),
    );
    const after = expectOk(await w.teacher.get('/lessons?state=OVERDUE'));
    expect(after.body.meta.total).toBe(0);
  });

  it('reports weekly completion from lessons, not record counts', async () => {
    const w = await world();
    for (const l of await lessonsOfWeek(w, 1)) expectOk(await submit(w, l.id));
    const report = expectOk(await w.head.get('/reports/weekly-progress'));
    const week1 = report.body.data.weeks.find((x: { weekNumber: number }) => x.weekNumber === 1);
    expect(week1).toMatchObject({ assignmentsWithLessons: 1, assignmentsComplete: 1, rate: 1 });
    const week2 = report.body.data.weeks.find((x: { weekNumber: number }) => x.weekNumber === 2);
    expect(week2.rate).toBe(0);
  });
});

describe('search and filters', () => {
  it('filters teaching records server-side with pagination', async () => {
    const w = await world();
    for (const l of await lessonsOfWeek(w, 1)) expectOk(await submit(w, l.id));
    const byName = expectOk(await w.head.get('/teaching-records?q=kofi&pageSize=1'));
    expect(byName.body.meta).toMatchObject({ total: 2, pageSize: 1, totalPages: 2 });
    const bySubject = expectOk(await w.head.get('/teaching-records?q=mathem'));
    expect(bySubject.body.meta.total).toBe(2);
    const none = expectOk(await w.head.get('/teaching-records?q=science'));
    expect(none.body.meta.total).toBe(0);
    const week = expectOk(await w.head.get('/teaching-records?weekNumber=2'));
    expect(week.body.meta.total).toBe(0);
  });

  it('searches teachers and filters by progress', async () => {
    const w = await world();
    const found = expectOk(await w.head.get('/teachers?q=boat'));
    expect(found.body.data).toHaveLength(1);
    const behind = expectOk(await w.head.get('/teachers?progress=BEHIND'));
    expect(behind.body.data).toHaveLength(1);
    expect(behind.body.data[0].oldestOverdueDate).toBe(w.start);
  });
});

describe('roles and school isolation', () => {
  it('teachers cannot use headmaster endpoints', async () => {
    const w = await world();
    expect((await w.teacher.get('/teachers')).status).toBe(403);
    expect((await w.teacher.post('/classes', { level: 'BASIC_7', name: 'X' })).status).toBe(403);
    const [first] = await lessonsOfWeek(w, 1);
    expect((await w.teacher.post(`/lessons/${first!.id}/waive`, { reason: 'Myself' })).status).toBe(
      403,
    );
  });

  it('another school sees NOT_FOUND for every id of this school', async () => {
    const w = await world();
    const [first] = await lessonsOfWeek(w, 1);
    const rec = expectOk(await submit(w, first!.id)).body.data.record;

    const { client: other } = await createSchoolWithHeadmaster('Other JHS', 'other@test.example');
    expect((await other.get(`/teachers/${w.teacherId}`)).status).toBe(404);
    expect((await other.get(`/teaching-records/${rec.id}`)).status).toBe(404);
    expect((await other.get(`/lessons/${first!.id}`)).status).toBe(404);
    expect((await other.post(`/lessons/${first!.id}/cancel`, { reason: 'Not mine' })).status).toBe(
      404,
    );
    expect((await other.post(`/teachers/${w.teacherId}/deactivate`)).status).toBe(404);
    expect((await other.get('/teaching-records')).body.meta.total).toBe(0);
    expect((await other.get('/teachers')).body.meta.total).toBe(0);
  });

  it('a teacher cannot record or read another teacher’s lesson', async () => {
    const w = await world();
    const sci = await subjectId(w.head, 'Science');
    const { client: ama } = await createActiveTeacher(w.head, {
      fullName: 'Ama Owusu',
      email: 'ama@test.example',
      staffId: 'GES-2002',
      assignments: [{ subjectId: sci, classId: w.classId }],
    });
    const [first] = await lessonsOfWeek(w, 1);
    expect((await ama.get(`/lessons/${first!.id}`)).status).toBe(404);
    const res = await ama.post('/teaching-records', {
      lessonId: first!.id,
      entryIds: [],
      taughtSummary: 'Trying to record someone else’s lesson.',
      status: 'SUBMITTED',
    });
    expect(res.status).toBe(404);
  });
});

describe('curriculum import', () => {
  it('is idempotent per file checksum and requires flagged rows to be reviewed', async () => {
    const { client: head } = await createSchoolWithHeadmaster();
    const { termId } = await setupTerm(head, 0);
    const body = sampleImport(termId, { checksum: 'b'.repeat(64) });
    body.rows[0]!.indicator = 'B7.1.1.1.1 Indicator text cut off .......';
    body.rows[1]!.indicator = 'B8.1.1.2.1 Wrong level code';

    const first = expectOk(await head.post('/curriculum/imports', body));
    expect(first.status).toBe(201);
    const again = expectOk(await head.post('/curriculum/imports', body));
    expect(again.status).toBe(200);
    expect(again.body.data.id).toBe(first.body.data.id);
    expect(first.body.data.counts.flagged).toBe(2);

    const blocked = await head.post(`/curriculum/imports/${first.body.data.id}/approve`);
    expect(blocked.status).toBe(409);

    const rows = expectOk(
      await head.get(`/curriculum/imports/${first.body.data.id}/rows?flagged=true`),
    );
    const flags = rows.body.data.map((r: { flags: string[] }) => r.flags).flat();
    expect(flags).toEqual(expect.arrayContaining(['TRUNCATED', 'CODE_LEVEL_MISMATCH']));
    for (const r of rows.body.data) {
      const decision = r.flags.includes('TRUNCATED')
        ? { decision: 'APPROVED', note: 'Approved as truncated' }
        : { decision: 'REJECTED', note: 'Wrong level' };
      expectOk(
        await head.patch(`/curriculum/imports/${first.body.data.id}/rows/${r.id}`, decision),
      );
    }
    const approved = expectOk(await head.post(`/curriculum/imports/${first.body.data.id}/approve`));
    expect(approved.body.data.report).toMatchObject({ imported: 11, rejected: 1 });
    const truncated = await prisma.curriculumEntry.count({ where: { isTruncated: true } });
    expect(truncated).toBe(1);
  });
});
