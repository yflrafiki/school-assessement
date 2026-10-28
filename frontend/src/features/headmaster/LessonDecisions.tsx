import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { ConfirmDialog } from '../../components/Overlays';
import type { Lesson } from '../../types/api';

type Action = 'cancel' | 'waive' | 'reschedule';

/** Cancel, waive and reschedule buttons for a scheduled lesson without a submitted record. */
export function LessonDecisions({ lesson }: { lesson: Lesson }) {
  const qc = useQueryClient();
  const [action, setAction] = useState<Action | null>(null);
  const [date, setDate] = useState(lesson.date);
  const [start, setStart] = useState(lesson.startTime);
  const [end, setEnd] = useState(lesson.endTime);

  if (lesson.status !== 'SCHEDULED' || lesson.record?.status === 'SUBMITTED') return null;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['daily'] });
    void qc.invalidateQueries({ queryKey: ['lessons'] });
    void qc.invalidateQueries({ queryKey: ['progress'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const label = `${lesson.assignment.subject.name}, ${lesson.assignment.schoolClass.name} on ${formatDate(lesson.date)} at ${lesson.startTime}`;

  return (
    <>
      <div className="flex flex-wrap gap-1">
        {lesson.weekNumber !== null && (
          <button
            type="button"
            className="btn-ghost h-7 px-2 text-xs"
            onClick={() => setAction('waive')}
          >
            Waive
          </button>
        )}
        <button
          type="button"
          className="btn-ghost h-7 px-2 text-xs"
          onClick={() => setAction('reschedule')}
        >
          Reschedule
        </button>
        <button
          type="button"
          className="btn-ghost h-7 px-2 text-xs text-bad"
          onClick={() => setAction('cancel')}
        >
          Cancel
        </button>
      </div>

      <ConfirmDialog
        open={action === 'waive'}
        title="Waive this lesson"
        body={
          <>
            A waived lesson counts as done, so it no longer blocks later weeks. Its content is
            skipped. {label}.
          </>
        }
        confirmLabel="Waive lesson"
        reasonLabel="Reason (required, kept in the audit log)"
        onClose={() => setAction(null)}
        onConfirm={async (reason) => {
          await api.post(`/lessons/${lesson.id}/waive`, { reason });
          refresh();
        }}
      />
      <ConfirmDialog
        open={action === 'cancel'}
        title="Cancel this lesson"
        body={
          <>
            The lesson leaves the sequence and the curriculum shifts later. The teacher is never
            overdue for it. {label}.
          </>
        }
        confirmLabel="Cancel lesson"
        danger
        reasonLabel="Reason (required, kept in the audit log)"
        onClose={() => setAction(null)}
        onConfirm={async (reason) => {
          await api.post(`/lessons/${lesson.id}/cancel`, { reason });
          refresh();
        }}
      />
      <ConfirmDialog
        open={action === 'reschedule'}
        title="Reschedule this lesson"
        body={label}
        confirmLabel="Reschedule"
        reasonLabel="Reason (required, kept in the audit log)"
        onClose={() => setAction(null)}
        onConfirm={async (reason) => {
          await api.post(`/lessons/${lesson.id}/reschedule`, {
            date,
            startTime: start,
            endTime: end,
            reason,
          });
          refresh();
        }}
      >
        <div className="grid grid-cols-3 gap-2">
          <label className="col-span-3 text-sm sm:col-span-1">
            <span className="label">New date</span>
            <input
              type="date"
              className="input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </label>
          <label className="text-sm">
            <span className="label">Start</span>
            <input
              type="time"
              className="input"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              required
            />
          </label>
          <label className="text-sm">
            <span className="label">End</span>
            <input
              type="time"
              className="input"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              required
            />
          </label>
        </div>
      </ConfirmDialog>
    </>
  );
}
