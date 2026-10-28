import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, type One } from '../../lib/api';
import { formatShortDate } from '../../lib/format';
import { useUrlState } from '../../lib/useUrlState';
import { PageHeader, Section } from '../../components/PageHeader';
import { FilterBar, FilterSelect } from '../../components/Filters';
import { EmptyState, QueryView } from '../../components/States';
import { StatusBadge } from '../../components/StatusBadge';
import { DataTable } from '../../components/DataTable';
import { useTerms } from '../reference';

interface TeacherProgressRow {
  teacher: { id: string; fullName: string };
  assignments: {
    assignmentId: string;
    subject: { name: string };
    schoolClass: { name: string };
    completedWeeks: number;
    requiredWeeks: number;
    currentWeek: number | null;
    overdueLessons: number;
    upToDate: boolean;
  }[];
  overdueLessons: number;
  oldestOverdue: string | null;
  upToDate: boolean;
}

export function ProgressPage() {
  const terms = useTerms();
  const { values, set } = useUrlState(['termId', 'show'] as const);
  const query = useQuery({
    queryKey: ['progress', 'teachers', values.termId],
    queryFn: () =>
      api
        .get<One<TeacherProgressRow[]>>('/progress/teachers', { termId: values.termId })
        .then((r) => r.data),
  });

  return (
    <>
      <PageHeader
        title="Weekly progress"
        description="Up to date: no overdue lesson and no unfinished earlier week. Behind: at least one overdue lesson."
      />
      <Section>
        <FilterBar>
          <FilterSelect
            label="Term"
            allLabel="Current"
            value={values.termId}
            onChange={(termId) => set({ termId, show: values.show })}
            options={(terms.data ?? []).map((t) => ({ value: t.id, label: t.name }))}
          />
          <FilterSelect
            label="Show"
            value={values.show}
            onChange={(show) => set({ show, termId: values.termId })}
            options={[
              { value: 'BEHIND', label: 'Behind only' },
              { value: 'UP_TO_DATE', label: 'Up to date only' },
            ]}
          />
        </FilterBar>
        <QueryView query={query}>
          {(rows) => {
            const filtered = rows.filter(
              (r) => !values.show || (values.show === 'BEHIND' ? !r.upToDate : r.upToDate),
            );
            return filtered.length ? (
              <DataTable
                rows={filtered}
                rowKey={(r) => r.teacher.id}
                columns={[
                  {
                    key: 'teacher',
                    header: 'Teacher',
                    render: (r) => (
                      <Link to={`/h/teachers/${r.teacher.id}`} className="link">
                        {r.teacher.fullName}
                      </Link>
                    ),
                  },
                  {
                    key: 'classes',
                    header: 'Class subjects',
                    render: (r) => (
                      <ul className="space-y-0.5">
                        {r.assignments.map((a) => (
                          <li key={a.assignmentId} className="text-sm">
                            {a.subject.name} {a.schoolClass.name}:{' '}
                            <span className="tabular-nums text-muted">
                              {a.completedWeeks}/{a.requiredWeeks} weeks
                            </span>
                            {a.overdueLessons > 0 && (
                              <span className="text-bad"> · {a.overdueLessons} overdue</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    ),
                  },
                  {
                    key: 'oldest',
                    header: 'Oldest overdue',
                    render: (r) => (r.oldestOverdue ? formatShortDate(r.oldestOverdue) : '–'),
                  },
                  {
                    key: 'status',
                    header: 'Status',
                    render: (r) => <StatusBadge status={r.upToDate ? 'UP_TO_DATE' : 'BEHIND'} />,
                  },
                ]}
              />
            ) : (
              <EmptyState
                title={rows.length ? 'No teachers match' : 'No progress to show yet'}
                description={
                  rows.length
                    ? undefined
                    : 'Assign subjects and publish the timetable to start tracking.'
                }
              />
            );
          }}
        </QueryView>
      </Section>
    </>
  );
}
