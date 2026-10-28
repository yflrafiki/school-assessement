import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import type { WeekKind, WeekLockedDetails } from '@school/shared';
import { ApiError, api, type One } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { PageHeader, Section } from '../../components/PageHeader';
import { Alert, EmptyState, QueryView } from '../../components/States';
import { FormField } from '../../components/FormField';
import { StatusBadge } from '../../components/StatusBadge';
import { TopicText } from '../curriculum/TopicText';
import type { CurriculumEntry, Lesson, TeachingRecord } from '../../types/api';
import { unreadKey } from '../notifications/NotificationBell';

interface Values {
  entryIds: string[];
  taughtSummary: string;
  topicNote: string;
  outcomes: string;
  challenges: string;
  remarks: string;
}

const FIELDS = [
  'entryIds',
  'taughtSummary',
  'topicNote',
  'outcomes',
  'challenges',
  'remarks',
] as const;

/** The form opens from a lesson, so the date, week and slot are never typed in. */
export function RecordLessonPage() {
  const { lessonId = '' } = useParams();
  const lesson = useQuery({
    queryKey: ['lesson', lessonId],
    queryFn: () => api.get<One<Lesson>>(`/lessons/${lessonId}`).then((r) => r.data),
  });
  const topics = useQuery({
    queryKey: ['topics', lessonId],
    queryFn: () =>
      api
        .get<One<{ weekNumber: number | null; kind: WeekKind | null; entries: CurriculumEntry[] }>>(
          '/curriculum/topics',
          { lessonId },
        )
        .then((r) => r.data),
  });
  const existing = useQuery({
    queryKey: ['record-by-lesson', lessonId],
    queryFn: () =>
      api
        .get<One<TeachingRecord | null>>('/teaching-records/by-lesson', { lessonId })
        .then((r) => r.data),
  });

  return (
    <>
      <PageHeader
        title="Record a lesson"
        description={
          <Link to="/t/scheme" className="link">
            Back to scheme of work
          </Link>
        }
      />
      <QueryView query={lesson}>
        {(l) => (
          <QueryView query={topics}>
            {(t) => (
              <QueryView query={existing}>
                {(rec) =>
                  rec?.status === 'SUBMITTED' ? (
                    <Section>
                      <EmptyState
                        title="This lesson is already recorded"
                        action={
                          <Link to={`/t/records/${rec.id}`} className="btn-primary">
                            View the record
                          </Link>
                        }
                      />
                    </Section>
                  ) : (
                    <RecordForm
                      lesson={l}
                      weekNumber={t.weekNumber}
                      kind={t.kind}
                      entries={t.entries}
                      draft={rec}
                    />
                  )
                }
              </QueryView>
            )}
          </QueryView>
        )}
      </QueryView>
    </>
  );
}

function RecordForm({
  lesson,
  weekNumber,
  kind,
  entries,
  draft,
}: {
  lesson: Lesson;
  weekNumber: number | null;
  kind: WeekKind | null;
  entries: CurriculumEntry[];
  draft: TeachingRecord | null;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [locked, setLocked] = useState<{ message: string; details: WeekLockedDetails } | null>(
    null,
  );
  const [saved, setSaved] = useState<string | null>(null);

  const form = useForm<Values>({
    defaultValues: {
      entryIds: draft?.topics?.map((t) => t.id) ?? [],
      taughtSummary: draft?.taughtSummary ?? '',
      topicNote: draft?.topicNote ?? '',
      outcomes: draft?.outcomes ?? '',
      challenges: draft?.challenges ?? '',
      remarks: draft?.remarks ?? '',
    },
  });
  const { register, formState, setError, handleSubmit } = form;

  useEffect(() => {
    if (saved) {
      const t = setTimeout(() => setSaved(null), 4000);
      return () => clearTimeout(t);
    }
  }, [saved]);

  const save = useMutation({
    mutationFn: ({ values, status }: { values: Values; status: 'DRAFT' | 'SUBMITTED' }) =>
      api.post<One<{ record: TeachingRecord }>>('/teaching-records', {
        lessonId: lesson.id,
        status,
        entryIds: values.entryIds,
        taughtSummary: values.taughtSummary,
        topicNote: values.topicNote,
        outcomes: values.outcomes,
        challenges: values.challenges,
        remarks: values.remarks,
      }),
    onSuccess: (res, { status }) => {
      void qc.invalidateQueries({ queryKey: ['progress'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['lessons'] });
      void qc.invalidateQueries({ queryKey: ['records'] });
      void qc.invalidateQueries({ queryKey: unreadKey });
      void qc.invalidateQueries({ queryKey: ['record-by-lesson', lesson.id] });
      if (status === 'SUBMITTED')
        navigate(`/t/records/${res.data.record.id}`, {
          replace: true,
          state: { justSubmitted: true },
        });
      else setSaved('Draft saved. Drafts do not count until you submit.');
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'WEEK_LOCKED') {
        setLocked({ message: err.message, details: err.details as WeekLockedDetails });
        return;
      }
      if (err instanceof ApiError) {
        for (const [field, messages] of Object.entries(err.fields)) {
          if ((FIELDS as readonly string[]).includes(field))
            setError(field as (typeof FIELDS)[number], { message: messages.join(' ') });
        }
        setFormError(Object.keys(err.fields).length ? null : err.message);
      } else setFormError('Something went wrong. Please try again.');
    },
  });

  const submit = (status: 'DRAFT' | 'SUBMITTED') =>
    handleSubmit((values) => {
      setFormError(null);
      setLocked(null);
      if (status === 'SUBMITTED' && values.taughtSummary.trim().length < 10) {
        setError('taughtSummary', { message: 'Describe what was taught (at least 10 characters)' });
        return;
      }
      save.mutate({ values, status });
    });

  if (weekNumber === null) {
    return (
      <Section>
        <EmptyState
          title="This lesson cannot be recorded"
          description="It falls beyond the scheme of learning for this term."
        />
      </Section>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Section title="Lesson" className="h-fit">
        <dl className="space-y-2 px-4 py-3 text-sm">
          <div>
            <dt className="text-muted">Subject and class</dt>
            <dd>
              {lesson.assignment.subject.name} · {lesson.assignment.schoolClass.name}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Date and time</dt>
            <dd>
              {formatDate(lesson.date)}, {lesson.startTime}–{lesson.endTime}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Curriculum week</dt>
            <dd>
              Week {weekNumber} {kind && kind !== 'TEACHING' && <StatusBadge status={kind} />}
            </dd>
          </div>
          <div>
            <dt className="text-muted">State</dt>
            <dd>
              <StatusBadge status={lesson.state} />
            </dd>
          </div>
        </dl>
      </Section>

      <form className="space-y-5 lg:col-span-2" noValidate onSubmit={(e) => e.preventDefault()}>
        {locked && (
          <Alert tone="warn">
            <p className="font-medium">{locked.message}</p>
            <ul className="mt-2 list-disc pl-5">
              {locked.details.outstandingLessons.map((o) => (
                <li key={o.id}>
                  <Link to={`/t/lessons/${o.id}/record`} className="underline">
                    {formatDate(o.date)} at {o.startTime}
                  </Link>
                </li>
              ))}
            </ul>
          </Alert>
        )}

        <Section title={kind === 'REVISION' ? 'Topics revised' : 'Topics taught'}>
          <fieldset className="px-4 py-3">
            <legend className="sr-only">Topics from week {weekNumber}</legend>
            {entries.length ? (
              <ul className="space-y-2">
                {entries.map((e) => (
                  <li key={e.id}>
                    <label className="flex cursor-pointer gap-3 rounded-md border border-line p-3 hover:bg-canvas has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
                      <input
                        type="checkbox"
                        value={e.id}
                        className="mt-1 h-4 w-4 accent-[#0f766e]"
                        {...register('entryIds')}
                      />
                      <TopicText entry={e} />
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">
                No topics are published for this week.{' '}
                {kind === 'REVISION' ? 'Describe what you revised below.' : 'Ask your headmaster.'}
              </p>
            )}
            {formState.errors.entryIds?.message && (
              <p className="mt-2 text-xs text-bad">{formState.errors.entryIds.message}</p>
            )}
          </fieldset>
          {kind === 'REVISION' && (
            <div className="border-t border-line px-4 py-3">
              <FormField
                label="Topic note"
                hint="Optional when topics are ticked above"
                error={formState.errors.topicNote?.message}
              >
                <input className="input" {...register('topicNote')} />
              </FormField>
            </div>
          )}
        </Section>

        <Section title="What happened in the lesson">
          <div className="space-y-4 px-4 py-4">
            <FormField
              label="What was taught"
              required
              error={formState.errors.taughtSummary?.message}
            >
              <textarea className="input" rows={4} {...register('taughtSummary')} />
            </FormField>
            <FormField label="Learning outcomes" error={formState.errors.outcomes?.message}>
              <textarea className="input" rows={2} {...register('outcomes')} />
            </FormField>
            <FormField label="Challenges" error={formState.errors.challenges?.message}>
              <textarea className="input" rows={2} {...register('challenges')} />
            </FormField>
            <FormField label="Remarks" error={formState.errors.remarks?.message}>
              <textarea className="input" rows={2} {...register('remarks')} />
            </FormField>
          </div>
        </Section>

        {formError && <Alert>{formError}</Alert>}
        {saved && <Alert tone="ok">{saved}</Alert>}
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="btn-secondary"
            disabled={save.isPending}
            onClick={submit('DRAFT')}
          >
            Save draft
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={save.isPending}
            onClick={submit('SUBMITTED')}
          >
            {save.isPending ? 'Saving…' : 'Submit record'}
          </button>
        </div>
      </form>
    </div>
  );
}
