import { useQuery } from '@tanstack/react-query';
import { api, type One } from '../../lib/api';
import { levelLabel, weekdayLabel } from '../../lib/format';
import { PageHeader, Section } from '../../components/PageHeader';
import { DataTable } from '../../components/DataTable';
import { EmptyState, QueryView } from '../../components/States';
import type { Assignment, TimetableEntry } from '../../types/api';

export function MySubjects() {
  const assignments = useQuery({
    queryKey: ['me', 'assignments'],
    queryFn: () => api.get<One<Assignment[]>>('/teachers/me/assignments').then((r) => r.data),
  });
  const timetable = useQuery({
    queryKey: ['me', 'timetable'],
    queryFn: () => api.get<One<TimetableEntry[]>>('/timetable-entries').then((r) => r.data),
  });

  return (
    <>
      <PageHeader
        title="My subjects and classes"
        description="Assigned by your headmaster for each term."
      />
      <div className="space-y-5">
        <Section title="Assignments">
          <QueryView query={assignments}>
            {(rows) =>
              rows.length ? (
                <DataTable
                  rows={rows}
                  rowKey={(r) => r.id}
                  columns={[
                    { key: 'subject', header: 'Subject', render: (r) => r.subject.name },
                    {
                      key: 'class',
                      header: 'Class',
                      render: (r) => `${r.schoolClass.name} (${levelLabel(r.schoolClass.level)})`,
                    },
                    {
                      key: 'term',
                      header: 'Term',
                      render: (r) => `${r.term.name}${r.term.isCurrent ? ' (current)' : ''}`,
                    },
                    { key: 'per', header: 'Lessons a week', render: (r) => r.lessonsPerWeek },
                  ]}
                />
              ) : (
                <EmptyState
                  title="No assignments yet"
                  description="Ask your headmaster to assign your subjects and classes."
                />
              )
            }
          </QueryView>
        </Section>
        <Section title="Weekly timetable">
          <QueryView query={timetable}>
            {(rows) =>
              rows.length ? (
                <DataTable
                  rows={rows}
                  rowKey={(r) => r.id}
                  columns={[
                    { key: 'day', header: 'Day', render: (r) => weekdayLabel(r.weekday) },
                    { key: 'time', header: 'Time', render: (r) => `${r.startTime}–${r.endTime}` },
                    { key: 'subject', header: 'Subject', render: (r) => r.assignment.subject.name },
                    { key: 'class', header: 'Class', render: (r) => r.assignment.schoolClass.name },
                  ]}
                />
              ) : (
                <EmptyState
                  title="No timetable yet"
                  description="Your lessons appear here once the headmaster sets up the timetable."
                />
              )
            }
          </QueryView>
        </Section>
      </div>
    </>
  );
}
