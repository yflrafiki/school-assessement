import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, type One, type Page } from '../../lib/api';
import { levelLabel } from '../../lib/format';
import { errorMessage, fullErrorMessage } from '../../lib/forms';
import { useUrlState } from '../../lib/useUrlState';
import { PageHeader, Section } from '../../components/PageHeader';
import { DataTable } from '../../components/DataTable';
import { FilterBar, FilterSelect } from '../../components/Filters';
import { Alert, EmptyState, QueryView } from '../../components/States';
import { StatusBadge } from '../../components/StatusBadge';
import { ConfirmDialog } from '../../components/Overlays';
import { QuickAddClasses } from './QuickAddClasses';
import { classOptions, subjectOptions, useClasses, useSubjects, useTerms } from '../reference';
import type { Assignment, TeacherSummary } from '../../types/api';

function useAllTeachers() {
  return useQuery({
    queryKey: ['teachers', 'all-active'],
    queryFn: () =>
      api
        .get<Page<TeacherSummary>>('/teachers', { pageSize: 100, sort: 'name' })
        .then((r) => r.data.filter((t) => t.status !== 'DEACTIVATED')),
  });
}

export function AssignmentsPage() {
  const qc = useQueryClient();
  const terms = useTerms();
  const subjects = useSubjects();
  const classes = useClasses();
  const teachers = useAllTeachers();
  const { values, set } = useUrlState(['termId', 'teacherProfileId', 'classId'] as const);
  const termId = values.termId || terms.data?.find((t) => t.isCurrent)?.id || '';
  const [draft, setDraft] = useState({ teacherProfileId: '', subjectId: '', classId: '' });
  const [error, setError] = useState<string | null>(null);
  const [reassign, setReassign] = useState<Assignment | null>(null);
  const [newTeacher, setNewTeacher] = useState('');
  const [carry, setCarry] = useState(false);
  const [removing, setRemoving] = useState<Assignment | null>(null);
  const [carryFrom, setCarryFrom] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const assignments = useQuery({
    queryKey: ['assignments', termId, values.teacherProfileId, values.classId],
    queryFn: () =>
      api
        .get<One<Assignment[]>>('/assignments', {
          termId,
          teacherProfileId: values.teacherProfileId,
          classId: values.classId,
        })
        .then((r) => r.data),
    enabled: !!termId,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['assignments'] });
    void qc.invalidateQueries({ queryKey: ['teachers'] });
  };

  const create = useMutation({
    mutationFn: () => api.post('/assignments', { ...draft, termId }),
    onSuccess: () => {
      setDraft({ teacherProfileId: draft.teacherProfileId, subjectId: '', classId: '' });
      setError(null);
      refresh();
    },
    onError: (e) => setError(fullErrorMessage(e)),
  });
  const toggle = useMutation({
    mutationFn: (a: Assignment) => api.patch(`/assignments/${a.id}`, { isActive: !a.isActive }),
    onSuccess: refresh,
    onError: (e) => setError(errorMessage(e)),
  });

  const teacherOptions = (teachers.data ?? []).map((t) => ({ value: t.id, label: t.fullName }));

  return (
    <>
      <PageHeader
        title="Subjects and classes"
        description="One teacher per subject and class each term. Weekly lessons come from the timetable."
        actions={
          <button type="button" className="btn-secondary" onClick={() => setCarry(true)}>
            Copy from another term
          </button>
        }
      />
      {notice && (
        <div className="mb-4">
          <Alert tone="ok">{notice}</Alert>
        </div>
      )}
      <Section>
        <FilterBar>
          <FilterSelect
            label="Term"
            allLabel="Choose"
            value={termId}
            onChange={(v) => set({ termId: v })}
            options={(terms.data ?? []).map((t) => ({
              value: t.id,
              label: `${t.name}${t.academicYearName ? ` ${t.academicYearName}` : ''}${t.isCurrent ? ' (current)' : ''}`,
            }))}
          />
          <FilterSelect
            label="Teacher"
            value={values.teacherProfileId}
            onChange={(v) => set({ teacherProfileId: v, termId: values.termId })}
            options={teacherOptions}
          />
          <FilterSelect
            label="Class"
            value={values.classId}
            onChange={(v) => set({ classId: v, termId: values.termId })}
            options={classOptions(classes.data)}
          />
        </FilterBar>

        {termId && classes.isSuccess && !classOptions(classes.data).length && (
          <div className="border-b border-line px-4 py-3">
            <QuickAddClasses />
          </div>
        )}
        {termId && (
          <form
            className="flex flex-wrap items-end gap-2 border-b border-line bg-canvas px-4 py-3"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <label className="text-sm">
              <span className="label">Teacher</span>
              <select
                className="input"
                value={draft.teacherProfileId}
                onChange={(e) => setDraft({ ...draft, teacherProfileId: e.target.value })}
                required
              >
                <option value="">Choose</option>
                {teacherOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="label">Subject</span>
              <select
                className="input"
                value={draft.subjectId}
                onChange={(e) => setDraft({ ...draft, subjectId: e.target.value })}
                required
              >
                <option value="">Choose</option>
                {subjectOptions(subjects.data, { assignableOnly: true }).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="label">Class</span>
              <select
                className="input"
                value={draft.classId}
                onChange={(e) => setDraft({ ...draft, classId: e.target.value })}
                required
              >
                <option value="">Choose</option>
                {classOptions(classes.data).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn-primary" disabled={create.isPending}>
              Assign
            </button>
          </form>
        )}
        {error && (
          <div className="px-4 pt-3">
            <Alert>{error}</Alert>
          </div>
        )}

        {!termId ? (
          <EmptyState
            title="No current term"
            description="Create a term in Settings first."
            action={
              <Link to="/h/settings" className="btn-secondary">
                Open settings
              </Link>
            }
          />
        ) : (
          <QueryView query={assignments}>
            {(rows) =>
              rows.length ? (
                <DataTable
                  rows={rows}
                  rowKey={(a) => a.id}
                  columns={[
                    {
                      key: 'class',
                      header: 'Class',
                      render: (a) => `${a.schoolClass.name} (${levelLabel(a.schoolClass.level)})`,
                    },
                    { key: 'subject', header: 'Subject', render: (a) => a.subject.name },
                    {
                      key: 'teacher',
                      header: 'Teacher',
                      render: (a) => (
                        <Link to={`/h/teachers/${a.teacher.id}`} className="link">
                          {a.teacher.fullName}
                        </Link>
                      ),
                    },
                    {
                      key: 'lessons',
                      header: 'Lessons a week',
                      render: (a) =>
                        a.lessonsPerWeek ? (
                          a.lessonsPerWeek
                        ) : (
                          <span className="text-warn">None in timetable</span>
                        ),
                    },
                    {
                      key: 'status',
                      header: 'Status',
                      render: (a) =>
                        a.isActive ? (
                          <StatusBadge status="ACTIVE" />
                        ) : (
                          <StatusBadge status="DEACTIVATED" />
                        ),
                    },
                    {
                      key: 'actions',
                      header: 'Actions',
                      render: (a) => (
                        <span className="flex gap-1">
                          <button
                            type="button"
                            className="btn-ghost h-7 px-2 text-xs"
                            onClick={() => {
                              setReassign(a);
                              setNewTeacher('');
                            }}
                          >
                            Reassign
                          </button>
                          <button
                            type="button"
                            className="btn-ghost h-7 px-2 text-xs"
                            disabled={toggle.isPending}
                            onClick={() => toggle.mutate(a)}
                          >
                            {a.isActive ? 'Deactivate' : 'Activate'}
                          </button>
                          <button
                            type="button"
                            className="btn-ghost h-7 px-2 text-xs text-bad"
                            onClick={() => setRemoving(a)}
                          >
                            Delete
                          </button>
                        </span>
                      ),
                    },
                  ]}
                />
              ) : (
                <EmptyState
                  title="No assignments for this term"
                  description="Assign a teacher to each subject and class using the form above."
                />
              )
            }
          </QueryView>
        )}
      </Section>

      <ConfirmDialog
        open={!!reassign}
        title="Reassign to another teacher"
        body={
          reassign
            ? `${reassign.subject.name} for ${reassign.schoolClass.name}, currently ${reassign.teacher.fullName}. Existing records stay with the teacher who wrote them.`
            : ''
        }
        confirmLabel="Reassign"
        onClose={() => setReassign(null)}
        onConfirm={async () => {
          if (!reassign || !newTeacher) throw new Error('Choose a teacher');
          await api.patch(`/assignments/${reassign.id}`, { teacherProfileId: newTeacher });
          refresh();
        }}
      >
        <label className="text-sm">
          <span className="label">New teacher</span>
          <select
            className="input"
            value={newTeacher}
            onChange={(e) => setNewTeacher(e.target.value)}
          >
            <option value="">Choose</option>
            {teacherOptions
              .filter((o) => o.value !== reassign?.teacher.id)
              .map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
          </select>
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={!!removing}
        danger
        title="Delete this class subject?"
        body={
          removing
            ? `${removing.subject.name} for ${removing.schoolClass.name} (${removing.teacher.fullName}) is removed with its timetable slots and lessons. This is only possible while no lesson record has been written for it; otherwise deactivate it.`
            : ''
        }
        confirmLabel="Delete"
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          await api.delete(`/assignments/${removing?.id}`);
          refresh();
        }}
      />

      <ConfirmDialog
        open={carry}
        title="Copy assignments from another term"
        body="Active assignments of the chosen term are copied into the selected term. Pairs already assigned are skipped."
        confirmLabel="Copy"
        onClose={() => setCarry(false)}
        onConfirm={async () => {
          const res = await api.post<One<{ created: number; skipped: number }>>(
            '/assignments/carry-forward',
            { fromTermId: carryFrom, toTermId: termId },
          );
          setNotice(`Copied ${res.data.created} assignments, skipped ${res.data.skipped}.`);
          refresh();
        }}
      >
        <label className="text-sm">
          <span className="label">Copy from</span>
          <select
            className="input"
            value={carryFrom}
            onChange={(e) => setCarryFrom(e.target.value)}
          >
            <option value="">Choose a term</option>
            {(terms.data ?? [])
              .filter((t) => t.id !== termId)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} {t.academicYearName}
                </option>
              ))}
          </select>
        </label>
      </ConfirmDialog>
    </>
  );
}
