import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FiTrash2 } from 'react-icons/fi';
import { WEEKDAYS } from '@school/shared';
import { api, type One } from '../../lib/api';
import { weekdayLabel } from '../../lib/format';
import { errorMessage, fullErrorMessage } from '../../lib/forms';
import { useUrlState } from '../../lib/useUrlState';
import { PageHeader, Section } from '../../components/PageHeader';
import { FilterBar, FilterSelect } from '../../components/Filters';
import { Alert, EmptyState, QueryView } from '../../components/States';
import { Drawer } from '../../components/Overlays';
import { classOptions, useClasses, useTerms } from '../reference';
import type { Assignment, TimetableEntry } from '../../types/api';
import { StartRecordingFrom } from './StartRecordingFrom';

interface PublishResult {
  dryRun: boolean;
  assignments: {
    assignmentId: string;
    subject: string;
    className: string;
    teacher: string;
    perWeek: number;
    previousPerWeek: number | null;
    requiredWeeks: number;
    shortfall: number;
    lessonsCreated: number;
    lessonsRemoved: number;
    needsConfirmation: boolean;
  }[];
}

export function TimetablePage() {
  const qc = useQueryClient();
  const terms = useTerms();
  const classes = useClasses();
  const { values, set } = useUrlState(['termId', 'classId'] as const);
  const termId = values.termId || terms.data?.find((t) => t.isCurrent)?.id || '';
  const term = terms.data?.find((t) => t.id === termId);
  const classId = values.classId || classes.data?.find((c) => c.isActive)?.id || '';
  const [form, setForm] = useState({
    assignmentId: '',
    weekday: '1',
    startTime: '08:00',
    endTime: '09:00',
  });
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PublishResult | null>(null);
  const [published, setPublished] = useState<string | null>(null);

  const entries = useQuery({
    queryKey: ['timetable', termId, classId],
    queryFn: () =>
      api.get<One<TimetableEntry[]>>('/timetable-entries', { termId, classId }).then((r) => r.data),
    enabled: !!termId && !!classId,
  });
  const assignments = useQuery({
    queryKey: ['assignments', termId, '', classId],
    queryFn: () =>
      api.get<One<Assignment[]>>('/assignments', { termId, classId }).then((r) => r.data),
    enabled: !!termId && !!classId,
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: ['timetable'] });
  const add = useMutation({
    mutationFn: () => api.post('/timetable-entries', { ...form, weekday: Number(form.weekday) }),
    onSuccess: () => {
      setError(null);
      refresh();
      void qc.invalidateQueries({ queryKey: ['assignments'] });
    },
    onError: (e) => setError(fullErrorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/timetable-entries/${id}`),
    onSuccess: () => {
      refresh();
      void qc.invalidateQueries({ queryKey: ['assignments'] });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const publish = useMutation({
    mutationFn: (opts: { dryRun: boolean; confirmRepace: boolean }) =>
      api.post<One<PublishResult>>('/timetable/publish', { termId, ...opts }).then((r) => r.data),
    onSuccess: (res) => {
      if (res.dryRun) setPreview(res);
      else {
        setPreview(null);
        setPublished(
          `Timetable published. ${res.assignments.reduce((s, a) => s + a.lessonsCreated, 0)} lessons created across ${res.assignments.length} class subjects.`,
        );
        void qc.invalidateQueries();
      }
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const byDay = useMemo(() => {
    const map = new Map<number, TimetableEntry[]>();
    for (const e of entries.data ?? []) map.set(e.weekday, [...(map.get(e.weekday) ?? []), e]);
    return map;
  }, [entries.data]);

  return (
    <>
      <PageHeader
        title="Timetable"
        description="Weekly slots per class. Changes take effect when you publish, which generates lessons for every school day of the term."
        actions={
          <button
            type="button"
            className="btn-primary"
            disabled={!termId || publish.isPending}
            onClick={() => publish.mutate({ dryRun: true, confirmRepace: false })}
          >
            Preview and publish
          </button>
        }
      />
      {published && (
        <div className="mb-4">
          <Alert tone="ok">{published}</Alert>
        </div>
      )}
      {term && <StartRecordingFrom key={term.id} term={term} />}
      <Section>
        <FilterBar>
          <FilterSelect
            label="Term"
            allLabel="Choose"
            value={termId}
            onChange={(v) => set({ termId: v, classId: values.classId })}
            options={(terms.data ?? []).map((t) => ({
              value: t.id,
              label: `${t.name}${t.isCurrent ? ' (current)' : ''}`,
            }))}
          />
          <FilterSelect
            label="Class"
            allLabel="Choose"
            value={classId}
            onChange={(v) => set({ classId: v, termId: values.termId })}
            options={classOptions(classes.data)}
          />
        </FilterBar>

        {termId && classId ? (
          <>
            <form
              className="flex flex-wrap items-end gap-2 border-b border-line bg-canvas px-4 py-3"
              onSubmit={(e) => {
                e.preventDefault();
                add.mutate();
              }}
            >
              <label className="text-sm">
                <span className="label">Subject</span>
                <select
                  className="input"
                  required
                  value={form.assignmentId}
                  onChange={(e) => setForm({ ...form, assignmentId: e.target.value })}
                >
                  <option value="">Choose</option>
                  {(assignments.data ?? [])
                    .filter((a) => a.isActive)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.subject.name} ({a.teacher.fullName})
                      </option>
                    ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="label">Day</span>
                <select
                  className="input"
                  value={form.weekday}
                  onChange={(e) => setForm({ ...form, weekday: e.target.value })}
                >
                  {WEEKDAYS.map((d) => (
                    <option key={d} value={d}>
                      {weekdayLabel(d)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="label">Start</span>
                <input
                  type="time"
                  className="input"
                  required
                  value={form.startTime}
                  onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                />
              </label>
              <label className="text-sm">
                <span className="label">End</span>
                <input
                  type="time"
                  className="input"
                  required
                  value={form.endTime}
                  onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                />
              </label>
              <button type="submit" className="btn-primary" disabled={add.isPending}>
                Add slot
              </button>
            </form>
            {error && (
              <div className="px-4 pt-3">
                <Alert>{error}</Alert>
              </div>
            )}
            {assignments.data && assignments.data.length === 0 && (
              <div className="px-4 pt-3">
                <Alert tone="info">
                  This class has no subjects assigned for the term. Assign them under Subjects and
                  classes.
                </Alert>
              </div>
            )}
            <QueryView query={entries}>
              {(rows) =>
                rows.length ? (
                  <div className="grid gap-px bg-line md:grid-cols-5">
                    {WEEKDAYS.map((d) => (
                      <div key={d} className="bg-surface">
                        <h3 className="border-b border-line bg-canvas px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
                          {weekdayLabel(d)}
                        </h3>
                        <ul className="space-y-1.5 p-2">
                          {(byDay.get(d) ?? []).map((e) => (
                            <li
                              key={e.id}
                              className="flex items-start justify-between gap-1 rounded-md border border-line px-2 py-1.5 text-sm"
                            >
                              <span>
                                <span className="tabular-nums text-muted">
                                  {e.startTime}–{e.endTime}
                                </span>
                                <span className="block font-medium">
                                  {e.assignment.subject.name}
                                </span>
                                <span className="block text-xs text-muted">
                                  {e.assignment.teacher.fullName}
                                </span>
                              </span>
                              <button
                                type="button"
                                className="btn-ghost h-7 px-1.5"
                                aria-label={`Remove ${e.assignment.subject.name} on ${weekdayLabel(d)} at ${e.startTime}`}
                                onClick={() => remove.mutate(e.id)}
                              >
                                <FiTrash2 aria-hidden />
                              </button>
                            </li>
                          ))}
                          {!(byDay.get(d) ?? []).length && (
                            <li className="px-1 py-2 text-xs text-muted">No lessons</li>
                          )}
                        </ul>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title="No slots for this class"
                    description="Add the weekly lessons using the form above, then publish."
                  />
                )
              }
            </QueryView>
          </>
        ) : (
          <EmptyState
            title="Choose a term and class"
            description="Create terms and classes in Settings if the lists are empty."
          />
        )}
      </Section>

      <Drawer
        open={!!preview}
        onClose={() => setPreview(null)}
        title="Publish timetable"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setPreview(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={publish.isPending}
              onClick={() =>
                publish.mutate({
                  dryRun: false,
                  confirmRepace: !!preview?.assignments.some((a) => a.needsConfirmation),
                })
              }
            >
              {publish.isPending
                ? 'Publishing…'
                : preview?.assignments.some((a) => a.needsConfirmation)
                  ? 'Confirm re-pacing and publish'
                  : 'Publish'}
            </button>
          </>
        }
      >
        {preview && (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              Lessons are placed onto curriculum weeks in date order. Check for shortfalls before
              publishing.
            </p>
            {preview.assignments.some((a) => a.needsConfirmation) && (
              <Alert tone="warn">
                Some class subjects change their weekly lesson count after records were submitted.
                Their remaining lessons will be re-paced.
              </Alert>
            )}
            <div className="overflow-x-auto">
              <table className="table min-w-[28rem]">
                <thead>
                  <tr>
                    <th>Class subject</th>
                    <th>Per week</th>
                    <th>New lessons</th>
                    <th>Shortfall</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.assignments.map((a) => (
                    <tr key={a.assignmentId}>
                      <td>
                        {a.subject} · {a.className}
                        <span className="block text-xs text-muted">{a.teacher}</span>
                      </td>
                      <td className="tabular-nums">
                        {a.previousPerWeek !== null && a.previousPerWeek !== a.perWeek
                          ? `${a.previousPerWeek} → ${a.perWeek}`
                          : a.perWeek}
                      </td>
                      <td className="tabular-nums">
                        {a.lessonsCreated}
                        {a.lessonsRemoved ? `, ${a.lessonsRemoved} removed` : ''}
                      </td>
                      <td className={a.shortfall ? 'text-warn' : 'text-muted'}>
                        {a.perWeek === 0
                          ? 'No slots'
                          : a.shortfall
                            ? `${a.shortfall} lessons short`
                            : 'None'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Drawer>
    </>
  );
}
