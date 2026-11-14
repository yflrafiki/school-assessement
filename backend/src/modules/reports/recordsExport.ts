// The school's teaching records as an Excel workbook, for safekeeping outside the system and
// for printing. Everything comes from the database as it is now; nothing is changed.
import type { Request, Response } from 'express';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { ASSESSMENT_LABELS, isoDate, minutesToTime, uuid } from '@school/shared';
import { prisma } from '../../lib/db.js';
import { notFound } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { auth, query } from '../../lib/http.js';
import { fromDbDate, isoWeekday, toDbDate } from '../../lib/dates.js';
import { schoolNow } from '../lessons/lessons.service.js';

const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const CHANGE_LABELS: Record<string, string> = {
  HOLIDAY: 'Cancelled: holiday',
  SPECIAL_WEEK: 'Cancelled: exam or mock week',
  ABSENCE: 'Cancelled: teacher absent',
  SCHOOL_CANCELLATION: 'Cancelled by the school',
};

export interface RecordsExportFilter {
  termId?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
}

/** Builds the workbook. With no term given, the current term (or the latest one) is used. */
export async function buildRecordsWorkbook(schoolId: string, filter: RecordsExportFilter) {
  const school = await prisma.school.findUniqueOrThrow({
    where: { id: schoolId },
    select: { name: true },
  });
  const term = filter.termId
    ? await prisma.term.findFirst({
        where: { id: filter.termId, schoolId },
        include: { academicYear: { select: { name: true } } },
      })
    : ((await prisma.term.findFirst({
        where: { schoolId, isCurrent: true },
        include: { academicYear: { select: { name: true } } },
      })) ??
      (await prisma.term.findFirst({
        where: { schoolId },
        orderBy: { startDate: 'desc' },
        include: { academicYear: { select: { name: true } } },
      })));
  if (!term) throw notFound('Term');

  const now = await schoolNow(schoolId);
  const from = filter.dateFrom ?? fromDbDate(term.startDate);
  const to = filter.dateTo ?? fromDbDate(term.endDate);

  const lessons = await prisma.lesson.findMany({
    where: {
      schoolId,
      assignment: { termId: term.id },
      date: { gte: toDbDate(from), lte: toDbDate(to) },
    },
    include: {
      assignment: {
        select: {
          subject: { select: { name: true } },
          schoolClass: { select: { name: true } },
          teacherProfile: {
            select: { id: true, staffId: true, user: { select: { fullName: true } } },
          },
        },
      },
      record: {
        include: {
          topics: {
            include: {
              entry: { select: { strand: true, subStrand: true, indicator: true } },
            },
          },
        },
      },
    },
    orderBy: [{ date: 'asc' }, { startMinute: 'asc' }, { id: 'asc' }],
  });
  const teachers = await prisma.teacherProfile.findMany({
    where: { schoolId, assignments: { some: { termId: term.id } } },
    select: { id: true, staffId: true, user: { select: { fullName: true, status: true } } },
    orderBy: [{ user: { fullName: 'asc' } }, { id: 'asc' }],
  });

  // A lesson that has ended and needed a record (a scheduled lesson in a curriculum week).
  const ended = (l: (typeof lessons)[number]) => {
    const date = fromDbDate(l.date);
    return date < now.date || (date === now.date && l.endMinute <= now.minutes);
  };
  const submitted = lessons.filter((l) => l.record?.status === 'SUBMITTED');
  const missing = lessons.filter(
    (l) =>
      l.status === 'SCHEDULED' &&
      l.weekNumber !== null &&
      ended(l) &&
      l.record?.status !== 'SUBMITTED',
  );
  const changed = lessons.filter((l) => l.status !== 'SCHEDULED');

  const wb = new ExcelJS.Workbook();
  wb.creator = school.name;
  wb.created = new Date();
  const title = `${school.name}: teaching records, ${term.name} ${term.academicYear.name}`;
  const period = `Lessons from ${from} to ${to}. Downloaded ${now.date} at ${minutesToTime(now.minutes)}.`;

  // 1. Summary per teacher.
  const summary = sheet(wb, 'Summary by teacher', title, period, [
    ['Teacher', 28],
    ['Staff ID', 12],
    ['Lessons that needed a record', 14],
    ['Records submitted', 12],
    ['On time (same day)', 12],
    ['Late', 8],
    ['Not recorded', 12],
    ['Completion %', 12],
    ['Class exercises', 12],
    ['Assignments', 12],
    ['Class tests', 12],
    ['Account', 12],
  ]);
  for (const t of teachers) {
    const own = (l: (typeof lessons)[number]) => l.assignment.teacherProfile.id === t.id;
    const done = submitted.filter(own);
    const notDone = missing.filter(own).length;
    const due = done.length + notDone;
    const given = (k: keyof typeof ASSESSMENT_LABELS) =>
      done.filter((l) => l.record!.assessments.includes(k)).length;
    summary.addRow([
      t.user.fullName,
      t.staffId,
      due,
      done.length,
      done.filter((l) => !l.record!.isLate).length,
      done.filter((l) => l.record!.isLate).length,
      notDone,
      due ? Math.round((done.length / due) * 100) : null,
      given('CLASS_EXERCISE'),
      given('ASSIGNMENT'),
      given('CLASS_TEST'),
      t.user.status === 'ACTIVE'
        ? 'Active'
        : t.user.status === 'PENDING_ACTIVATION'
          ? 'Not activated yet'
          : 'Inactive',
    ]);
  }

  // 2. Every submitted record, in full.
  const records = sheet(wb, 'Lesson records', title, period, [
    ['Lesson date', 12],
    ['Day', 11],
    ['Time', 13],
    ['Week', 7],
    ['Teacher', 24],
    ['Staff ID', 11],
    ['Class', 10],
    ['Subject', 22],
    ['Topics taught', 50],
    ['What was taught', 50],
    ['Topic note', 25],
    ['Learning outcomes', 35],
    ['Challenges', 35],
    ['Remarks', 30],
    ['Work given', 24],
    ['What was given', 30],
    ['Submitted', 18],
    ['On time', 9],
    ['Last edited', 18],
  ]);
  for (const l of submitted) {
    const r = l.record!;
    records.addRow([
      fromDbDate(l.date),
      DAYS[isoWeekday(fromDbDate(l.date))],
      `${minutesToTime(l.startMinute)}–${minutesToTime(l.endMinute)}`,
      r.weekNumber,
      l.assignment.teacherProfile.user.fullName,
      l.assignment.teacherProfile.staffId,
      l.assignment.schoolClass.name,
      l.assignment.subject.name,
      r.topics
        .map((t) => `${t.entry.strand} › ${t.entry.subStrand}: ${t.entry.indicator}`)
        .join('\n'),
      r.taughtSummary,
      r.topicNote ?? '',
      r.outcomes ?? '',
      r.challenges ?? '',
      r.remarks ?? '',
      r.assessments.length ? r.assessments.map((k) => ASSESSMENT_LABELS[k]).join(', ') : 'None',
      r.assessmentNote ?? '',
      r.submittedAt ? dateTime(r.submittedAt) : '',
      r.isLate ? 'Late' : 'Yes',
      r.lastEditedAt ? dateTime(r.lastEditedAt) : '',
    ]);
  }
  records.getColumn(9).alignment = { wrapText: true, vertical: 'top' };
  records.getColumn(10).alignment = { wrapText: true, vertical: 'top' };

  // 3. Lessons that ended without a submitted record.
  const notRecorded = sheet(wb, 'Not recorded', title, period, [
    ['Lesson date', 12],
    ['Day', 11],
    ['Time', 13],
    ['Week', 7],
    ['Teacher', 24],
    ['Staff ID', 11],
    ['Class', 10],
    ['Subject', 22],
    ['Draft saved', 11],
  ]);
  for (const l of missing) {
    notRecorded.addRow([
      fromDbDate(l.date),
      DAYS[isoWeekday(fromDbDate(l.date))],
      `${minutesToTime(l.startMinute)}–${minutesToTime(l.endMinute)}`,
      l.weekNumber,
      l.assignment.teacherProfile.user.fullName,
      l.assignment.teacherProfile.staffId,
      l.assignment.schoolClass.name,
      l.assignment.subject.name,
      l.record?.status === 'DRAFT' ? 'Yes' : 'No',
    ]);
  }

  // 4. Lessons cancelled, waived or moved, with the reason.
  const changes = sheet(wb, 'Cancelled or moved', title, period, [
    ['Lesson date', 12],
    ['Day', 11],
    ['Time', 13],
    ['Teacher', 24],
    ['Class', 10],
    ['Subject', 22],
    ['What happened', 28],
    ['Reason', 45],
  ]);
  for (const l of changed) {
    changes.addRow([
      fromDbDate(l.date),
      DAYS[isoWeekday(fromDbDate(l.date))],
      `${minutesToTime(l.startMinute)}–${minutesToTime(l.endMinute)}`,
      l.assignment.teacherProfile.user.fullName,
      l.assignment.schoolClass.name,
      l.assignment.subject.name,
      l.status === 'WAIVED'
        ? 'No record needed'
        : l.status === 'RESCHEDULED'
          ? 'Moved to another day'
          : (CHANGE_LABELS[l.cancelReason ?? ''] ?? 'Cancelled'),
      l.reason ?? '',
    ]);
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const safe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return {
    buffer,
    filename: `teaching-records-${safe(term.name)}-${safe(term.academicYear.name)}-${now.date}.xlsx`,
    counts: { records: submitted.length, notRecorded: missing.length, changed: changed.length },
    termId: term.id,
  };
}

/** A sheet with a title, a note on the period, and a bold, filterable header row that stays in view. */
function sheet(
  wb: ExcelJS.Workbook,
  name: string,
  title: string,
  period: string,
  columns: [header: string, width: number][],
) {
  const ws = wb.addWorksheet(name);
  ws.addRow([title]).font = { bold: true, size: 14 };
  ws.addRow([period]).font = { italic: true, color: { argb: 'FF555555' } };
  ws.addRow([]);
  const header = ws.addRow(columns.map(([h]) => h));
  header.font = { bold: true };
  header.alignment = { wrapText: true, vertical: 'middle' };
  header.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6EEF5' } };
  });
  columns.forEach(([, width], i) => (ws.getColumn(i + 1).width = width));
  ws.views = [{ state: 'frozen', ySplit: 4 }];
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: columns.length } };
  return ws;
}

/** Date and time in the school's zone (Ghana is UTC all year). */
function dateTime(d: Date) {
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

const exportQuery = z.object({
  termId: uuid.optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

/** Sends the workbook as a download. Who downloaded what is kept in the activity log. */
export async function sendRecordsExport(req: Request, res: Response, schoolId: string) {
  const q = query(req, exportQuery);
  const file = await buildRecordsWorkbook(schoolId, q);
  await audit(prisma, {
    schoolId,
    actorId: auth(req).userId,
    action: 'records.exported',
    entityType: 'Term',
    entityId: file.termId,
    metadata: { ...q, ...file.counts },
    requestId: req.requestId,
  });
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.send(file.buffer);
}
