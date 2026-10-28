import type { AssignmentProgress, WeekStatus } from '../../types/api';
import { StatusBadge } from '../../components/StatusBadge';

function cellClass(w: WeekStatus) {
  if (!w.required) return 'bg-canvas text-muted';
  if (w.complete) return 'bg-ok-soft text-ok';
  if (w.overdue > 0) return 'bg-bad-soft text-bad';
  if (!w.unlocked) return 'bg-surface text-muted';
  if (w.completed + w.waived > 0) return 'bg-warn-soft text-warn';
  return 'bg-surface text-ink';
}

function cellLabel(w: WeekStatus) {
  if (!w.required) return w.kind === 'MOCK' ? 'Mock' : w.kind === 'EXAMINATION' ? 'Exam' : '–';
  return `${w.completed + w.waived}/${w.lessonsPaced}`;
}

/** Week-by-week completion for each assignment. Colour is backed by text in every cell. */
export function ProgressGrid({ rows }: { rows: AssignmentProgress[] }) {
  const weekNumbers = [
    ...new Set(rows.flatMap((r) => r.weeks?.map((w) => w.weekNumber) ?? [])),
  ].sort((a, b) => a - b);
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <caption className="sr-only">Lessons recorded per curriculum week</caption>
        <thead>
          <tr>
            <th scope="col">Subject and class</th>
            {weekNumbers.map((n) => (
              <th key={n} scope="col" className="text-center">
                W{n}
              </th>
            ))}
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.assignmentId}>
              <th
                scope="row"
                className="whitespace-nowrap border-b border-line bg-surface px-3 py-2 text-left text-sm font-medium normal-case tracking-normal text-ink"
              >
                {r.subject.name}
                <span className="block text-xs font-normal text-muted">
                  {r.schoolClass.name}
                  {r.teacher ? ` · ${r.teacher.fullName}` : ''}
                </span>
              </th>
              {weekNumbers.map((n) => {
                const w = r.weeks?.find((x) => x.weekNumber === n);
                return (
                  <td key={n} className="p-1 text-center">
                    {w ? (
                      <span
                        className={`block rounded px-1 py-1 text-xs tabular-nums ${cellClass(w)}`}
                        title={`Week ${n}: ${w.kind.toLowerCase()}${w.required ? `, ${w.completed} recorded, ${w.waived} waived, ${w.overdue} overdue${w.complete ? ', complete' : ''}${!w.unlocked ? ', locked' : ''}` : ''}`}
                      >
                        {cellLabel(w)}
                      </span>
                    ) : null}
                  </td>
                );
              })}
              <td>
                <StatusBadge status={r.upToDate ? 'UP_TO_DATE' : 'BEHIND'} />
                {r.overdueLessons > 0 && (
                  <span className="ml-2 text-xs text-bad">{r.overdueLessons} overdue</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 py-3 text-xs text-muted">
        Each cell shows lessons recorded or waived out of lessons placed in that week. Green:
        complete. Red: has overdue lessons. Amber: in progress.
      </p>
    </div>
  );
}
