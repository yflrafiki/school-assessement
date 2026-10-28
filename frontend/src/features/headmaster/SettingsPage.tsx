import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CALENDAR_DAY_KINDS, LEVELS, WEEK_KINDS } from '@school/shared';
import { api, type One } from '../../lib/api';
import { addDays, formatDate, levelLabel, titleCase } from '../../lib/format';
import { fullErrorMessage } from '../../lib/forms';
import { useUrlState } from '../../lib/useUrlState';
import { PageHeader, Section } from '../../components/PageHeader';
import { Alert, EmptyState, QueryView } from '../../components/States';
import { StatusBadge } from '../../components/StatusBadge';
import { DataTable } from '../../components/DataTable';
import { refKeys, useAcademicYears, useClasses, useSubjects, useTerms } from '../reference';

const TABS = [
  { id: 'terms', label: 'Years and terms' },
  { id: 'weeks', label: 'Term weeks' },
  { id: 'classes', label: 'Classes' },
  { id: 'languages', label: 'Ghanaian languages' },
  { id: 'calendar', label: 'Holidays and closures' },
  { id: 'special', label: 'Special weeks' },
  { id: 'absences', label: 'Absences' },
] as const;

export function SettingsPage() {
  const { values, set } = useUrlState(['tab'] as const);
  const tab = values.tab || 'terms';
  return (
    <>
      <PageHeader
        title="Settings"
        description="School year, classes, languages and calendar. Changes that affect lessons re-pace them at once and are audited."
      />
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => set({ tab: t.id })}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${tab === t.id ? 'border-accent font-medium text-accent' : 'border-transparent text-muted hover:text-ink'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'terms' && <TermsTab />}
        {tab === 'weeks' && <WeeksTab />}
        {tab === 'classes' && <ClassesTab />}
        {tab === 'languages' && <LanguagesTab />}
        {tab === 'calendar' && <CalendarTab />}
        {tab === 'special' && <SpecialWeeksTab />}
        {tab === 'absences' && <AbsencesTab />}
      </div>
    </>
  );
}

/** Small helper: a mutation whose error shows above the form and which refreshes given keys. */
function useAction<T>(fn: (input: T) => Promise<unknown>, keys: readonly (readonly unknown[])[]) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: fn,
    onMutate: () => setError(null),
    onSuccess: () => keys.forEach((k) => void qc.invalidateQueries({ queryKey: k })),
    onError: (e) => setError(fullErrorMessage(e)),
  });
  return { ...m, error };
}

function TermsTab() {
  const years = useAcademicYears();
  const [year, setYear] = useState({ name: '', startDate: '', endDate: '' });
  const [term, setTerm] = useState({
    academicYearId: '',
    number: '1',
    name: 'First Term',
    startDate: '',
    endDate: '',
  });
  const createYear = useAction(
    (v: typeof year) => api.post('/academic-years', v),
    [refKeys.years, refKeys.terms],
  );
  const createTerm = useAction(
    (v: typeof term) => api.post('/terms', { ...v, number: Number(v.number) }),
    [refKeys.years, refKeys.terms],
  );
  const setCurrent = useAction(
    (id: string) => api.patch(`/terms/${id}`, { isCurrent: true }),
    [refKeys.years, refKeys.terms],
  );

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Section title="Academic years and terms" className="lg:col-span-2">
        <QueryView query={years}>
          {(rows) =>
            rows.length ? (
              <ul className="divide-y divide-line">
                {rows.map((y) => (
                  <li key={y.id} className="px-4 py-3">
                    <p className="font-medium">
                      {y.name}{' '}
                      <span className="text-sm font-normal text-muted">
                        {formatDate(y.startDate)} to {formatDate(y.endDate)}
                      </span>
                    </p>
                    <ul className="mt-2 space-y-1">
                      {y.terms.map((t) => (
                        <li
                          key={t.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line px-3 py-2 text-sm"
                        >
                          <span>
                            {t.name}: {formatDate(t.startDate)} to {formatDate(t.endDate)} ·{' '}
                            {t.weekCount} weeks set
                          </span>
                          {t.isCurrent ? (
                            <StatusBadge status="ACTIVE" />
                          ) : (
                            <button
                              type="button"
                              className="btn-ghost h-7 px-2 text-xs"
                              onClick={() => setCurrent.mutate(t.id)}
                            >
                              Make current
                            </button>
                          )}
                        </li>
                      ))}
                      {!y.terms.length && <li className="text-sm text-muted">No terms yet.</li>}
                    </ul>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                title="No academic year yet"
                description="Start by creating the academic year, for example 2026/2027."
              />
            )
          }
        </QueryView>
        {setCurrent.error && (
          <div className="p-4">
            <Alert>{setCurrent.error}</Alert>
          </div>
        )}
      </Section>
      <div className="space-y-5">
        <Section title="New academic year">
          <form
            className="space-y-3 px-4 py-3"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              createYear.mutate(year, {
                onSuccess: () => setYear({ name: '', startDate: '', endDate: '' }),
              });
            }}
          >
            <label className="block text-sm">
              <span className="label">Name</span>
              <input
                className="input"
                placeholder="2026/2027"
                required
                value={year.name}
                onChange={(e) => setYear({ ...year, name: e.target.value })}
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm">
                <span className="label">Starts</span>
                <input
                  type="date"
                  className="input"
                  required
                  value={year.startDate}
                  onChange={(e) => setYear({ ...year, startDate: e.target.value })}
                />
              </label>
              <label className="text-sm">
                <span className="label">Ends</span>
                <input
                  type="date"
                  className="input"
                  required
                  value={year.endDate}
                  onChange={(e) => setYear({ ...year, endDate: e.target.value })}
                />
              </label>
            </div>
            {createYear.error && <Alert>{createYear.error}</Alert>}
            <button type="submit" className="btn-primary w-full" disabled={createYear.isPending}>
              Create year
            </button>
          </form>
        </Section>
        <Section title="New term">
          <form
            className="space-y-3 px-4 py-3"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              createTerm.mutate(term);
            }}
          >
            <label className="block text-sm">
              <span className="label">Academic year</span>
              <select
                className="input"
                required
                value={term.academicYearId}
                onChange={(e) => setTerm({ ...term, academicYearId: e.target.value })}
              >
                <option value="">Choose</option>
                {(years.data ?? []).map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm">
                <span className="label">Number</span>
                <select
                  className="input"
                  value={term.number}
                  onChange={(e) =>
                    setTerm({
                      ...term,
                      number: e.target.value,
                      name: ['First', 'Second', 'Third'][Number(e.target.value) - 1] + ' Term',
                    })
                  }
                >
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                </select>
              </label>
              <label className="text-sm">
                <span className="label">Name</span>
                <input
                  className="input"
                  required
                  value={term.name}
                  onChange={(e) => setTerm({ ...term, name: e.target.value })}
                />
              </label>
              <label className="text-sm">
                <span className="label">Starts</span>
                <input
                  type="date"
                  className="input"
                  required
                  value={term.startDate}
                  onChange={(e) => setTerm({ ...term, startDate: e.target.value })}
                />
              </label>
              <label className="text-sm">
                <span className="label">Ends</span>
                <input
                  type="date"
                  className="input"
                  required
                  value={term.endDate}
                  onChange={(e) => setTerm({ ...term, endDate: e.target.value })}
                />
              </label>
            </div>
            {createTerm.error && <Alert>{createTerm.error}</Alert>}
            <button type="submit" className="btn-primary w-full" disabled={createTerm.isPending}>
              Create term
            </button>
          </form>
        </Section>
      </div>
    </div>
  );
}

function TermSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const terms = useTerms();
  return (
    <label className="text-sm">
      <span className="label">Term</span>
      <select className="input w-auto" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose</option>
        {(terms.data ?? []).map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} {t.academicYearName}
            {t.isCurrent ? ' (current)' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

function useSelectedTerm() {
  const terms = useTerms();
  const [picked, setPicked] = useState('');
  return [picked || terms.data?.find((t) => t.isCurrent)?.id || '', setPicked] as const;
}

function WeeksTab() {
  const terms = useTerms();
  const [termId, setTermId] = useSelectedTerm();
  const term = terms.data?.find((t) => t.id === termId);
  const weeks = useQuery({
    queryKey: ['term-weeks', termId],
    queryFn: () =>
      api
        .get<One<{ weekNumber: number; startDate: string; endDate: string }[]>>(
          `/terms/${termId}/weeks`,
        )
        .then((r) => r.data),
    enabled: !!termId,
  });
  const [draft, setDraft] = useState<
    { weekNumber: number; startDate: string; endDate: string }[] | null
  >(null);
  const [count, setCount] = useState('14');
  const save = useAction(
    (w: NonNullable<typeof draft>) => api.put(`/terms/${termId}/weeks`, { weeks: w }),
    [['term-weeks'], refKeys.terms, ['progress'], ['dashboard']],
  );
  const rows = draft ?? weeks.data ?? [];

  function generate() {
    if (!term) return;
    const n = Number(count) || 14;
    setDraft(
      Array.from({ length: n }, (_, i) => ({
        weekNumber: i + 1,
        startDate: addDays(term.startDate, i * 7),
        endDate: addDays(term.startDate, i * 7 + 4),
      })),
    );
  }

  return (
    <Section title="Term weeks">
      <div className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3">
        <TermSelect
          value={termId}
          onChange={(v) => {
            setTermId(v);
            setDraft(null);
          }}
        />
        <label className="text-sm">
          <span className="label">Weeks</span>
          <input
            type="number"
            min={1}
            max={20}
            className="input w-24"
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
        </label>
        <button type="button" className="btn-secondary" disabled={!term} onClick={generate}>
          Fill weekly from term start
        </button>
      </div>
      <p className="px-4 pt-3 text-sm text-muted">
        Week windows tell the system which calendar dates belong to each week, for example the Basic
        9 mock week. Week 1 normally starts on the first Monday of term.
      </p>
      {rows.length ? (
        <table className="table mt-2">
          <thead>
            <tr>
              <th>Week</th>
              <th>Starts</th>
              <th>Ends</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w, i) => (
              <tr key={w.weekNumber}>
                <td>Week {w.weekNumber}</td>
                <td>
                  <input
                    type="date"
                    className="input w-auto"
                    value={w.startDate}
                    aria-label={`Week ${w.weekNumber} start`}
                    onChange={(e) =>
                      setDraft(
                        rows.map((r, j) => (j === i ? { ...r, startDate: e.target.value } : r)),
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    type="date"
                    className="input w-auto"
                    value={w.endDate}
                    aria-label={`Week ${w.weekNumber} end`}
                    onChange={(e) =>
                      setDraft(
                        rows.map((r, j) => (j === i ? { ...r, endDate: e.target.value } : r)),
                      )
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <EmptyState
          title="No weeks set"
          description="Use the button above to fill the weeks from the term start date, then adjust if needed."
        />
      )}
      {save.error && (
        <div className="px-4">
          <Alert>{save.error}</Alert>
        </div>
      )}
      {draft && (
        <div className="flex justify-end gap-2 px-4 py-3">
          <button type="button" className="btn-secondary" onClick={() => setDraft(null)}>
            Discard
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={save.isPending}
            onClick={() => save.mutate(draft, { onSuccess: () => setDraft(null) })}
          >
            Save weeks
          </button>
        </div>
      )}
    </Section>
  );
}

function ClassesTab() {
  const classes = useClasses();
  const [form, setForm] = useState({ level: 'BASIC_7', name: '' });
  const create = useAction((v: typeof form) => api.post('/classes', v), [refKeys.classes]);
  const toggle = useAction(
    (c: { id: string; isActive: boolean }) =>
      api.patch(`/classes/${c.id}`, { isActive: !c.isActive }),
    [refKeys.classes],
  );
  return (
    <Section title="Classes">
      <form
        className="flex flex-wrap items-end gap-2 border-b border-line bg-canvas px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(form, { onSuccess: () => setForm({ ...form, name: '' }) });
        }}
      >
        <label className="text-sm">
          <span className="label">Level</span>
          <select
            className="input"
            value={form.level}
            onChange={(e) => setForm({ ...form, level: e.target.value })}
          >
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {levelLabel(l)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="label">Class name</span>
          <input
            className="input"
            placeholder="B7A"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <button type="submit" className="btn-primary" disabled={create.isPending}>
          Add class
        </button>
      </form>
      {(create.error || toggle.error) && (
        <div className="px-4 pt-3">
          <Alert>{create.error ?? toggle.error}</Alert>
        </div>
      )}
      <QueryView query={classes}>
        {(rows) =>
          rows.length ? (
            <DataTable
              rows={rows}
              rowKey={(c) => c.id}
              columns={[
                { key: 'name', header: 'Class', render: (c) => c.name },
                { key: 'level', header: 'Level', render: (c) => levelLabel(c.level) },
                {
                  key: 'status',
                  header: 'Status',
                  render: (c) => <StatusBadge status={c.isActive ? 'ACTIVE' : 'DEACTIVATED'} />,
                },
                {
                  key: 'a',
                  header: '',
                  render: (c) => (
                    <button
                      type="button"
                      className="btn-ghost h-7 px-2 text-xs"
                      onClick={() => toggle.mutate(c)}
                    >
                      {c.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  ),
                },
              ]}
            />
          ) : (
            <EmptyState
              title="No classes yet"
              description="Add each class, for example B7A, B7B, B8A."
            />
          )
        }
      </QueryView>
    </Section>
  );
}

function LanguagesTab() {
  const subjects = useSubjects();
  const [name, setName] = useState('');
  const create = useAction((n: string) => api.post('/subjects', { name: n }), [refKeys.subjects]);
  const toggle = useAction(
    (s: { id: string; isActive: boolean }) =>
      api.patch(`/subjects/${s.id}`, { isActive: !s.isActive }),
    [refKeys.subjects],
  );
  const languages = (subjects.data ?? []).filter((s) => !s.isNational);
  return (
    <Section title="Ghanaian languages">
      <p className="px-4 pt-3 text-sm text-muted">
        Add one subject per Ghanaian language taught in the school. Each has its own teachers,
        timetable and records, and uses the shared Ghanaian Language scheme until language-specific
        topics are imported.
      </p>
      <form
        className="flex flex-wrap items-end gap-2 border-b border-line px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(name, { onSuccess: () => setName('') });
        }}
      >
        <label className="text-sm">
          <span className="label">Language</span>
          <input
            className="input"
            placeholder="For example Twi"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button type="submit" className="btn-primary" disabled={create.isPending}>
          Add language
        </button>
      </form>
      {(create.error || toggle.error) && (
        <div className="px-4 pt-3">
          <Alert>{create.error ?? toggle.error}</Alert>
        </div>
      )}
      {languages.length ? (
        <ul className="divide-y divide-line">
          {languages.map((s) => (
            <li key={s.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span>{s.name}</span>
              <span className="flex items-center gap-2">
                <StatusBadge status={s.isActive ? 'ACTIVE' : 'DEACTIVATED'} />
                <button
                  type="button"
                  className="btn-ghost h-7 px-2 text-xs"
                  onClick={() => toggle.mutate(s)}
                >
                  {s.isActive ? 'Deactivate' : 'Activate'}
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No languages added" />
      )}
    </Section>
  );
}

function CalendarTab() {
  const days = useQuery({
    queryKey: ['calendar-days'],
    queryFn: () =>
      api
        .get<One<{ id: string; date: string; kind: string; description: string }[]>>(
          '/calendar-days',
        )
        .then((r) => r.data),
  });
  const [form, setForm] = useState({ date: '', kind: 'HOLIDAY', description: '' });
  const keys = [['calendar-days'], ['progress'], ['daily'], ['dashboard'], ['lessons']] as const;
  const create = useAction((v: typeof form) => api.post('/calendar-days', v), keys);
  const remove = useAction((id: string) => api.delete(`/calendar-days/${id}`), keys);
  return (
    <Section title="Holidays and closures">
      <p className="px-4 pt-3 text-sm text-muted">
        Lessons on these days are cancelled and the curriculum shifts later. Nobody becomes overdue
        because of them.
      </p>
      <form
        className="flex flex-wrap items-end gap-2 border-b border-line px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(form, { onSuccess: () => setForm({ ...form, date: '', description: '' }) });
        }}
      >
        <label className="text-sm">
          <span className="label">Date</span>
          <input
            type="date"
            className="input"
            required
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
        </label>
        <label className="text-sm">
          <span className="label">Kind</span>
          <select
            className="input"
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value })}
          >
            {CALENDAR_DAY_KINDS.map((k) => (
              <option key={k} value={k}>
                {titleCase(k)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="label">Description</span>
          <input
            className="input"
            required
            placeholder="Farmers' Day"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>
        <button type="submit" className="btn-primary" disabled={create.isPending}>
          Add
        </button>
      </form>
      {(create.error || remove.error) && (
        <div className="px-4 pt-3">
          <Alert>{create.error ?? remove.error}</Alert>
        </div>
      )}
      <QueryView query={days}>
        {(rows) =>
          rows.length ? (
            <ul className="divide-y divide-line">
              {rows.map((d) => (
                <li key={d.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span>
                    {formatDate(d.date)} · {d.description}{' '}
                    <span className="text-muted">({titleCase(d.kind)})</span>
                  </span>
                  <button
                    type="button"
                    className="btn-ghost h-7 px-2 text-xs"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(d.id)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No holidays or closures" />
          )
        }
      </QueryView>
    </Section>
  );
}

function SpecialWeeksTab() {
  const classes = useClasses();
  const [termId, setTermId] = useSelectedTerm();
  const [form, setForm] = useState({
    weekNumber: '13',
    scope: 'level',
    level: 'BASIC_7',
    classId: '',
    kind: 'REVISION',
    note: '',
  });
  const policies = useQuery({
    queryKey: ['week-policies', termId],
    queryFn: () =>
      api
        .get<
          One<
            {
              id: string;
              weekNumber: number;
              level: string | null;
              classId: string | null;
              className: string | null;
              kind: string;
              note: string | null;
            }[]
          >
        >('/week-policies', { termId })
        .then((r) => r.data),
    enabled: !!termId,
  });
  const keys = [['week-policies'], ['progress'], ['daily'], ['dashboard']] as const;
  const save = useAction(
    (v: {
      weekNumber: number;
      level?: string;
      classId?: string;
      kind: string | null;
      note?: string;
    }) => api.put('/week-policies', { termId, ...v }),
    keys,
  );
  const scope = form.scope === 'level' ? { level: form.level } : { classId: form.classId };

  return (
    <Section title="Special weeks">
      <p className="px-4 pt-3 text-sm text-muted">
        Override the scheme&rsquo;s week type for a level or a single class. Revision weeks need
        records. Mock and examination weeks need none and their lessons are cancelled. A class
        setting beats a level setting, which beats the scheme.
      </p>
      <form
        className="flex flex-wrap items-end gap-2 border-b border-line px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({
            weekNumber: Number(form.weekNumber),
            ...scope,
            kind: form.kind,
            note: form.note || undefined,
          });
        }}
      >
        <TermSelect value={termId} onChange={setTermId} />
        <label className="text-sm">
          <span className="label">Week</span>
          <input
            type="number"
            min={1}
            max={20}
            className="input w-20"
            value={form.weekNumber}
            onChange={(e) => setForm({ ...form, weekNumber: e.target.value })}
          />
        </label>
        <label className="text-sm">
          <span className="label">Applies to</span>
          <select
            className="input"
            value={form.scope}
            onChange={(e) => setForm({ ...form, scope: e.target.value })}
          >
            <option value="level">A level</option>
            <option value="class">One class</option>
          </select>
        </label>
        {form.scope === 'level' ? (
          <label className="text-sm">
            <span className="label">Level</span>
            <select
              className="input"
              value={form.level}
              onChange={(e) => setForm({ ...form, level: e.target.value })}
            >
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {levelLabel(l)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="text-sm">
            <span className="label">Class</span>
            <select
              className="input"
              required
              value={form.classId}
              onChange={(e) => setForm({ ...form, classId: e.target.value })}
            >
              <option value="">Choose</option>
              {(classes.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-sm">
          <span className="label">Week type</span>
          <select
            className="input"
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value })}
          >
            {WEEK_KINDS.map((k) => (
              <option key={k} value={k}>
                {titleCase(k)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="label">Note</span>
          <input
            className="input"
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
        </label>
        <button type="submit" className="btn-primary" disabled={!termId || save.isPending}>
          Save
        </button>
      </form>
      {save.error && (
        <div className="px-4 pt-3">
          <Alert>{save.error}</Alert>
        </div>
      )}
      <QueryView
        query={{
          ...policies,
          isPending: !!termId && policies.isPending,
          data: termId ? policies.data : [],
        }}
      >
        {(rows) =>
          rows.length ? (
            <ul className="divide-y divide-line">
              {rows.map((p) => (
                <li key={p.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span>
                    Week {p.weekNumber} · {p.className ?? levelLabel(p.level ?? '')} ·{' '}
                    <StatusBadge status={p.kind} />
                    {p.note && <span className="text-muted"> · {p.note}</span>}
                  </span>
                  <button
                    type="button"
                    className="btn-ghost h-7 px-2 text-xs"
                    onClick={() =>
                      save.mutate({
                        weekNumber: p.weekNumber,
                        ...(p.classId ? { classId: p.classId } : { level: p.level ?? '' }),
                        kind: null,
                      })
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No overrides"
              description="The published scheme decides each week's type."
            />
          )
        }
      </QueryView>
    </Section>
  );
}

function AbsencesTab() {
  const absences = useQuery({
    queryKey: ['absences'],
    queryFn: () =>
      api
        .get<
          One<
            {
              id: string;
              teacherProfileId: string;
              teacherName: string;
              startDate: string;
              endDate: string;
              reason: string;
              revokedAt: string | null;
            }[]
          >
        >('/absences')
        .then((r) => r.data),
  });
  return (
    <Section title="Approved absences">
      <p className="px-4 pt-3 text-sm text-muted">
        Approve or revoke an absence from the teacher&rsquo;s page.
      </p>
      <QueryView query={absences}>
        {(rows) =>
          rows.length ? (
            <DataTable
              rows={rows}
              rowKey={(a) => a.id}
              columns={[
                {
                  key: 't',
                  header: 'Teacher',
                  render: (a) => (
                    <Link to={`/h/teachers/${a.teacherProfileId}`} className="link">
                      {a.teacherName}
                    </Link>
                  ),
                },
                {
                  key: 'd',
                  header: 'Dates',
                  render: (a) => `${formatDate(a.startDate)} to ${formatDate(a.endDate)}`,
                },
                { key: 'r', header: 'Reason', render: (a) => a.reason },
                {
                  key: 's',
                  header: 'Status',
                  render: (a) => (a.revokedAt ? 'Revoked' : 'Approved'),
                },
              ]}
            />
          ) : (
            <EmptyState title="No absences" />
          )
        }
      </QueryView>
    </Section>
  );
}
