import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { FiChevronLeft, FiChevronRight, FiLock } from 'react-icons/fi';
import {
  minutesToTime,
  type LessonState,
  type LessonStatus,
  type RecordStatus,
} from '@school/shared';
import { api, type One } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { useUrlState } from '../../lib/useUrlState';
import { PageHeader, Section } from '../../components/PageHeader';
import { EmptyState, QueryView } from '../../components/States';
import { StatusBadge } from '../../components/StatusBadge';
import type { AssignmentProgress, CurriculumEntry, WeekStatus } from '../../types/api';
import { TopicText } from '../curriculum/TopicText';

interface WeekLesson {
  id: string;
  date: string;
  startMinute: number;
  endMinute: number;
  status: LessonStatus;
  state: LessonState;
  record: { id: string; status: RecordStatus } | null;
}
interface WeekView {
  weekNumber: number;
  assignments: (AssignmentProgress & { week: WeekStatus | null; lessons: WeekLesson[] })[];
}

export function SchemeOfWork() {
  const progress = useQuery({
    queryKey: ['progress', 'me'],
    queryFn: () =>
      api.get<One<{ assignments: AssignmentProgress[] }>>('/progress/me').then((r) => r.data),
  });
  // Default to the earliest week that still needs work.
  const defaultWeek =
    progress.data?.assignments
      .map((a) => a.currentWeek)
      .filter((w): w is number => w !== null)
      .sort((a, b) => a - b)[0] ?? 1;
  const { values, set } = useUrlState(['week'] as const);
  const week = Number(values.week) || defaultWeek;
  const maxWeek = Math.max(
    14,
    ...(progress.data?.assignments.flatMap((a) => a.weeks?.map((w) => w.weekNumber) ?? []) ?? []),
  );

  const view = useQuery({
    queryKey: ['progress', 'me', 'week', week],
    queryFn: () => api.get<One<WeekView>>(`/progress/me/weeks/${week}`).then((r) => r.data),
    enabled: progress.isSuccess,
  });

  return (
    <>
      <PageHeader
        title="Weekly scheme of work"
        description="Lessons are placed onto curriculum weeks in order. Finish each week before moving on."
        actions={
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="btn-secondary px-2"
              disabled={week <= 1}
              onClick={() => set({ week: String(week - 1) })}
              aria-label="Previous week"
            >
              <FiChevronLeft aria-hidden />
            </button>
            <label className="sr-only" htmlFor="week-select">
              Curriculum week
            </label>
            <select
              id="week-select"
              className="input w-32"
              value={week}
              onChange={(e) => set({ week: e.target.value })}
            >
              {Array.from({ length: maxWeek }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  Week {i + 1}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-secondary px-2"
              disabled={week >= maxWeek}
              onClick={() => set({ week: String(week + 1) })}
              aria-label="Next week"
            >
              <FiChevronRight aria-hidden />
            </button>
          </div>
        }
      />
      <QueryView query={progress}>
        {() => (
          <QueryView query={view}>
            {(v) =>
              v.assignments.length ? (
                <div className="space-y-5">
                  {v.assignments.map((a) => (
                    <AssignmentWeek key={a.assignmentId} a={a} weekNumber={week} />
                  ))}
                </div>
              ) : (
                <Section>
                  <EmptyState
                    title="No classes this term"
                    description="Your headmaster assigns your subjects and classes."
                  />
                </Section>
              )
            }
          </QueryView>
        )}
      </QueryView>
    </>
  );
}

function AssignmentWeek({
  a,
  weekNumber,
}: {
  a: WeekView['assignments'][number];
  weekNumber: number;
}) {
  const topics = useQuery({
    queryKey: ['curriculum', a.schoolClass.level, a.subject.id, weekNumber],
    queryFn: () =>
      api
        .get<One<{ entries: CurriculumEntry[] }>>('/curriculum', {
          level: a.schoolClass.level,
          subjectId: a.subject.id,
          weekNumber,
        })
        .then((r) => r.data.entries),
  });
  const w = a.week;

  return (
    <Section
      title={`${a.subject.name} · ${a.schoolClass.name}`}
      actions={
        w ? (
          <div className="flex items-center gap-2">
            <StatusBadge status={w.kind} />
            {w.required &&
              (w.complete ? (
                <StatusBadge status="COMPLETED" />
              ) : !w.unlocked ? (
                <StatusBadge status="LOCKED" />
              ) : null)}
          </div>
        ) : null
      }
    >
      {w && !w.unlocked && (
        <div className="flex items-start gap-2 border-b border-line bg-canvas px-4 py-3 text-sm text-muted">
          <FiLock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{w.lockedReason}</span>
        </div>
      )}
      {w && !w.required && (
        <p className="border-b border-line px-4 py-3 text-sm text-muted">
          This is a {w.kind.toLowerCase()} week. No lesson records are needed.
        </p>
      )}
      <div className="grid gap-0 md:grid-cols-2 md:divide-x md:divide-line">
        <div>
          <h3 className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-muted">
            Lessons ({a.lessons.length} of {a.perWeek})
          </h3>
          {a.lessons.length ? (
            <ul className="divide-y divide-line">
              {a.lessons.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="text-sm">
                    {formatDate(l.date)}, {minutesToTime(l.startMinute)}
                  </span>
                  <span className="flex items-center gap-2">
                    <StatusBadge status={l.state} />
                    {l.record?.status === 'SUBMITTED' ? (
                      <Link to={`/t/records/${l.record.id}`} className="link text-sm">
                        View
                      </Link>
                    ) : l.status === 'SCHEDULED' && l.state !== 'UPCOMING' ? (
                      <Link to={`/t/lessons/${l.id}/record`} className="link text-sm">
                        {l.record ? 'Continue' : 'Record'}
                      </Link>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-3 text-sm text-muted">No lessons placed in this week yet.</p>
          )}
        </div>
        <div>
          <h3 className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-muted">
            Topics in the scheme
          </h3>
          <QueryView query={topics}>
            {(entries) =>
              entries.length ? (
                <ul className="divide-y divide-line">
                  {entries.map((e) => (
                    <li key={e.id} className="px-4 py-2.5">
                      <TopicText entry={e} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-4 py-3 text-sm text-muted">No topics published for this week.</p>
              )
            }
          </QueryView>
        </div>
      </div>
    </Section>
  );
}
