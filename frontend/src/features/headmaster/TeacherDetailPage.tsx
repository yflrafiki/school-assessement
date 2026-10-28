import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { updateTeacherBody } from '@school/shared';
import { api, type One, type Page } from '../../lib/api';
import { formatDate, formatDateTime, levelLabel, titleCase } from '../../lib/format';
import { applyServerErrors, errorMessage } from '../../lib/forms';
import { PageHeader, Section } from '../../components/PageHeader';
import { Alert, EmptyState, QueryView } from '../../components/States';
import { StatusBadge } from '../../components/StatusBadge';
import { ConfirmDialog, Drawer } from '../../components/Overlays';
import { FormField } from '../../components/FormField';
import { Pagination } from '../../components/Filters';
import { ProgressGrid } from '../progress/ProgressGrid';
import type { AssignmentProgress, AuditEntry, TeacherDetail } from '../../types/api';

type Confirm = 'deactivate' | 'reactivate' | 'resend' | 'reset' | 'absence' | null;

export function TeacherDetailPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [absence, setAbsence] = useState({ startDate: '', endDate: '' });
  const [auditPage, setAuditPage] = useState(1);

  const teacher = useQuery({
    queryKey: ['teachers', 'detail', id],
    queryFn: () => api.get<One<TeacherDetail>>(`/teachers/${id}`).then((r) => r.data),
  });
  const progress = useQuery({
    queryKey: ['progress', 'teacher', id],
    queryFn: () =>
      api
        .get<One<{ assignments: AssignmentProgress[] }>>(`/progress/teachers/${id}`)
        .then((r) => r.data),
  });
  const audit = useQuery({
    queryKey: ['teachers', 'audit', id, auditPage],
    queryFn: () =>
      api.get<Page<AuditEntry>>(`/teachers/${id}/audit`, { page: auditPage, pageSize: 10 }),
    placeholderData: keepPreviousData,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['teachers'] });
    void qc.invalidateQueries({ queryKey: ['progress'] });
  };
  const act = (path: string, message: string, body?: object) => async () => {
    await api.post(`/teachers/${id}/${path}`, body);
    setNotice(message);
    refresh();
  };

  return (
    <QueryView query={teacher}>
      {(t) => (
        <>
          <PageHeader
            title={t.fullName}
            description={
              <>
                <Link to="/h/teachers" className="link">
                  Teachers
                </Link>{' '}
                · {t.email} · Staff ID {t.staffId}
              </>
            }
            actions={
              <>
                <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>
                  Edit details
                </button>
                {t.status === 'PENDING_ACTIVATION' && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setConfirm('resend')}
                  >
                    Resend invitation
                  </button>
                )}
                {t.status === 'ACTIVE' && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setConfirm('reset')}
                  >
                    Send password reset
                  </button>
                )}
                {t.status === 'DEACTIVATED' ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setConfirm('reactivate')}
                  >
                    Reactivate
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={() => setConfirm('deactivate')}
                  >
                    Deactivate
                  </button>
                )}
              </>
            }
          />
          {notice && (
            <div className="mb-4">
              <Alert tone="ok">{notice}</Alert>
            </div>
          )}

          <div className="grid gap-5 lg:grid-cols-3">
            <Section title="Account" className="h-fit">
              <dl className="space-y-2 px-4 py-3 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Status</dt>
                  <dd>
                    <StatusBadge status={t.status} />
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Invitation</dt>
                  <dd>
                    <StatusBadge status={t.invitationStatus} />
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Phone</dt>
                  <dd>{t.phone ?? '–'}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Last sign-in</dt>
                  <dd>{t.lastLoginAt ? formatDateTime(t.lastLoginAt) : 'Never'}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Progress</dt>
                  <dd>
                    {t.overdueLessons ? (
                      <span className="text-bad">{t.overdueLessons} overdue</span>
                    ) : (
                      <StatusBadge status="UP_TO_DATE" />
                    )}
                  </dd>
                </div>
              </dl>
              <div className="border-t border-line px-4 py-3">
                <Link to={`/h/activity?teacherProfileId=${t.id}`} className="link text-sm">
                  View this teacher&rsquo;s records
                </Link>
              </div>
            </Section>

            <Section
              title="Assignments"
              className="lg:col-span-2"
              actions={
                <Link to={`/h/assignments?teacherProfileId=${t.id}`} className="link text-sm">
                  Manage
                </Link>
              }
            >
              {t.allAssignments.length ? (
                <ul className="divide-y divide-line">
                  {t.allAssignments.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                    >
                      <span>
                        {a.subject.name} · {a.schoolClass.name} ({levelLabel(a.schoolClass.level)})
                      </span>
                      <span className="text-muted">
                        {a.term.name}
                        {a.term.isCurrent ? ' (current)' : ''} · {a.lessonsPerWeek}/week
                        {!a.isActive ? ' · inactive' : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  title="No assignments"
                  action={
                    <Link to={`/h/assignments?teacherProfileId=${t.id}`} className="btn-secondary">
                      Assign subjects
                    </Link>
                  }
                />
              )}
            </Section>
          </div>

          <Section title="Weekly progress this term" className="mt-5">
            <QueryView query={progress}>
              {(p) =>
                p.assignments.length ? (
                  <ProgressGrid rows={p.assignments} />
                ) : (
                  <EmptyState title="No lessons this term yet" />
                )
              }
            </QueryView>
          </Section>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <Section
              title="Approved absences"
              actions={
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setConfirm('absence')}
                >
                  Approve absence
                </button>
              }
            >
              {t.absences.length ? (
                <ul className="divide-y divide-line">
                  {t.absences.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                    >
                      <span>
                        {formatDate(a.startDate)} to {formatDate(a.endDate)}
                        <span className="block text-muted">{a.reason}</span>
                      </span>
                      {a.revokedAt ? (
                        <span className="text-xs text-muted">Revoked</span>
                      ) : (
                        <RevokeAbsence id={a.id} onDone={refresh} />
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  title="No absences"
                  description="Approved absences cancel the teacher's lessons in that period so they are never overdue."
                />
              )}
            </Section>
            <Section title="Audit history">
              <QueryView query={audit}>
                {(res) =>
                  res.data.length ? (
                    <>
                      <ul className="divide-y divide-line">
                        {res.data.map((a) => (
                          <li key={a.id} className="px-4 py-2.5 text-sm">
                            <span className="font-medium">
                              {titleCase(a.action.replace('.', ': '))}
                            </span>
                            <span className="block text-xs text-muted">
                              {a.actorName} · {formatDateTime(a.createdAt)}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <Pagination meta={res.meta} onPage={setAuditPage} />
                    </>
                  ) : (
                    <EmptyState title="No history yet" />
                  )
                }
              </QueryView>
            </Section>
          </div>

          <EditTeacherDrawer
            teacher={t}
            open={editing}
            onClose={() => setEditing(false)}
            onSaved={() => {
              setNotice('Details saved.');
              refresh();
            }}
          />

          <ConfirmDialog
            open={confirm === 'deactivate'}
            title={`Deactivate ${t.fullName}?`}
            danger
            confirmLabel="Deactivate"
            body="They are signed out at once and cannot sign in. Their records and history are kept, and you can reactivate them later."
            onClose={() => setConfirm(null)}
            onConfirm={act('deactivate', 'Teacher deactivated. All their sessions have ended.')}
          />
          <ConfirmDialog
            open={confirm === 'reactivate'}
            title={`Reactivate ${t.fullName}?`}
            confirmLabel="Reactivate"
            body="If they had already set a password they can sign in again. Otherwise a new invitation is emailed."
            onClose={() => setConfirm(null)}
            onConfirm={act('reactivate', 'Teacher reactivated.')}
          />
          <ConfirmDialog
            open={confirm === 'resend'}
            title="Resend invitation?"
            confirmLabel="Send"
            body="A new invitation link is emailed and the old one stops working. The link expires in 72 hours."
            onClose={() => setConfirm(null)}
            onConfirm={act('invitations', 'A new invitation has been emailed.')}
          />
          <ConfirmDialog
            open={confirm === 'reset'}
            title="Send a password reset link?"
            confirmLabel="Send"
            body="The teacher receives an email with a link to choose a new password. It expires in 60 minutes."
            onClose={() => setConfirm(null)}
            onConfirm={act('password-reset', 'A password reset link has been emailed.')}
          />
          <ConfirmDialog
            open={confirm === 'absence'}
            title="Approve an absence"
            confirmLabel="Approve"
            body="Lessons in this period are cancelled and the curriculum shifts later. You can revoke it later."
            reasonLabel="Reason"
            onClose={() => setConfirm(null)}
            onConfirm={async (reason) => {
              await api.post('/absences', { teacherProfileId: t.id, ...absence, reason });
              setNotice('Absence approved.');
              refresh();
            }}
          >
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm">
                <span className="label">From</span>
                <input
                  type="date"
                  className="input"
                  value={absence.startDate}
                  onChange={(e) => setAbsence({ ...absence, startDate: e.target.value })}
                />
              </label>
              <label className="text-sm">
                <span className="label">To</span>
                <input
                  type="date"
                  className="input"
                  value={absence.endDate}
                  onChange={(e) => setAbsence({ ...absence, endDate: e.target.value })}
                />
              </label>
            </div>
          </ConfirmDialog>
        </>
      )}
    </QueryView>
  );
}

function RevokeAbsence({ id, onDone }: { id: string; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const revoke = useMutation({
    mutationFn: () => api.delete(`/absences/${id}`),
    onSuccess: onDone,
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <span className="text-right">
      <button
        type="button"
        className="btn-ghost h-7 px-2 text-xs"
        disabled={revoke.isPending}
        onClick={() => revoke.mutate()}
      >
        Revoke
      </button>
      {error && <span className="block text-xs text-bad">{error}</span>}
    </span>
  );
}

type EditValues = z.input<typeof updateTeacherBody>;

function EditTeacherDrawer({
  teacher,
  open,
  onClose,
  onSaved,
}: {
  teacher: TeacherDetail;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<EditValues>({
    resolver: zodResolver(updateTeacherBody),
    values: {
      fullName: teacher.fullName,
      email: teacher.email,
      staffId: teacher.staffId,
      phone: teacher.phone ?? '',
    },
  });
  const save = useMutation({
    mutationFn: (v: EditValues) =>
      api.patch(`/teachers/${teacher.id}`, { ...v, phone: v.phone || null }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (err) =>
      setFormError(
        applyServerErrors(err, form.setError, ['fullName', 'email', 'staffId', 'phone']),
      ),
  });
  const e = form.formState.errors;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Edit teacher"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="edit-teacher"
            className="btn-primary"
            disabled={save.isPending}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form
        id="edit-teacher"
        noValidate
        className="space-y-4"
        onSubmit={form.handleSubmit((v) => {
          setFormError(null);
          save.mutate(v);
        })}
      >
        <FormField label="Full name" error={e.fullName?.message}>
          <input className="input" {...form.register('fullName')} />
        </FormField>
        <FormField
          label="Email"
          hint={
            teacher.status === 'PENDING_ACTIVATION'
              ? 'Changing it sends a new invitation to the new address.'
              : undefined
          }
          error={e.email?.message}
        >
          <input className="input" type="email" {...form.register('email')} />
        </FormField>
        <FormField label="Staff ID" error={e.staffId?.message}>
          <input className="input" {...form.register('staffId')} />
        </FormField>
        <FormField label="Phone" error={e.phone?.message}>
          <input className="input" type="tel" {...form.register('phone')} />
        </FormField>
        {formError && <Alert>{formError}</Alert>}
      </form>
    </Drawer>
  );
}
