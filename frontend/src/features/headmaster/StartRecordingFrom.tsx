import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type One } from '../../lib/api';
import { addDays, formatDate } from '../../lib/format';
import { fullErrorMessage } from '../../lib/forms';
import { Section } from '../../components/PageHeader';
import { Alert } from '../../components/States';
import type { Term } from '../../types/api';

/** Monday of the current week, in the school's time zone (Africa/Accra is UTC). */
function thisMonday() {
  const today = new Date().toISOString().slice(0, 10);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay() || 7;
  return addDays(today, 1 - weekday);
}

/**
 * Lessons are generated from the first day of the term. A school that starts using the
 * system later waives the earlier ones here, so teachers record from this week onward
 * instead of finding this week locked behind weeks nobody recorded.
 */
export function StartRecordingFrom({ term }: { term: Term }) {
  const qc = useQueryClient();
  const id = useId();
  const [monday] = useState(thisMonday);
  const [date, setDate] = useState(monday);
  const [done, setDone] = useState<string | null>(null);
  const waive = useMutation({
    mutationFn: () =>
      api
        .post<One<{ waived: number }>>('/lessons/waive-before', { termId: term.id, date })
        .then((r) => r.data),
    onSuccess: (r) => {
      setDone(
        r.waived
          ? `${r.waived} earlier lessons no longer need records. Teachers record from ${formatDate(date)} onward.`
          : `No unrecorded lessons before ${formatDate(date)}. Teachers can record from there.`,
      );
      void qc.invalidateQueries();
    },
  });

  if (term.startDate >= monday) return null;
  return (
    <Section title="Started using the system part-way through the term?" className="mb-5">
      <div className="space-y-3 px-4 py-4 text-sm">
        <p className="text-muted">
          {term.name} began on {formatDate(term.startDate)}, so lessons since then count as not
          recorded, and teachers cannot record this week until those earlier weeks are done. Choose
          the day recording starts. Earlier lessons without a record are waived and keep their
          curriculum weeks, so this week&apos;s lessons stay on the right topics. Records already
          submitted are not touched.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label htmlFor={id}>
            <span className="label">Teachers record from</span>
            <input
              id={id}
              type="date"
              className="input w-auto"
              min={term.startDate}
              max={addDays(monday, 6)}
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setDone(null);
              }}
            />
          </label>
          <button
            type="button"
            className="btn-primary"
            disabled={!date || waive.isPending}
            aria-busy={waive.isPending}
            onClick={() => waive.mutate()}
          >
            {waive.isPending ? 'Waiving…' : 'Waive earlier lessons'}
          </button>
        </div>
        {done && <Alert tone="ok">{done}</Alert>}
        {waive.isError && <Alert>{fullErrorMessage(waive.error)}</Alert>}
      </div>
    </Section>
  );
}
