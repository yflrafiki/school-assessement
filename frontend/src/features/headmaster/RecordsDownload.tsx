import { useId, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { FiDownload } from 'react-icons/fi';
import { downloadFile } from '../../lib/api';
import { fullErrorMessage } from '../../lib/forms';
import { Section } from '../../components/PageHeader';
import { Alert } from '../../components/States';
import type { Term } from '../../types/api';

/**
 * Downloads every teacher's lesson records for a term as one Excel file, to keep or print:
 * a summary per teacher, every record in full, lessons not recorded, and lessons cancelled
 * or moved. Records also stay in the system; they are never deleted.
 */
export function RecordsDownload({ path, terms }: { path: string; terms?: Term[] | undefined }) {
  const termFieldId = useId();
  const fromId = useId();
  const toId = useId();
  const [termId, setTermId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const download = useMutation({
    mutationFn: () => downloadFile(path, { termId, dateFrom, dateTo }),
    onMutate: () => setSaved(null),
    onSuccess: (name) => setSaved(name),
  });

  return (
    <Section title="Download all teachers' records">
      <div className="space-y-3 px-4 py-4 text-sm">
        <p className="text-muted">
          One Excel file with every teacher&apos;s lesson records for the term: a summary per
          teacher (records, on time, late, not recorded, assignments and tests), every record in
          full, the lessons not recorded, and lessons cancelled or moved with the reason. Keep it
          for the school&apos;s files or print it. The records also stay in the system and are never
          deleted.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          {terms && (
            <label htmlFor={termFieldId}>
              <span className="label">Term</span>
              <select
                id={termFieldId}
                className="input w-auto"
                value={termId}
                onChange={(e) => setTermId(e.target.value)}
              >
                <option value="">Current term</option>
                {terms.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.isCurrent ? ' (current)' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label htmlFor={fromId}>
            <span className="label">From (optional)</span>
            <input
              id={fromId}
              type="date"
              className="input w-auto"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <label htmlFor={toId}>
            <span className="label">To (optional)</span>
            <input
              id={toId}
              type="date"
              className="input w-auto"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn-primary"
            disabled={download.isPending}
            aria-busy={download.isPending}
            onClick={() => download.mutate()}
          >
            <FiDownload aria-hidden />
            {download.isPending ? 'Preparing…' : 'Download Excel file'}
          </button>
        </div>
        {saved && <Alert tone="ok">Saved {saved} to this device&apos;s downloads.</Alert>}
        {download.isError && <Alert>{fullErrorMessage(download.error)}</Alert>}
      </div>
    </Section>
  );
}
