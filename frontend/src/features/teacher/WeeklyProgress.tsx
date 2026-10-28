import { useQuery } from '@tanstack/react-query';
import { api, type One } from '../../lib/api';
import { PageHeader, Section } from '../../components/PageHeader';
import { Alert, EmptyState, QueryView } from '../../components/States';
import { ProgressGrid } from '../progress/ProgressGrid';
import type { AssignmentProgress } from '../../types/api';

export function WeeklyProgress() {
  const query = useQuery({
    queryKey: ['progress', 'me'],
    queryFn: () =>
      api.get<One<{ assignments: AssignmentProgress[] }>>('/progress/me').then((r) => r.data),
  });
  return (
    <>
      <PageHeader
        title="Weekly progress"
        description="Completion is worked out from your lessons and records, week by week."
      />
      <QueryView query={query}>
        {(d) => (
          <div className="space-y-4">
            {d.assignments
              .filter((a) => a.lessonsBeyondScheme > 0)
              .map((a) => (
                <Alert key={a.assignmentId} tone="warn">
                  {a.subject.name} · {a.schoolClass.name}: {a.lessonsBeyondScheme} lessons fall
                  after the end of the scheme.
                </Alert>
              ))}
            <Section>
              {d.assignments.length ? (
                <ProgressGrid
                  rows={d.assignments.map((a) => ({
                    ...a,
                    teacher: { id: a.teacher.id, fullName: '' },
                  }))}
                />
              ) : (
                <EmptyState title="No classes this term" />
              )}
            </Section>
          </div>
        )}
      </QueryView>
    </>
  );
}
