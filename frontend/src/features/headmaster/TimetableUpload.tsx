import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FiCheck, FiDownload, FiTrash2, FiUpload } from 'react-icons/fi';
import { WEEKDAYS } from '@school/shared';
import { api, type One } from '../../lib/api';
import { weekdayLabel } from '../../lib/format';
import { fullErrorMessage } from '../../lib/forms';
import { Section } from '../../components/PageHeader';
import { Alert } from '../../components/States';
import { useClasses } from '../reference';
import { readTimetableFile, rowsFromSheets, templateCsv, type DraftRow } from './timetableFile';

interface CheckedRow {
  row: number;
  className: string;
  matchedSubject?: string;
  teacher?: string;
  error?: string;
}
interface ImportResult {
  rows: CheckedRow[];
  created: number;
  replaced: number;
  saved: boolean;
}

/**
 * Upload the school's timetable as one file. Every slot is shown, its day and times can be
 * changed, and the server checks each one (class, assigned subject and teacher, clashes)
 * before anything is saved. Lessons are created when the timetable is published.
 */
export function TimetableUpload({
  termId,
  onSaved,
}: {
  termId: string;
  onSaved: (n: string) => void;
}) {
  const qc = useQueryClient();
  const classes = useClasses();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [draft, setDraft] = useState<DraftRow[] | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [checked, setChecked] = useState<Map<number, CheckedRow>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const incomplete = (r: DraftRow) =>
    !r.className.trim() || !r.subject.trim() || !r.weekday || !r.startTime || !r.endTime;

  const send = useMutation({
    mutationFn: (dryRun: boolean) =>
      api
        .post<One<ImportResult>>('/timetable/import', {
          termId,
          dryRun,
          rows: (draft ?? []).map((r) => ({ ...r, weekday: r.weekday ?? 0 })),
        })
        .then((r) => r.data),
    onSuccess: (res) => {
      setChecked(new Map(res.rows.map((r) => [r.row - 1, r])));
      if (res.saved) {
        setDraft(null);
        setChecked(new Map());
        onSaved(
          `${fileName}: ${res.created} weekly lessons saved${res.replaced ? `, replacing ${res.replaced} earlier slots of the same classes` : ''}. Press "Preview and publish" to create the lessons.`,
        );
        void qc.invalidateQueries({ queryKey: ['timetable'] });
        void qc.invalidateQueries({ queryKey: ['assignments'] });
      }
    },
    onError: (e) => setError(fullErrorMessage(e)),
  });

  async function choose(file: File) {
    setError(null);
    setChecked(new Map());
    try {
      const parsed = rowsFromSheets(await readTimetableFile(file));
      if (!parsed.rows.length) {
        setError(
          `No lessons were found in ${file.name}. ${parsed.notes.join(' ')} Download the template to see the layout.`,
        );
        return;
      }
      setFileName(file.name);
      setDraft(parsed.rows);
      setNotes(parsed.notes);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'This file could not be read.');
    }
  }

  function update(i: number, patch: Partial<DraftRow>) {
    setDraft((rows) => rows?.map((r, j) => (j === i ? { ...r, ...patch } : r)) ?? null);
    // An edited row needs checking again.
    setChecked((m) => {
      const next = new Map(m);
      next.delete(i);
      return next;
    });
  }

  function remove(i: number) {
    setDraft((rows) => rows?.filter((_, j) => j !== i) ?? null);
    setChecked(new Map());
  }

  function downloadTemplate() {
    const names = (classes.data ?? []).filter((c) => c.isActive).map((c) => c.name);
    const url = URL.createObjectURL(new Blob([templateCsv(names)], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'timetable-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const problems = [...checked.values()].filter((r) => r.error).length;
  const blank = draft?.filter(incomplete).length ?? 0;

  return (
    <Section title="Upload the timetable" className="mb-5">
      <div className="space-y-3 px-4 py-4 text-sm">
        <p className="text-muted">
          Upload the whole school timetable as an Excel or CSV file: one row per class and day, with
          the period times as column headings (for example 8:00-8:40) and the subject in each cell.
          A list with Class, Subject, Day, Start and End columns works too. You can change any day
          or time before saving. Uploading a class again replaces its slots.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            className="sr-only"
            accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void choose(f);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="btn-primary"
            disabled={!termId}
            onClick={() => fileRef.current?.click()}
          >
            <FiUpload aria-hidden /> Choose the timetable file
          </button>
          <button type="button" className="btn-secondary" onClick={downloadTemplate}>
            <FiDownload aria-hidden /> Download a template
          </button>
        </div>
        {error && <Alert>{error}</Alert>}
        {notes.map((n) => (
          <Alert key={n} tone="warn">
            {n}
          </Alert>
        ))}
      </div>

      {draft && (
        <div className="border-t border-line">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <p className="text-sm">
              <strong>{fileName}</strong>: {draft.length} lessons a week.{' '}
              {problems > 0 && (
                <span className="text-bad">
                  {problems} need{problems === 1 ? 's' : ''} fixing.
                </span>
              )}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setDraft(null);
                  setChecked(new Map());
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={send.isPending || blank > 0}
                onClick={() => send.mutate(true)}
              >
                Check
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={send.isPending || blank > 0}
                aria-busy={send.isPending}
                onClick={() => send.mutate(false)}
              >
                {send.isPending ? 'Saving…' : 'Save timetable'}
              </button>
            </div>
          </div>
          {blank > 0 && (
            <div className="px-4 pb-3">
              <Alert tone="warn">
                {blank} row{blank === 1 ? ' is' : 's are'} missing a day or a time. Fill them in
                below or remove them.
              </Alert>
            </div>
          )}
          <div className="max-h-[32rem] overflow-auto">
            <table className="table min-w-[44rem]">
              <thead>
                <tr>
                  <th>Class</th>
                  <th>Subject</th>
                  <th>Day</th>
                  <th>Start</th>
                  <th>End</th>
                  <th>Check</th>
                  <th>
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {draft.map((r, i) => {
                  const c = checked.get(i);
                  const label = `row ${i + 1}`;
                  return (
                    <tr key={i}>
                      <td>
                        <input
                          className="input h-8 w-24"
                          aria-label={`Class, ${label}`}
                          value={r.className}
                          onChange={(e) => update(i, { className: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="input h-8 w-40"
                          aria-label={`Subject, ${label}`}
                          value={r.subject}
                          onChange={(e) => update(i, { subject: e.target.value })}
                        />
                      </td>
                      <td>
                        <select
                          className="input h-8 w-32"
                          aria-label={`Day, ${label}`}
                          value={r.weekday ?? ''}
                          onChange={(e) =>
                            update(i, { weekday: e.target.value ? Number(e.target.value) : null })
                          }
                        >
                          <option value="">Choose</option>
                          {WEEKDAYS.map((d) => (
                            <option key={d} value={d}>
                              {weekdayLabel(d)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="time"
                          className="input h-8 w-28"
                          aria-label={`Start time, ${label}`}
                          value={r.startTime}
                          onChange={(e) => update(i, { startTime: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          type="time"
                          className="input h-8 w-28"
                          aria-label={`End time, ${label}`}
                          value={r.endTime}
                          onChange={(e) => update(i, { endTime: e.target.value })}
                        />
                      </td>
                      <td className="min-w-[12rem] text-xs">
                        {c?.error ? (
                          <span className="text-bad">{c.error}</span>
                        ) : c ? (
                          <span className="inline-flex items-center gap-1 text-ok">
                            <FiCheck aria-hidden /> {c.matchedSubject} · {c.teacher}
                          </span>
                        ) : (
                          <span className="text-muted">Not checked yet</span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn-ghost h-8 px-2"
                          aria-label={`Remove ${label}`}
                          onClick={() => remove(i)}
                        >
                          <FiTrash2 aria-hidden />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Section>
  );
}
