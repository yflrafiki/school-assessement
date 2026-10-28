import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, type One } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { PageHeader, Section } from '../../components/PageHeader';
import { EmptyState, QueryView } from '../../components/States';
import { StatusBadge } from '../../components/StatusBadge';
import { TeacherLessonList } from '../lessons/LessonList';
import { useCurrentUser } from '../auth/useMe';
import type { AssignmentProgress, Lesson } from '../../types/api';

interface TeacherDashboard {
  date: string;
  todayLessons: Lesson[];
  overdueLessons: Lesson[];
  overdueTotal: number;
  unreadNotifications: number;
  assignments: AssignmentProgress[];
}

export function TeacherOverview() {
  const me = useCurrentUser();
  const query = useQuery({
    queryKey: ['dashboard', 'teacher'],
    queryFn: () => api.get<One<TeacherDashboard>>('/dashboard/teacher').then((r) => r.data),
    refetchInterval: 60_000,
  });

  return (
    <>
      <PageHeader
        title={`Good day, ${me.fullName.split(' ')[0]}`}
        description={query.data ? formatDate(query.data.date) : undefined}
      />
      <QueryView query={query}>
        {(d) => (
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="space-y-5 lg:col-span-2">
              <Section title="Today's lessons">
                {d.todayLessons.length ? (
                  <TeacherLessonList lessons={d.todayLessons} />
                ) : (
                  <EmptyState
                    title="No lessons today"
                    description="Lessons appear here once the headmaster publishes the timetable."
                  />
                )}
              </Section>
              {d.overdueTotal > 0 && (
                <Section
                  title={`Overdue lessons (${d.overdueTotal})`}
                  actions={
                    <Link to="/t/scheme" className="link text-sm">
                      Open scheme of work
                    </Link>
                  }
                >
                  <p className="px-4 pt-3 text-sm text-muted">
                    Record these first. Later weeks stay locked until earlier weeks are complete.
                  </p>
                  <TeacherLessonList lessons={d.overdueLessons} showDate />
                </Section>
              )}
            </div>
            <Section title="My classes this term">
              {d.assignments.length ? (
                <ul className="divide-y divide-line">
                  {d.assignments.map((a) => (
                    <li key={a.assignmentId} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium">
                          {a.subject.name}{' '}
                          <span className="text-muted">· {a.schoolClass.name}</span>
                        </p>
                        <StatusBadge status={a.upToDate ? 'UP_TO_DATE' : 'BEHIND'} />
                      </div>
                      <p className="mt-1 text-sm text-muted">
                        {a.completedWeeks} of {a.requiredWeeks} weeks complete
                        {a.currentWeek ? ` · now on week ${a.currentWeek}` : ''}
                      </p>
                      <div className="mt-2 h-1.5 overflow-hidden rounded bg-canvas" aria-hidden>
                        <div
                          className="h-full bg-accent"
                          style={{
                            width: `${a.requiredWeeks ? (a.completedWeeks / a.requiredWeeks) * 100 : 0}%`,
                          }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  title="No classes assigned"
                  description="Your headmaster assigns your subjects and classes."
                />
              )}
            </Section>
          </div>
        )}
      </QueryView>
    </>
  );
}
