// Development only (kept out of the production build, tsconfig.build.json): fills the LOCAL database with a realistic Ipel demo, through the app's own
// API (the same rules as the screens): term and weeks, FORM 1-3, the real scheme of learning
// and timetable PDFs, one teacher per subject, recording from this week, and some lessons
// already recorded so the headmaster's pages have something to show.
// Usage: pnpm --filter @school/api seed-demo
// It wipes the local database first and refuses to run against anything but localhost.
import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import pg from 'pg';
import request from 'supertest';
import { env } from '../config/env.js';
import { createApp } from '../app.js';
import { prisma } from '../lib/db.js';
import { hashPassword } from '../lib/password.js';
import { addDays, isoWeekday, localNow } from '../lib/dates.js';
import { rowsFromSheets } from '../../../frontend/src/features/headmaster/timetableFile.js';

const DOWNLOADS = 'C:/Users/ratda/Downloads';
const SCHEME_PDF = `${DOWNLOADS}/First term scheme of work2 jhs current 2026-2027A (1).pdf`;
const TIMETABLE_PDF = `${DOWNLOADS}/JHS TIME TABLE.pdf`;

export const DEMO = {
  school: 'IPEL International School',
  headmaster: {
    name: 'Mrs Agnes Ofori-Atta',
    email: 'headmaster@ipel.demo',
    password: 'Ipel-Head-2026',
  },
  admin: { name: 'System Admin', email: 'admin@ipel.demo', password: 'Ipel-Admin-2026' },
  teacherPassword: 'Ipel-Teacher-2026',
};

/** One teacher per subject, each teaching it in FORM 1 to FORM 3. The first is the demo teacher. */
const TEACHERS = [
  { name: 'Kofi Boateng', email: 'kofi@ipel.demo', subject: 'English Language', recorded: 'some' },
  { name: 'Ama Owusu', email: 'ama@ipel.demo', subject: 'Mathematics', recorded: 'all' },
  { name: 'Yaw Mensah', email: 'yaw@ipel.demo', subject: 'Science', recorded: 'all' },
  { name: 'Akosua Darko', email: 'akosua@ipel.demo', subject: 'Social Studies', recorded: 'all' },
  {
    name: 'Kwame Asante',
    email: 'kwame@ipel.demo',
    subject: 'Religious and Moral Education',
    recorded: 'all',
  },
  { name: 'Efua Ansah', email: 'efua@ipel.demo', subject: 'Computing', recorded: 'all' },
  {
    name: 'Kojo Appiah',
    email: 'kojo@ipel.demo',
    subject: 'Creative Arts and Design',
    recorded: 'none',
  },
  { name: 'Abena Ofori', email: 'abena@ipel.demo', subject: 'Career Technology', recorded: 'all' },
  { name: 'Esi Quaye', email: 'esi@ipel.demo', subject: 'French', recorded: 'none' },
  { name: 'Kwabena Adjei', email: 'kwabena@ipel.demo', subject: 'Asante Twi', recorded: 'all' },
] as const;

const SUMMARIES = [
  'Introduced the topic with examples from daily life, then learners worked in pairs on the exercise.',
  'Revised the previous lesson, explained the new idea on the board and gave a short class exercise.',
  'Learners read the passage aloud in groups and answered questions; I corrected common mistakes.',
  'Demonstrated with teaching aids, learners practised and three volunteers presented their answers.',
];

function guard() {
  const host = new URL(env.DATABASE_URL).hostname;
  if (env.NODE_ENV === 'production' || !['localhost', '127.0.0.1'].includes(host)) {
    console.error(
      `Refusing to run: this only fills a local database (DATABASE_URL host is ${host}).`,
    );
    process.exit(1);
  }
  for (const f of [SCHEME_PDF, TIMETABLE_PDF]) {
    if (!existsSync(f)) {
      console.error(`Missing ${f}`);
      process.exit(1);
    }
  }
}

const app = createApp();

class Tab {
  token = '';
  private auth<T extends { set: (k: string, v: string) => T }>(r: T): T {
    return this.token ? r.set('Authorization', `Bearer ${this.token}`) : r;
  }
  async send(method: 'get' | 'post' | 'put' | 'patch', path: string, body?: object) {
    const r = this.auth(request(app)[method](`/api/v1${path}`));
    const res = body === undefined ? await r : await r.send(body);
    if (res.status >= 300) {
      throw new Error(
        `${method.toUpperCase()} ${path} → ${res.status}: ${JSON.stringify(res.body)}`,
      );
    }
    return res.body;
  }
  async pdf(path: string, file: string) {
    const res = await this.auth(request(app).post(`/api/v1${path}`))
      .set('Content-Type', 'application/pdf')
      .send(readFileSync(file));
    if (res.status >= 300)
      throw new Error(`PDF ${path} → ${res.status}: ${JSON.stringify(res.body)}`);
    return res.body;
  }
  async login(email: string, password: string) {
    this.token = (await this.send('post', '/auth/login', { email, password })).data.token;
    return this;
  }
}

async function wipe() {
  const sql = readFileSync(
    new URL('../../prisma/scripts/reset-for-demo.sql', import.meta.url),
    'utf8',
  );
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    // The reset keeps a headmaster; make sure one exists, then clear the rest as well.
    const head = await client.query(`SELECT 1 FROM users WHERE role = 'HEADMASTER' LIMIT 1`);
    if (head.rowCount) await client.query(sql);
    await client.query('DELETE FROM users');
  } finally {
    await client.end();
  }
}

async function main() {
  guard();
  console.log('1. Clearing the local database…');
  await wipe();

  const school =
    (await prisma.school.findFirst()) ??
    (await prisma.school.create({ data: { name: DEMO.school } }));
  await prisma.school.update({ where: { id: school.id }, data: { name: DEMO.school } });
  await prisma.user.create({
    data: {
      schoolId: school.id,
      email: DEMO.headmaster.email,
      fullName: DEMO.headmaster.name,
      role: 'HEADMASTER',
      status: 'ACTIVE',
      passwordHash: await hashPassword(DEMO.headmaster.password),
      passwordChangedAt: new Date(),
    },
  });
  await prisma.user.create({
    data: {
      schoolId: null,
      email: DEMO.admin.email,
      fullName: DEMO.admin.name,
      role: 'SYSTEM_ADMIN',
      status: 'ACTIVE',
      passwordHash: await hashPassword(DEMO.admin.password),
      passwordChangedAt: new Date(),
    },
  });
  const head = await new Tab().login(DEMO.headmaster.email, DEMO.headmaster.password);

  console.log('2. Term, weeks, classes and Twi…');
  const year = (
    await head.send('post', '/academic-years', {
      name: '2026/2027',
      startDate: '2026-09-01',
      endDate: '2027-07-31',
    })
  ).data;
  const term = (
    await head.send('post', '/terms', {
      academicYearId: year.id,
      number: 1,
      name: 'First Term',
      startDate: '2026-09-14',
      endDate: '2026-12-18',
    })
  ).data;
  await head.send('put', `/terms/${term.id}/weeks`, {
    weeks: Array.from({ length: 14 }, (_, i) => ({
      weekNumber: i + 1,
      startDate: addDays('2026-09-14', i * 7),
      endDate: addDays('2026-09-14', i * 7 + 4),
    })),
  });
  const classIds: string[] = [];
  for (const [level, name] of [
    ['BASIC_7', 'FORM 1'],
    ['BASIC_8', 'FORM 2'],
    ['BASIC_9', 'FORM 3'],
  ]) {
    classIds.push((await head.send('post', '/classes', { level, name })).data.id);
  }
  await head.send('post', '/subjects', { name: 'Asante Twi' });

  console.log('3. Scheme of learning (the real PDF)…');
  const scheme = await head.pdf(
    `/curriculum/imports/pdf?termId=${term.id}&fileName=scheme-of-learning.pdf`,
    SCHEME_PDF,
  );
  console.log(`   ${scheme.data.report.imported} topics live`);

  console.log('4. Teachers…');
  const subjects = (await head.send('get', '/subjects')).data as { id: string; name: string }[];
  const teacherHash = await hashPassword(DEMO.teacherPassword);
  for (const [i, t] of TEACHERS.entries()) {
    const subject = subjects.find((s) => s.name === t.subject);
    if (!subject) throw new Error(`No subject ${t.subject}`);
    const created = (
      await head.send('post', '/teachers', {
        fullName: t.name,
        email: t.email,
        staffId: `GES-${1001 + i}`,
        assignments: classIds.map((classId) => ({ subjectId: subject.id, classId })),
      })
    ).data;
    // Demo teachers are ready to sign in: no invitation emails needed.
    await prisma.user.update({
      where: { id: created.userId },
      data: { status: 'ACTIVE', passwordHash: teacherHash, passwordChangedAt: new Date() },
    });
  }
  await prisma.authToken.deleteMany({});
  await prisma.emailOutbox.deleteMany({});

  console.log('5. Timetable (the real PDF)…');
  const read = (await head.pdf('/timetable/import/pdf', TIMETABLE_PDF)).data;
  const { rows } = rowsFromSheets(read.sheets);
  const saved = (
    await head.send('post', '/timetable/import', { termId: term.id, dryRun: false, rows })
  ).data;
  const problems = (saved.rows as { error?: string }[]).filter((r) => r.error);
  if (!saved.saved) throw new Error(`Timetable not saved: ${JSON.stringify(problems.slice(0, 3))}`);
  console.log(`   ${saved.created} lessons a week`);

  console.log('6. Recording starts this week…');
  const today = localNow(school.timezone).date;
  const monday = addDays(today, 1 - isoWeekday(today));
  await head.send('post', '/lessons/waive-before', { termId: term.id, date: monday });

  console.log('7. Lessons already recorded this week…');
  let recorded = 0;
  for (const [i, t] of TEACHERS.entries()) {
    if (t.recorded === 'none') continue;
    const tab = await new Tab().login(t.email, DEMO.teacherPassword);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: t.email },
      include: { teacherProfile: true },
    });
    const lessons = await prisma.lesson.findMany({
      where: {
        assignment: { teacherProfileId: user.teacherProfile!.id },
        status: 'SCHEDULED',
        date: { gte: new Date(`${monday}T00:00:00Z`), lt: new Date(`${today}T00:00:00Z`) },
        weekNumber: { not: null },
      },
      orderBy: [{ date: 'asc' }, { startMinute: 'asc' }],
    });
    // The demo teacher records some and leaves one overdue; the rest record everything.
    const toRecord = t.recorded === 'some' ? lessons.slice(0, 1) : lessons;
    for (const [n, l] of toRecord.entries()) {
      const topics = (await tab.send('get', `/curriculum/topics?lessonId=${l.id}`)).data
        .entries as { id: string }[];
      if (!topics.length) continue;
      await tab.send('post', '/teaching-records', {
        lessonId: l.id,
        entryIds: topics.slice(0, 2).map((e) => e.id),
        taughtSummary: SUMMARIES[(i + n) % SUMMARIES.length],
        outcomes: 'Most learners could explain the main idea in their own words.',
        status: 'SUBMITTED',
      });
      recorded += 1;
    }
  }
  console.log(`   ${recorded} lesson records`);

  // They were written just now; make them look like records written right after each lesson
  // (on time, not "today"), and leave the headmaster's bell quiet for the live demo.
  const records = await prisma.teachingRecord.findMany({ include: { lesson: true } });
  for (const r of records) {
    const at = new Date(r.lesson.date.getTime() + (r.lesson.endMinute + 25) * 60_000);
    await prisma.teachingRecord.update({
      where: { id: r.id },
      data: { submittedAt: at, createdAt: at, isLate: false },
    });
    await prisma.notification.updateMany({
      where: { recordId: r.id },
      data: { createdAt: at, readAt: at },
    });
  }

  console.log(`
Demo ready (local only). Open http://localhost:5173

  Headmaster  ${DEMO.headmaster.email}   ${DEMO.headmaster.password}
  Teacher     ${TEACHERS[0].email}         ${DEMO.teacherPassword}   (${TEACHERS[0].subject}, FORM 1-3)
  Admin       ${DEMO.admin.email}        ${DEMO.admin.password}

Every other teacher (e.g. ama@ipel.demo) also uses ${DEMO.teacherPassword}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
