import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { FiPlus, FiTrash2 } from 'react-icons/fi';
import { createTeacherBody } from '@school/shared';
import { api, type One, type Page } from '../../lib/api';
import { formatShortDate, levelLabel } from '../../lib/format';
import { applyServerErrors } from '../../lib/forms';
import { useUrlState } from '../../lib/useUrlState';
import { PageHeader, Section } from '../../components/PageHeader';
import { DataTable } from '../../components/DataTable';
import { FilterBar, FilterSelect, Pagination, SearchInput } from '../../components/Filters';
import { Alert, EmptyState, QueryView } from '../../components/States';
import { StatusBadge } from '../../components/StatusBadge';
import { Drawer } from '../../components/Overlays';
import { FormField } from '../../components/FormField';
import {
  classOptions,
  levelOptions,
  subjectOptions,
  useClasses,
  useCurrentTerm,
  useSubjects,
} from '../reference';
import { QuickAddClasses } from './QuickAddClasses';
import type { TeacherDetail, TeacherSummary } from '../../types/api';

const KEYS = [
  'q',
  'subjectId',
  'classId',
  'level',
  'status',
  'invitationStatus',
  'progress',
  'sort',
] as const;

export function TeachersPage() {
  const navigate = useNavigate();
  const { values, set, clear, page } = useUrlState(KEYS);
  const [adding, setAdding] = useState(false);
  const subjects = useSubjects();
  const classes = useClasses();
  const teachers = useQuery({
    queryKey: ['teachers', 'list', values],
    queryFn: () => api.get<Page<TeacherSummary>>('/teachers', { ...values, page }),
    placeholderData: keepPreviousData,
  });
  const active = KEYS.some((k) => k !== 'sort' && values[k]);

  return (
    <>
      <PageHeader
        title="Teachers"
        description="Add teachers, assign their subjects and classes, and manage their accounts."
        actions={
          <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
            <FiPlus aria-hidden /> Add teacher
          </button>
        }
      />
      <Section>
        <FilterBar onClear={clear} active={active}>
          <SearchInput
            value={values.q}
            onChange={(q) => set({ q })}
            placeholder="Name, email, staff ID or subject"
          />
          <FilterSelect
            label="Subject"
            value={values.subjectId}
            onChange={(subjectId) => set({ subjectId })}
            options={subjectOptions(subjects.data, { assignableOnly: true })}
          />
          <FilterSelect
            label="Class"
            value={values.classId}
            onChange={(classId) => set({ classId })}
            options={classOptions(classes.data)}
          />
          <FilterSelect
            label="Level"
            value={values.level}
            onChange={(level) => set({ level })}
            options={levelOptions}
          />
          <FilterSelect
            label="Account"
            value={values.status}
            onChange={(status) => set({ status })}
            options={[
              { value: 'ACTIVE', label: 'Active' },
              { value: 'PENDING_ACTIVATION', label: 'Pending activation' },
              { value: 'DEACTIVATED', label: 'Deactivated' },
            ]}
          />
          <FilterSelect
            label="Invitation"
            value={values.invitationStatus}
            onChange={(invitationStatus) => set({ invitationStatus })}
            options={[
              { value: 'PENDING', label: 'Sent' },
              { value: 'EXPIRED', label: 'Expired' },
              { value: 'ACCEPTED', label: 'Accepted' },
            ]}
          />
          <FilterSelect
            label="Progress"
            value={values.progress}
            onChange={(progress) => set({ progress })}
            options={[
              { value: 'UP_TO_DATE', label: 'Up to date' },
              { value: 'BEHIND', label: 'Behind' },
            ]}
          />
        </FilterBar>
        <QueryView query={teachers}>
          {(res) =>
            res.data.length ? (
              <>
                <DataTable
                  caption="Teachers"
                  rows={res.data}
                  rowKey={(t) => t.id}
                  onRowClick={(t) => navigate(`/h/teachers/${t.id}`)}
                  columns={[
                    {
                      key: 'name',
                      header: 'Teacher',
                      render: (t) => (
                        <span>
                          <span className="font-medium">{t.fullName}</span>
                          <span className="block text-xs text-muted">
                            {t.email} · {t.staffId}
                          </span>
                        </span>
                      ),
                    },
                    {
                      key: 'teaches',
                      header: 'Teaches (current term)',
                      render: (t) =>
                        t.assignments.length ? (
                          <span className="text-sm">
                            {t.assignments
                              .map((a) => `${a.subject.name} ${a.schoolClass.name}`)
                              .join(', ')}
                          </span>
                        ) : (
                          <span className="text-muted">Nothing assigned</span>
                        ),
                    },
                    {
                      key: 'account',
                      header: 'Account',
                      render: (t) => (
                        <StatusBadge
                          status={t.status === 'PENDING_ACTIVATION' ? t.invitationStatus : t.status}
                        />
                      ),
                    },
                    {
                      key: 'progress',
                      header: 'Progress',
                      render: (t) =>
                        t.overdueLessons ? (
                          <span className="text-sm text-bad">
                            {t.overdueLessons} overdue
                            {t.oldestOverdueDate
                              ? `, since ${formatShortDate(t.oldestOverdueDate)}`
                              : ''}
                          </span>
                        ) : (
                          <StatusBadge status="UP_TO_DATE" />
                        ),
                    },
                  ]}
                />
                <Pagination meta={res.meta} onPage={(p) => set({ page: String(p) })} />
              </>
            ) : (
              <EmptyState
                title={active ? 'No teachers match these filters' : 'No teachers yet'}
                description={
                  active
                    ? 'Try removing a filter.'
                    : 'Add your first teacher. They receive an email to activate their account.'
                }
                action={
                  active ? (
                    <button type="button" className="btn-secondary" onClick={clear}>
                      Clear filters
                    </button>
                  ) : (
                    <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
                      Add teacher
                    </button>
                  )
                }
              />
            )
          }
        </QueryView>
      </Section>
      <AddTeacherDrawer
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={(id) => navigate(`/h/teachers/${id}`)}
      />
    </>
  );
}

type FormValues = z.input<typeof createTeacherBody>;

function AddTeacherDrawer({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const qc = useQueryClient();
  const subjects = useSubjects();
  const classes = useClasses();
  const term = useCurrentTerm();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(createTeacherBody),
    defaultValues: { fullName: '', email: '', staffId: '', phone: '', assignments: [] },
  });
  const pairs = useFieldArray({ control: form.control, name: 'assignments' });
  const e = form.formState.errors;

  const create = useMutation({
    mutationFn: (v: FormValues) =>
      api.post<One<TeacherDetail>>('/teachers', { ...v, phone: v.phone || undefined }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['teachers'] });
      form.reset();
      onClose();
      onCreated(res.data.id);
    },
    onError: (err) =>
      setFormError(
        applyServerErrors(err, form.setError, ['fullName', 'email', 'staffId', 'phone', 'termId']),
      ),
  });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Add teacher"
      footer={
        <>
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={create.isPending}
          >
            Cancel
          </button>
          <button
            type="submit"
            form="add-teacher"
            className="btn-primary"
            disabled={create.isPending}
          >
            {create.isPending ? 'Creating…' : 'Create and send invitation'}
          </button>
        </>
      }
    >
      <form
        id="add-teacher"
        noValidate
        className="space-y-4"
        onSubmit={form.handleSubmit((v) => {
          setFormError(null);
          create.mutate(v);
        })}
      >
        <FormField label="Full name" required error={e.fullName?.message}>
          <input className="input" {...form.register('fullName')} />
        </FormField>
        <FormField
          label="Email"
          required
          hint="The invitation is sent here. It is also their sign-in."
          error={e.email?.message}
        >
          <input className="input" type="email" {...form.register('email')} />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField
            label="Staff ID"
            required
            hint="Asked for at activation"
            error={e.staffId?.message}
          >
            <input className="input" {...form.register('staffId')} />
          </FormField>
          <FormField label="Phone" error={e.phone?.message}>
            <input className="input" type="tel" {...form.register('phone')} />
          </FormField>
        </div>

        <fieldset>
          <legend className="label">
            Subjects and classes {term.data ? `for ${term.data.name}` : ''}
          </legend>
          {!term.data && (
            <p className="mb-2 text-sm text-muted">
              Create a current term in Settings before assigning subjects.
            </p>
          )}
          {term.data && classes.isSuccess && !classOptions(classes.data).length && (
            <div className="mb-2">
              <QuickAddClasses />
            </div>
          )}
          <ul className="space-y-2">
            {pairs.fields.map((f, i) => (
              <li key={f.id} className="flex items-center gap-2">
                <label className="sr-only" htmlFor={`subject-${i}`}>
                  Subject
                </label>
                <select
                  id={`subject-${i}`}
                  className="input"
                  {...form.register(`assignments.${i}.subjectId`)}
                >
                  <option value="">Subject</option>
                  {subjectOptions(subjects.data, { assignableOnly: true }).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <label className="sr-only" htmlFor={`class-${i}`}>
                  Class
                </label>
                <select
                  id={`class-${i}`}
                  className="input"
                  {...form.register(`assignments.${i}.classId`)}
                >
                  <option value="">Class</option>
                  {(classes.data ?? [])
                    .filter((c) => c.isActive)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({levelLabel(c.level)})
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  className="btn-ghost whitespace-nowrap px-2 text-xs"
                  title="The same subject in every class, for a teacher who teaches it in Form 1 to Form 3"
                  onClick={() => {
                    const subjectId = form.getValues(`assignments.${i}.subjectId`);
                    if (!subjectId) {
                      form.setError(`assignments.${i}.subjectId`, { message: 'Choose a subject' });
                      return;
                    }
                    const taken = new Set(
                      (form.getValues('assignments') ?? [])
                        .filter((a, j) => j !== i && a.subjectId === subjectId)
                        .map((a) => a.classId),
                    );
                    const every = (classes.data ?? [])
                      .filter((c) => c.isActive && !taken.has(c.id))
                      .map((c) => ({ subjectId, classId: c.id }));
                    pairs.remove(i);
                    pairs.append(every);
                  }}
                >
                  All classes
                </button>
                <button
                  type="button"
                  className="btn-ghost px-2"
                  onClick={() => pairs.remove(i)}
                  aria-label="Remove this subject and class"
                >
                  <FiTrash2 aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          {e.assignments && (
            <p className="mt-1 text-xs text-bad">
              {e.assignments.message ?? 'Choose a subject and a class on every row'}
            </p>
          )}
          <button
            type="button"
            className="btn-secondary mt-2"
            disabled={!term.data}
            onClick={() => pairs.append({ subjectId: '', classId: '' })}
          >
            <FiPlus aria-hidden /> Add subject and class
          </button>
        </fieldset>
        {formError && <Alert>{formError}</Alert>}
      </form>
    </Drawer>
  );
}
