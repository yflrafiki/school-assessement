import {
  RECORD_EDIT_WINDOW_HOURS,
  REQUIRED_WEEK_KINDS,
  minutesToTime,
  type ListRecordsQuery,
  type SubmitRecordBody,
  type WeekLockedDetails,
} from '@school/shared';
import { prisma, type Prisma } from '../../lib/db.js';
import { AppError, isUniqueViolation, notFound, validation } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { fromDbDate, localNow, toDbDate } from '../../lib/dates.js';
import { pageArgs, pageMeta } from '../../lib/pagination.js';
import { lockAssignment, syncAssignment } from '../lessons/lessons.service.js';
import { loadTermCalendar } from '../lessons/weekKinds.js';
import { topicsFor } from '../curriculum/curriculum.service.js';
import { assignmentWeekStatus } from '../progress/progress.service.js';

interface TeacherActor {
  schoolId: string;
  userId: string;
  teacherProfileId: string;
  fullName: string;
  requestId: string;
}

const duplicate = () =>
  new AppError('DUPLICATE_TEACHING_RECORD', 'This lesson already has a submitted record');

/**
 * Records a lesson (draft or submitted) following the agreed submission algorithm.
 * Everything happens under the assignment row lock, in one transaction.
 */
export async function submitRecord(actor: TeacherActor, input: SubmitRecordBody) {
  const lessonRef = await prisma.lesson.findFirst({
    where: { id: input.lessonId, schoolId: actor.schoolId },
    select: { assignmentId: true },
  });
  if (!lessonRef) throw notFound('Lesson');

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 2. Lock the assignment; another teacher's lesson is indistinguishable from a missing one.
      const locked = await lockAssignment(
        tx,
        actor.schoolId,
        lessonRef.assignmentId,
        actor.teacherProfileId,
      );
      if (!locked) throw notFound('Lesson');

      // 3. Re-read under the lock.
      const lesson = await tx.lesson.findUniqueOrThrow({
        where: { id: input.lessonId },
        include: {
          record: true,
          assignment: {
            include: { subject: true, schoolClass: true, school: { select: { timezone: true } } },
          },
        },
      });
      if (lesson.status !== 'SCHEDULED') {
        throw new AppError(
          'CONFLICT',
          `This lesson was ${lesson.status.toLowerCase()} and cannot be recorded`,
        );
      }
      if (lesson.record?.status === 'SUBMITTED') throw duplicate();

      // 4. Must be paced onto a curriculum week.
      if (lesson.weekNumber === null) {
        throw new AppError(
          'CONFLICT',
          'This lesson falls beyond the scheme of learning and cannot be recorded',
        );
      }

      // 5. No recording before the lesson starts (school timezone).
      const now = localNow(lesson.assignment.school.timezone);
      const date = fromDbDate(lesson.date);
      if (date > now.date || (date === now.date && lesson.startMinute > now.minutes)) {
        throw new AppError(
          'CONFLICT',
          `This lesson starts at ${minutesToTime(lesson.startMinute)} on ${date}. You can record it once it has started.`,
        );
      }

      // 6. Only teaching and revision weeks take records.
      const { assignment } = lesson;
      const calendar = await loadTermCalendar(
        tx,
        actor.schoolId,
        assignment.termId,
        assignment.classId,
        assignment.schoolClass.level,
      );
      const kind = calendar.kinds.get(lesson.weekNumber) ?? 'TEACHING';
      if (!REQUIRED_WEEK_KINDS.includes(kind)) {
        throw new AppError(
          'CONFLICT',
          `Week ${lesson.weekNumber} is a ${kind.toLowerCase()} week and needs no records`,
        );
      }

      // 7. Locking: an earlier required week with an unrecorded scheduled lesson blocks submission.
      if (input.status === 'SUBMITTED') {
        const earlier = calendar.requiredWeeks.filter((w) => w < (lesson.weekNumber as number));
        if (earlier.length) {
          const outstanding = await tx.lesson.findMany({
            where: {
              assignmentId: assignment.id,
              status: 'SCHEDULED',
              weekNumber: { in: earlier },
              OR: [{ record: { is: null } }, { record: { is: { status: 'DRAFT' } } }],
            },
            orderBy: [{ weekNumber: 'asc' }, { date: 'asc' }, { startMinute: 'asc' }],
          });
          const first = outstanding[0];
          if (first && first.weekNumber !== null) {
            const blockingWeek = first.weekNumber;
            const details: WeekLockedDetails = {
              requestedWeek: lesson.weekNumber,
              blockingWeek,
              outstandingLessons: outstanding
                .filter((l) => l.weekNumber === blockingWeek)
                .map((l) => ({
                  id: l.id,
                  date: fromDbDate(l.date),
                  startTime: minutesToTime(l.startMinute),
                })),
            };
            throw new AppError(
              'WEEK_LOCKED',
              `Week ${lesson.weekNumber} is locked. Record the outstanding lessons of week ${blockingWeek} first, or ask the headmaster for an exception.`,
              details,
            );
          }
        }
      }

      // 8. Topics must belong to this week and subject.
      const allowed = await topicsFor(
        tx,
        actor.schoolId,
        assignment.termId,
        assignment.schoolClass.level,
        assignment.subject,
        lesson.weekNumber,
      );
      const allowedIds = new Set(allowed.map((e) => e.id));
      const entryIds = [...new Set(input.entryIds)];
      if (entryIds.some((id) => !allowedIds.has(id))) {
        throw validation({ entryIds: ['Choose topics from this week of the scheme'] });
      }
      if (input.status === 'SUBMITTED') {
        if (kind === 'TEACHING' && entryIds.length === 0) {
          throw validation({
            entryIds: [
              allowed.length
                ? 'Choose at least one topic you taught'
                : 'No topics are published for this week yet. Ask the headmaster.',
            ],
          });
        }
        if (kind === 'REVISION' && entryIds.length === 0 && !input.topicNote) {
          throw validation({
            topicNote: ['Choose topics revised or describe them in the topic note'],
          });
        }
      }

      // 9. Upsert keyed by lesson.
      const submittedAt = input.status === 'SUBMITTED' ? new Date() : null;
      const data = {
        status: input.status,
        taughtSummary: input.taughtSummary,
        topicNote: input.topicNote ?? null,
        outcomes: input.outcomes ?? null,
        challenges: input.challenges ?? null,
        remarks: input.remarks ?? null,
        weekNumber: lesson.weekNumber,
        submittedAt,
        isLate: input.status === 'SUBMITTED' ? now.date > date : false,
      };
      const record = lesson.record
        ? await tx.teachingRecord.update({ where: { id: lesson.record.id }, data })
        : await tx.teachingRecord.create({
            data: {
              ...data,
              schoolId: actor.schoolId,
              lessonId: lesson.id,
              assignmentId: assignment.id,
              teacherProfileId: actor.teacherProfileId,
            },
          });
      await tx.teachingRecordTopic.deleteMany({ where: { recordId: record.id } });
      if (entryIds.length) {
        await tx.teachingRecordTopic.createMany({
          data: entryIds.map((entryId) => ({ recordId: record.id, entryId })),
        });
      }

      // 10. Submission side effects in the same transaction.
      if (input.status === 'SUBMITTED') {
        await syncAssignment(tx, assignment.id, { generate: false });
        const headmasters = await tx.user.findMany({
          where: { schoolId: actor.schoolId, role: 'HEADMASTER', status: 'ACTIVE' },
          select: { id: true },
        });
        if (headmasters.length) {
          await tx.notification.createMany({
            data: headmasters.map((h) => ({
              schoolId: actor.schoolId,
              recipientId: h.id,
              type: 'RECORD_SUBMITTED' as const,
              recordId: record.id,
              title: `${actor.fullName} recorded ${assignment.subject.name}, ${assignment.schoolClass.name}`,
              body: `Week ${lesson.weekNumber}, lesson of ${date} at ${minutesToTime(lesson.startMinute)}${data.isLate ? ' (submitted late)' : ''}.`,
            })),
            skipDuplicates: true,
          });
        }
        await audit(tx, {
          schoolId: actor.schoolId,
          actorId: actor.userId,
          action: 'record.submitted',
          entityType: 'TeachingRecord',
          entityId: record.id,
          metadata: {
            lessonId: lesson.id,
            weekNumber: lesson.weekNumber,
            topics: entryIds.length,
            isLate: data.isLate,
          },
          requestId: actor.requestId,
        });
      } else if (!lesson.record) {
        await audit(tx, {
          schoolId: actor.schoolId,
          actorId: actor.userId,
          action: 'record.draft_created',
          entityType: 'TeachingRecord',
          entityId: record.id,
          metadata: { lessonId: lesson.id },
          requestId: actor.requestId,
        });
      }
      return { recordId: record.id, assignmentId: assignment.id, weekNumber: lesson.weekNumber };
    });

    // 11. Lesson state and the week's status after commit.
    const [record, week] = await Promise.all([
      getRecord(actor.schoolId, result.recordId, { teacherProfileId: actor.teacherProfileId }),
      assignmentWeekStatus(actor.schoolId, result.assignmentId, result.weekNumber),
    ]);
    return { record, week };
  } catch (err) {
    // Two concurrent first-saves for one lesson: the unique lesson_id constraint decides.
    if (isUniqueViolation(err, 'lesson_id') || isUniqueViolation(err, 'lessonId'))
      throw duplicate();
    throw err;
  }
}

/** The owner may correct the text of a submitted record for 48 hours. Topics and lesson stay fixed. */
export async function editRecord(
  actor: TeacherActor,
  recordId: string,
  input: {
    taughtSummary?: string | undefined;
    topicNote?: string | undefined;
    outcomes?: string | undefined;
    challenges?: string | undefined;
    remarks?: string | undefined;
  },
) {
  await prisma.$transaction(async (tx) => {
    const record = await tx.teachingRecord.findFirst({
      where: { id: recordId, schoolId: actor.schoolId, teacherProfileId: actor.teacherProfileId },
    });
    if (!record) throw notFound('Record');
    if (record.status !== 'SUBMITTED' || !record.submittedAt) {
      throw new AppError('CONFLICT', 'Drafts are edited from the lesson form');
    }
    const deadline = record.submittedAt.getTime() + RECORD_EDIT_WINDOW_HOURS * 3600 * 1000;
    if (Date.now() > deadline) {
      throw new AppError(
        'CONFLICT',
        `Records can only be edited within ${RECORD_EDIT_WINDOW_HOURS} hours of submission`,
      );
    }
    const changed = Object.entries(input)
      .filter(([k, v]) => v !== undefined && v !== record[k as keyof typeof record])
      .map(([k]) => k);
    if (!changed.length) return;
    await tx.teachingRecord.update({
      where: { id: record.id },
      data: {
        ...(input.taughtSummary !== undefined ? { taughtSummary: input.taughtSummary } : {}),
        ...(input.topicNote !== undefined ? { topicNote: input.topicNote } : {}),
        ...(input.outcomes !== undefined ? { outcomes: input.outcomes } : {}),
        ...(input.challenges !== undefined ? { challenges: input.challenges } : {}),
        ...(input.remarks !== undefined ? { remarks: input.remarks } : {}),
        lastEditedAt: new Date(),
      },
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: 'record.edited',
      entityType: 'TeachingRecord',
      entityId: record.id,
      // Field names only; the old text stays out of the audit metadata.
      metadata: { fields: changed },
      requestId: actor.requestId,
    });
  });
  return getRecord(actor.schoolId, recordId, { teacherProfileId: actor.teacherProfileId });
}

const recordInclude = {
  lesson: { select: { id: true, date: true, startMinute: true, endMinute: true } },
  assignment: {
    select: {
      id: true,
      subject: { select: { id: true, name: true } },
      schoolClass: { select: { id: true, name: true, level: true } },
    },
  },
  teacherProfile: { select: { id: true, staffId: true, user: { select: { fullName: true } } } },
  _count: { select: { topics: true } },
} satisfies Prisma.TeachingRecordInclude;

type RecordRow = Prisma.TeachingRecordGetPayload<{ include: typeof recordInclude }>;

function toRecordDto(r: RecordRow) {
  const editableUntil =
    r.status === 'SUBMITTED' && r.submittedAt
      ? new Date(r.submittedAt.getTime() + RECORD_EDIT_WINDOW_HOURS * 3600 * 1000)
      : null;
  return {
    id: r.id,
    status: r.status,
    weekNumber: r.weekNumber,
    taughtSummary: r.taughtSummary,
    topicNote: r.topicNote,
    outcomes: r.outcomes,
    challenges: r.challenges,
    remarks: r.remarks,
    isLate: r.isLate,
    submittedAt: r.submittedAt,
    lastEditedAt: r.lastEditedAt,
    editableUntil,
    lesson: {
      id: r.lesson.id,
      date: fromDbDate(r.lesson.date),
      startTime: minutesToTime(r.lesson.startMinute),
      endTime: minutesToTime(r.lesson.endMinute),
    },
    subject: r.assignment.subject,
    schoolClass: r.assignment.schoolClass,
    teacher: {
      id: r.teacherProfile.id,
      staffId: r.teacherProfile.staffId,
      fullName: r.teacherProfile.user.fullName,
    },
    topicCount: r._count.topics,
  };
}

export async function getRecord(
  schoolId: string,
  recordId: string,
  scope: { teacherProfileId?: string } = {},
) {
  const r = await prisma.teachingRecord.findFirst({
    where: {
      id: recordId,
      schoolId,
      // Drafts are private to their author.
      ...(scope.teacherProfileId
        ? { teacherProfileId: scope.teacherProfileId }
        : { status: 'SUBMITTED' }),
    },
    include: {
      ...recordInclude,
      topics: {
        include: {
          entry: {
            select: {
              id: true,
              weekNumber: true,
              strand: true,
              subStrand: true,
              contentStandard: true,
              indicator: true,
              isTruncated: true,
            },
          },
        },
      },
    },
  });
  if (!r) throw notFound('Record');
  return { ...toRecordDto(r), topics: r.topics.map((t) => t.entry) };
}

export async function getRecordForLesson(
  schoolId: string,
  lessonId: string,
  teacherProfileId: string,
) {
  const r = await prisma.teachingRecord.findFirst({
    where: { lessonId, schoolId, teacherProfileId },
    select: { id: true },
  });
  return r ? getRecord(schoolId, r.id, { teacherProfileId }) : null;
}

export async function listRecords(
  schoolId: string,
  q: ListRecordsQuery,
  scope: { teacherProfileId?: string } = {},
) {
  if (
    scope.teacherProfileId &&
    q.teacherProfileId &&
    q.teacherProfileId !== scope.teacherProfileId
  ) {
    return { data: [], meta: pageMeta(q.page, q.pageSize, 0) };
  }
  const and: Prisma.TeachingRecordWhereInput[] = [];
  if (q.q) {
    and.push({
      OR: [
        { teacherProfile: { user: { fullName: { contains: q.q, mode: 'insensitive' } } } },
        { teacherProfile: { staffId: { contains: q.q, mode: 'insensitive' } } },
        { assignment: { subject: { name: { contains: q.q, mode: 'insensitive' } } } },
        { taughtSummary: { contains: q.q, mode: 'insensitive' } },
      ],
    });
  }
  if (q.dateFrom || q.dateTo) {
    and.push({
      lesson: {
        date: {
          ...(q.dateFrom ? { gte: toDbDate(q.dateFrom) } : {}),
          ...(q.dateTo ? { lte: toDbDate(q.dateTo) } : {}),
        },
      },
    });
  }
  const where: Prisma.TeachingRecordWhereInput = {
    schoolId,
    // Headmasters see submitted work; drafts are private to their author.
    ...(scope.teacherProfileId
      ? { teacherProfileId: scope.teacherProfileId }
      : { status: 'SUBMITTED' }),
    ...(q.teacherProfileId ? { teacherProfileId: q.teacherProfileId } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.weekNumber ? { weekNumber: q.weekNumber } : {}),
    ...(q.completion ? { isLate: q.completion === 'LATE' } : {}),
    assignment: {
      ...(q.subjectId ? { subjectId: q.subjectId } : {}),
      ...(q.classId ? { classId: q.classId } : {}),
      ...(q.level ? { schoolClass: { level: q.level } } : {}),
    },
    AND: and,
  };
  const dir = q.sort.startsWith('-') ? 'desc' : 'asc';
  const orderBy: Prisma.TeachingRecordOrderByWithRelationInput[] = q.sort.endsWith('lessonDate')
    ? [{ lesson: { date: dir } }, { lesson: { startMinute: dir } }, { id: 'asc' }]
    : [{ submittedAt: { sort: dir, nulls: 'last' } }, { id: 'asc' }];

  const [rows, total] = await Promise.all([
    prisma.teachingRecord.findMany({
      where,
      include: recordInclude,
      orderBy,
      ...pageArgs(q.page, q.pageSize),
    }),
    prisma.teachingRecord.count({ where }),
  ]);
  return { data: rows.map(toRecordDto), meta: pageMeta(q.page, q.pageSize, total) };
}
