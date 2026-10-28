import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, type One } from '../../lib/api';
import { formatDate, formatShortDate, percent } from '../../lib/format';
import { PageHeader, Section } from '../../components/PageHeader';
import { EmptyState, QueryView } from '../../components/States';
import { HeadOverviewSkeleton } from '../../components/Skeleton';
import { useCurrentUser } from '../auth/useMe';

interface HeadDashboard {
  date: string;
  term: { id: string; name: string; currentWeek: number | null } | null;
  teachers: Partial<Record<'ACTIVE' | 'PENDING_ACTIVATION' | 'DEACTIVATED', number>>;
  today: { counts: Partial<Record<string, number>>; total: number; isClosed: boolean };
  activity: { recordsSubmittedToday: number };
  upToDate: number;
  behind: {
    teacher: { id: string; fullName: string };
    overdueLessons: number;
    oldestOverdue: string | null;
  }[];
  weeklyCompletion: {
    weekNumber: number;
    assignmentsWithLessons: number;
    assignmentsComplete: number;
    rate: number | null;
  }[];
}

function Figure({
  label,
  value,
  note,
  to,
}: {
  label: string;
  value: string | number;
  note?: string;
  to?: string;
}) {
  const body = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</p>
      {note && <p className="mt-0.5 text-xs text-muted">{note}</p>}
    </>
  );
  return to ? (
    <Link to={to} className="card block px-4 py-3 hover:border-accent">
      {body}
    </Link>
  ) : (
    <div className="card px-4 py-3">{body}</div>
  );
}

export function HeadOverview() {
  const me = useCurrentUser();
  const query = useQuery({
    queryKey: ['dashboard', 'headmaster'],
    queryFn: () => api.get<One<HeadDashboard>>('/dashboard/headmaster').then((r) => r.data),
    refetchInterval: 60_000,
  });

  return (
    <>
      <PageHeader
        title="Overview"
        description={
          query.data
            ? `${me.school.name} · ${formatDate(query.data.date)}${query.data.term ? ` · ${query.data.term.name}${query.data.term.currentWeek ? `, week ${query.data.term.currentWeek}` : ''}` : ''}`
            : me.school.name
        }
      />
      <QueryView query={query} skeleton={<HeadOverviewSkeleton />}>
        {(d) => {
          if (!d.term) {
            return (
              <Section>
                <EmptyState
                  title="Set up the school year first"
                  description="Create the academic year, the current term and its weeks, then add classes, teachers and the timetable."
                  action={
                    <Link to="/h/settings" className="btn-primary">
                      Open settings
                    </Link>
                  }
                />
              </Section>
            );
          }
          const c = d.today.counts;
          const currentRate = d.weeklyCompletion
            .filter(
              (w) =>
                w.assignmentsWithLessons > 0 &&
                (d.term?.currentWeek ? w.weekNumber < d.term.currentWeek : true),
            )
            .at(-1);
          return (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Figure
                  label="Lessons today"
                  value={d.today.total}
                  note={
                    d.today.isClosed
                      ? 'School closed today'
                      : `${c.COMPLETED ?? 0} completed, ${c.DUE ?? 0} due`
                  }
                  to="/h/daily"
                />
                <Figure
                  label="Overdue today"
                  value={c.OVERDUE ?? 0}
                  note="From earlier days, still unrecorded"
                  to="/h/daily"
                />
                <Figure
                  label="Teachers up to date"
                  value={`${d.upToDate} of ${d.upToDate + d.behind.length}`}
                  note={`${d.teachers.PENDING_ACTIVATION ?? 0} not yet activated`}
                  to="/h/progress"
                />
                <Figure
                  label="Records submitted today"
                  value={d.activity.recordsSubmittedToday}
                  note="Activity, not completion"
                  to="/h/activity"
                />
              </div>
              <div className="grid gap-5 lg:grid-cols-2">
                <Section
                  title="Teachers behind"
                  actions={
                    <Link to="/h/teachers?progress=BEHIND" className="link text-sm">
                      View all
                    </Link>
                  }
                >
                  {d.behind.length ? (
                    <ul className="divide-y divide-line">
                      {d.behind.map((b) => (
                        <li key={b.teacher.id}>
                          <Link
                            to={`/h/teachers/${b.teacher.id}`}
                            className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-canvas"
                          >
                            <span>{b.teacher.fullName}</span>
                            <span className="text-sm text-bad">
                              {b.overdueLessons} overdue
                              {b.oldestOverdue
                                ? `, oldest ${formatShortDate(b.oldestOverdue)}`
                                : ''}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyState title="Every teacher is up to date" />
                  )}
                </Section>
                <Section
                  title="Weekly completion"
                  actions={
                    <Link to="/h/reports" className="link text-sm">
                      Reports
                    </Link>
                  }
                >
                  {d.weeklyCompletion.some((w) => w.assignmentsWithLessons) ? (
                    <div className="px-4 py-3">
                      {currentRate && (
                        <p className="mb-3 text-sm text-muted">
                          Last week with lessons so far (week {currentRate.weekNumber}):{' '}
                          {percent(currentRate.rate)} of class subjects complete.
                        </p>
                      )}
                      <ul className="space-y-1.5">
                        {d.weeklyCompletion
                          .filter((w) => w.assignmentsWithLessons > 0)
                          .map((w) => (
                            <li
                              key={w.weekNumber}
                              className="grid grid-cols-[4rem_1fr_6rem] items-center gap-3 text-sm"
                            >
                              <span className="text-muted">Week {w.weekNumber}</span>
                              <span className="h-2 overflow-hidden rounded bg-canvas" aria-hidden>
                                <span
                                  className="block h-full bg-accent"
                                  style={{ width: `${(w.rate ?? 0) * 100}%` }}
                                />
                              </span>
                              <span className="text-right tabular-nums">
                                {w.assignmentsComplete}/{w.assignmentsWithLessons} (
                                {percent(w.rate)})
                              </span>
                            </li>
                          ))}
                      </ul>
                    </div>
                  ) : (
                    <EmptyState
                      title="No lessons yet"
                      description="Publish the timetable to start tracking weekly completion."
                      action={
                        <Link to="/h/timetable" className="btn-secondary">
                          Open timetable
                        </Link>
                      }
                    />
                  )}
                </Section>
              </div>
            </div>
          );
        }}
      </QueryView>
    </>
  );
}
