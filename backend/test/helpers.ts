import request from 'supertest';
import type { Response } from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import { hashPassword } from '../src/lib/password.js';
import { setEmailProvider, type EmailMessage, type EmailProvider } from '../src/lib/mailer.js';
import { processNextEmail } from '../src/jobs/outboxWorker.js';
import { addDays, isoWeekday, localNow } from '../src/lib/dates.js';
import { seedSubjects } from '../prisma/seed.js';

export const app = createApp();
export const PASSWORD = 'Correct-Horse-Battery-9';

class CapturingProvider implements EmailProvider {
  readonly name = 'capture';
  sent: EmailMessage[] = [];
  async send(message: EmailMessage) {
    this.sent.push(message);
  }
}
export const mail = new CapturingProvider();
setEmailProvider(mail);

const TABLES = [
  'audit_logs',
  'notifications',
  'teaching_record_topics',
  'teaching_records',
  'lessons',
  'timetable_entries',
  'absences',
  'week_policies',
  'school_calendar_days',
  'curriculum_entries',
  'curriculum_weeks',
  'curriculum_schemes',
  'import_rows',
  'import_batches',
  'teaching_assignments',
  'term_weeks',
  'terms',
  'academic_years',
  'school_classes',
  'email_outbox',
  'auth_tokens',
  'sessions',
  'teacher_profiles',
  'users',
];

export async function resetDb() {
  await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.join(', ')} CASCADE`);
  await prisma.$executeRawUnsafe(`DELETE FROM subjects WHERE school_id IS NOT NULL`);
  await prisma.$executeRawUnsafe(`DELETE FROM schools`);
  await seedSubjects();
  mail.sent = [];
}

/** Sends every queued email through the capturing provider. */
export async function flushEmails() {
  while (await processNextEmail()) {
    /* keep going */
  }
}

export function lastLink(to: string): string {
  const msg = [...mail.sent].reverse().find((m) => m.to === to);
  if (!msg?.params.link) throw new Error(`No email sent to ${to}`);
  return msg.params.link;
}

export function tokenFromLink(link: string): string {
  return link.split('#token=')[1] ?? '';
}

/** Plays one browser tab: it holds its own session token and sends it as a Bearer header. */
export class Client {
  readonly agent = request(app);
  token = '';

  private auth<T extends { set: (k: string, v: string) => T }>(req: T): T {
    return this.token ? req.set('Authorization', `Bearer ${this.token}`) : req;
  }
  get(path: string) {
    return this.auth(this.agent.get(`/api/v1${path}`));
  }
  post(path: string, body: object = {}) {
    return this.auth(this.agent.post(`/api/v1${path}`)).send(body);
  }
  patch(path: string, body: object = {}) {
    return this.auth(this.agent.patch(`/api/v1${path}`)).send(body);
  }
  put(path: string, body: object = {}) {
    return this.auth(this.agent.put(`/api/v1${path}`)).send(body);
  }
  delete(path: string) {
    return this.auth(this.agent.delete(`/api/v1${path}`));
  }

  async login(email: string, password = PASSWORD): Promise<Response> {
    const res = await this.post('/auth/login', { email, password });
    if (res.status === 200) this.token = res.body.data.token;
    return res;
  }
}

export async function createSchoolWithHeadmaster(name = 'Test JHS', email = 'head@test.example') {
  const school = await prisma.school.create({ data: { name } });
  const user = await prisma.user.create({
    data: {
      schoolId: school.id,
      email,
      fullName: 'Ama Mensah',
      role: 'HEADMASTER',
      status: 'ACTIVE',
      passwordHash: await hashPassword(PASSWORD),
    },
  });
  const client = new Client();
  const res = await client.login(email);
  if (res.status !== 200) throw new Error(`Headmaster login failed: ${res.status}`);
  return { school, user, client };
}

/** Monday of the week containing `date`. */
export function mondayOf(date: string) {
  return addDays(date, 1 - isoWeekday(date));
}

export function today() {
  return localNow('Africa/Accra').date;
}

/**
 * Creates a current term of 14 weeks whose week 1 started `weeksAgo` weeks before this week,
 * so early lessons are in the past and can be recorded.
 */
export async function setupTerm(head: Client, weeksAgo = 3) {
  const start = addDays(mondayOf(today()), -7 * weeksAgo);
  const end = addDays(start, 14 * 7 - 3);
  const year = await head.post('/academic-years', {
    name: '2026/2027',
    startDate: addDays(start, -30),
    endDate: addDays(end, 200),
  });
  expectOk(year);
  const term = await head.post('/terms', {
    academicYearId: year.body.data.id,
    number: 1,
    name: 'First Term',
    startDate: start,
    endDate: end,
  });
  expectOk(term);
  const weeks = Array.from({ length: 14 }, (_, i) => ({
    weekNumber: i + 1,
    startDate: addDays(start, i * 7),
    endDate: addDays(start, i * 7 + 4),
  }));
  expectOk(await head.put(`/terms/${term.body.data.id}/weeks`, { weeks }));
  return { termId: term.body.data.id as string, start, end, weeks };
}

export async function subjectId(head: Client, name: string): Promise<string> {
  const res = await head.get('/subjects');
  const s = (res.body.data as { id: string; name: string }[]).find((x) => x.name === name);
  if (!s) throw new Error(`Subject ${name} not found`);
  return s.id;
}

export function expectOk(res: Response) {
  if (res.status >= 300) {
    throw new Error(`Expected success, got ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res;
}

/** Creates a teacher, activates the account through the real invitation flow and logs in. */
export async function createActiveTeacher(
  head: Client,
  input: {
    fullName: string;
    email: string;
    staffId: string;
    assignments?: { subjectId: string; classId: string }[];
    termId?: string;
  },
) {
  const res = expectOk(await head.post('/teachers', { assignments: [], ...input }));
  await flushEmails();
  const token = tokenFromLink(lastLink(input.email));
  const client = new Client();
  const accept = await client.agent
    .post('/api/v1/auth/invitations/accept')
    .send({ token, staffId: input.staffId, password: PASSWORD });
  expectOk(accept);
  client.token = accept.body.data.token;
  return { teacher: res.body.data as { id: string; userId: string }, client };
}

/** A small, valid extraction for one level and subject, weeks 1-12 teaching, 13 revision, 14 exams. */
export function sampleImport(
  termId: string,
  opts: { level?: 'BASIC_7' | 'BASIC_8' | 'BASIC_9'; subject?: string; checksum?: string } = {},
) {
  const level = opts.level ?? 'BASIC_7';
  const subject = opts.subject ?? 'Mathematics';
  const prefix = level.slice(-1);
  const weeks = Array.from({ length: 14 }, (_, i) => ({
    level,
    weekNumber: i + 1,
    kind: i + 1 <= 12 ? 'TEACHING' : i + 1 === 13 ? 'REVISION' : 'EXAMINATION',
  }));
  const rows = Array.from({ length: 12 }, (_, i) => ({
    level,
    subject,
    weekNumber: i + 1,
    strand: 'Number',
    subStrand: 'Number and numeration systems',
    contentStandard: `B${prefix}.1.1.${i + 1} Demonstrate understanding of topic ${i + 1}`,
    indicator: `B${prefix}.1.1.${i + 1}.1 Indicator for week ${i + 1}`,
    sourcePage: 8,
    flags: [],
  }));
  return {
    termId,
    fileName: 'scheme.pdf',
    checksum: opts.checksum ?? 'a'.repeat(64),
    notes: [],
    weeks,
    rows,
  };
}

/** Imports, approves and publishes the sample scheme. */
export async function publishSampleScheme(head: Client, termId: string) {
  const imp = expectOk(await head.post('/curriculum/imports', sampleImport(termId)));
  const approved = expectOk(await head.post(`/curriculum/imports/${imp.body.data.id}/approve`));
  expectOk(await head.post(`/curriculum/schemes/${approved.body.data.schemeId}/publish`));
  return approved.body.data.schemeId as string;
}
