import { Link } from 'react-router-dom';
import { StatusBadge } from '../../components/StatusBadge';
import { formatDate } from '../../lib/format';
import type { Lesson } from '../../types/api';

/** Whether a teacher can open the record form for this lesson. */
export function canRecord(l: Lesson) {
  return (
    l.status === 'SCHEDULED' &&
    l.weekNumber !== null &&
    l.state !== 'UPCOMING' &&
    l.record?.status !== 'SUBMITTED'
  );
}

export function LessonActions({ lesson }: { lesson: Lesson }) {
  if (lesson.record?.status === 'SUBMITTED') {
    return (
      <Link to={`/t/records/${lesson.record.id}`} className="btn-secondary">
        View record
      </Link>
    );
  }
  if (canRecord(lesson)) {
    return (
      <Link to={`/t/lessons/${lesson.id}/record`} className="btn-primary">
        {lesson.record?.status === 'DRAFT' ? 'Continue draft' : 'Record lesson'}
      </Link>
    );
  }
  return null;
}

/** Compact list of a teacher's lessons with state and the next action. */
export function TeacherLessonList({
  lessons,
  showDate = false,
}: {
  lessons: Lesson[];
  showDate?: boolean;
}) {
  return (
    <ul className="divide-y divide-line">
      {lessons.map((l) => (
        <li
          key={l.id}
          className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <p className="font-medium">
              {l.assignment.subject.name}{' '}
              <span className="text-muted">· {l.assignment.schoolClass.name}</span>
            </p>
            <p className="text-sm text-muted">
              {showDate && `${formatDate(l.date)}, `}
              {l.startTime}–{l.endTime}
              {l.weekNumber !== null
                ? ` · Curriculum week ${l.weekNumber}`
                : l.status === 'SCHEDULED'
                  ? ' · Beyond the scheme'
                  : ''}
              {l.reason ? ` · ${l.reason}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={l.state} />
            <LessonActions lesson={l} />
          </div>
        </li>
      ))}
    </ul>
  );
}
