import { useState } from 'react';
import { useLocation, useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { api, type One } from '../../lib/api';
import { formatDate, formatDateTime, levelLabel } from '../../lib/format';
import { applyServerErrors } from '../../lib/forms';
import { PageHeader, Section } from '../../components/PageHeader';
import { Alert, QueryView } from '../../components/States';
import { FormField } from '../../components/FormField';
import { Badge, StatusBadge } from '../../components/StatusBadge';
import { TopicText } from '../curriculum/TopicText';
import type { TeachingRecord } from '../../types/api';

export function useRecord(id: string | null) {
  return useQuery({
    queryKey: ['records', 'detail', id],
    queryFn: () => api.get<One<TeachingRecord>>(`/teaching-records/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

/** Read-only view of a record, used in the headmaster drawer and the teacher page. */
export function RecordView({ record }: { record: TeachingRecord }) {
  const text = (label: string, value: string | null) =>
    value ? (
      <div>
        <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
        <dd className="mt-1 whitespace-pre-wrap text-sm">{value}</dd>
      </div>
    ) : null;
  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-muted">Teacher</dt>
          <dd>{record.teacher.fullName}</dd>
        </div>
        <div>
          <dt className="text-muted">Subject</dt>
          <dd>{record.subject.name}</dd>
        </div>
        <div>
          <dt className="text-muted">Class</dt>
          <dd>
            {record.schoolClass.name} ({levelLabel(record.schoolClass.level)})
          </dd>
        </div>
        <div>
          <dt className="text-muted">Curriculum week</dt>
          <dd>Week {record.weekNumber}</dd>
        </div>
        <div>
          <dt className="text-muted">Lesson</dt>
          <dd>
            {formatDate(record.lesson.date)}, {record.lesson.startTime}–{record.lesson.endTime}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Submitted</dt>
          <dd className="flex flex-wrap items-center gap-1.5">
            {record.submittedAt ? formatDateTime(record.submittedAt) : 'Not yet'}
            {record.status === 'SUBMITTED' && (
              <StatusBadge status={record.isLate ? 'LATE' : 'ON_TIME'} />
            )}
            {record.status === 'DRAFT' && <StatusBadge status="DRAFT" />}
          </dd>
        </div>
      </dl>
      {record.lastEditedAt && (
        <p className="text-xs text-muted">Edited {formatDateTime(record.lastEditedAt)}</p>
      )}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Topics</h3>
        {record.topics?.length ? (
          <ul className="mt-2 space-y-2">
            {record.topics.map((t) => (
              <li key={t.id} className="rounded-md border border-line p-3">
                <TopicText entry={t} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-muted">
            {record.topicNote ? `Topic note: ${record.topicNote}` : 'No topics selected.'}
          </p>
        )}
        {record.topicNote && record.topics?.length ? (
          <p className="mt-2 text-sm text-muted">Topic note: {record.topicNote}</p>
        ) : null}
      </div>
      <dl className="space-y-4">
        {text('What was taught', record.taughtSummary)}
        {text('Learning outcomes', record.outcomes)}
        {text('Challenges', record.challenges)}
        {text('Remarks', record.remarks)}
      </dl>
    </div>
  );
}

type EditValues = { taughtSummary: string; outcomes: string; challenges: string; remarks: string };

export function TeacherRecordPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const justSubmitted = (location.state as { justSubmitted?: boolean } | null)?.justSubmitted;
  const record = useRecord(id);
  const [editing, setEditing] = useState(false);
  const [now] = useState(() => Date.now());

  return (
    <>
      <PageHeader
        title="Teaching record"
        description={
          <Link to="/t/records" className="link">
            All my records
          </Link>
        }
      />
      {justSubmitted && (
        <div className="mb-4">
          <Alert tone="ok">Record submitted. Your headmaster has been notified.</Alert>
        </div>
      )}
      <QueryView query={record}>
        {(r) => {
          const canEdit =
            r.status === 'SUBMITTED' &&
            !!r.editableUntil &&
            new Date(r.editableUntil).getTime() > now;
          return (
            <Section
              title={`${r.subject.name} · ${r.schoolClass.name}`}
              actions={
                canEdit && !editing ? (
                  <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>
                    Edit text
                  </button>
                ) : r.status === 'SUBMITTED' && !canEdit ? (
                  <Badge>Editing closed</Badge>
                ) : null
              }
            >
              <div className="px-4 py-4">
                {editing ? (
                  <EditRecordForm record={r} onDone={() => setEditing(false)} />
                ) : (
                  <RecordView record={r} />
                )}
                {canEdit && !editing && (
                  <p className="mt-4 text-xs text-muted">
                    You can correct the text until {formatDateTime(r.editableUntil)}. Edits are
                    recorded.
                  </p>
                )}
              </div>
            </Section>
          );
        }}
      </QueryView>
    </>
  );
}

function EditRecordForm({ record, onDone }: { record: TeachingRecord; onDone: () => void }) {
  const qc = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<EditValues>({
    defaultValues: {
      taughtSummary: record.taughtSummary,
      outcomes: record.outcomes ?? '',
      challenges: record.challenges ?? '',
      remarks: record.remarks ?? '',
    },
  });
  const edit = useMutation({
    mutationFn: (v: EditValues) =>
      api.patch<One<TeachingRecord>>(`/teaching-records/${record.id}`, v),
    onSuccess: (res) => {
      qc.setQueryData(['records', 'detail', record.id], res.data);
      void qc.invalidateQueries({ queryKey: ['records'] });
      onDone();
    },
    onError: (err) =>
      setFormError(
        applyServerErrors(err, form.setError, [
          'taughtSummary',
          'outcomes',
          'challenges',
          'remarks',
        ]),
      ),
  });
  const e = form.formState.errors;
  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={form.handleSubmit((v) => {
        setFormError(null);
        edit.mutate(v);
      })}
    >
      <FormField label="What was taught" required error={e.taughtSummary?.message}>
        <textarea
          className="input"
          rows={4}
          {...form.register('taughtSummary', {
            minLength: { value: 10, message: 'At least 10 characters' },
          })}
        />
      </FormField>
      <FormField label="Learning outcomes" error={e.outcomes?.message}>
        <textarea className="input" rows={2} {...form.register('outcomes')} />
      </FormField>
      <FormField label="Challenges" error={e.challenges?.message}>
        <textarea className="input" rows={2} {...form.register('challenges')} />
      </FormField>
      <FormField label="Remarks" error={e.remarks?.message}>
        <textarea className="input" rows={2} {...form.register('remarks')} />
      </FormField>
      {formError && <Alert>{formError}</Alert>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onDone} disabled={edit.isPending}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={edit.isPending}>
          {edit.isPending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}
