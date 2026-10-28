import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FiEdit2, FiTrash2 } from 'react-icons/fi';
import { api, type One } from '../../lib/api';
import { levelLabel } from '../../lib/format';
import { fullErrorMessage } from '../../lib/forms';
import { Section } from '../../components/PageHeader';
import { FilterBar, FilterSelect } from '../../components/Filters';
import { Alert, EmptyState, QueryView } from '../../components/States';
import { ConfirmDialog, Drawer } from '../../components/Overlays';
import { TopicText } from '../curriculum/TopicText';
import { levelOptions, subjectOptions, useSubjects, weekOptions } from '../reference';
import type { CurriculumEntry } from '../../types/api';

/** The live scheme's topics for a term, each one correctable by the headmaster. */
export function CurriculumTopics({ termId, canEdit }: { termId: string; canEdit: boolean }) {
  const subjects = useSubjects();
  const [level, setLevel] = useState('BASIC_7');
  const [subjectId, setSubjectId] = useState('');
  const [week, setWeek] = useState('1');
  const [editing, setEditing] = useState<CurriculumEntry | null>(null);
  const [removing, setRemoving] = useState<CurriculumEntry | null>(null);
  const qc = useQueryClient();
  const subjectName = new Map((subjects.data ?? []).map((s) => [s.id, s.name]));

  const topics = useQuery({
    queryKey: ['curriculum', 'topics', termId, level, subjectId, week],
    queryFn: () =>
      api
        .get<One<{ scheme: { title: string } | null; entries: CurriculumEntry[] }>>('/curriculum', {
          termId,
          ...(level ? { level } : {}),
          ...(subjectId ? { subjectId } : {}),
          ...(week ? { weekNumber: week } : {}),
        })
        .then((r) => r.data),
    enabled: !!termId,
  });

  return (
    <Section title="Topics">
      <FilterBar>
        <FilterSelect label="Level" value={level} onChange={setLevel} options={levelOptions} />
        <FilterSelect
          label="Subject"
          value={subjectId}
          onChange={setSubjectId}
          options={subjectOptions(subjects.data)}
        />
        <FilterSelect label="Week" value={week} onChange={setWeek} options={weekOptions()} />
      </FilterBar>
      <QueryView query={topics}>
        {(d) =>
          !d.scheme ? (
            <EmptyState
              title="No scheme for this term yet"
              description="Upload the scheme-of-learning PDF above. Its topics appear here straight away."
            />
          ) : d.entries.length ? (
            <ul className="divide-y divide-line">
              {d.entries.map((e) => (
                <li key={e.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="mb-1 text-xs font-medium text-muted">
                      {(e.subjectId && subjectName.get(e.subjectId)) ?? 'Subject'} ·{' '}
                      {e.level ? levelLabel(e.level) : ''} · Week {e.weekNumber}
                    </p>
                    <TopicText entry={e} />
                  </div>
                  {canEdit && (
                    <span className="flex shrink-0 flex-col gap-1 sm:flex-row">
                      <button
                        type="button"
                        className="btn-secondary h-8 text-xs"
                        onClick={() => setEditing(e)}
                      >
                        <FiEdit2 aria-hidden /> Edit
                      </button>
                      <button
                        type="button"
                        className="btn-danger h-8 text-xs"
                        onClick={() => setRemoving(e)}
                      >
                        <FiTrash2 aria-hidden /> Delete
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No topics match"
              description="Try another week or subject. Revision, mock and examination weeks have no topics."
            />
          )
        }
      </QueryView>
      <EditTopic entry={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={!!removing}
        danger
        title="Delete this topic?"
        body={`"${removing?.indicator ?? ''}" is taken off the scheme of work for week ${removing?.weekNumber ?? ''}. A topic that lessons have been recorded against cannot be deleted; edit its wording instead.`}
        confirmLabel="Delete"
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          await api.delete(`/curriculum/entries/${removing?.id}`);
          void qc.invalidateQueries({ queryKey: ['curriculum'] });
        }}
      />
    </Section>
  );
}

const fields = ['strand', 'subStrand', 'contentStandard', 'indicator'] as const;
const fieldLabels: Record<(typeof fields)[number], string> = {
  strand: 'Strand',
  subStrand: 'Sub-strand',
  contentStandard: 'Content standard',
  indicator: 'Indicator',
};

function EditTopic({ entry, onClose }: { entry: CurriculumEntry | null; onClose: () => void }) {
  return (
    <Drawer open={!!entry} onClose={onClose} title="Edit topic">
      {/* Keyed so the form starts from the chosen topic each time it opens. */}
      {entry && <EditTopicForm key={entry.id} entry={entry} onDone={onClose} />}
    </Drawer>
  );
}

function EditTopicForm({ entry, onDone }: { entry: CurriculumEntry; onDone: () => void }) {
  const qc = useQueryClient();
  const formId = useId();
  const [values, setValues] = useState({
    strand: entry.strand,
    subStrand: entry.subStrand,
    contentStandard: entry.contentStandard,
    indicator: entry.indicator,
    weekNumber: entry.weekNumber,
  });
  const save = useMutation({
    mutationFn: () => {
      const changed = Object.fromEntries(
        Object.entries(values).filter(([k, v]) => v !== entry[k as keyof CurriculumEntry]),
      );
      return Object.keys(changed).length
        ? api.patch(`/curriculum/entries/${entry.id}`, changed)
        : Promise.resolve(null);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['curriculum'] });
      onDone();
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      className="space-y-4"
    >
      <p className="text-sm text-muted">
        Fix wording the PDF cut off or misprinted. Lesson records already made against this topic
        show the corrected wording. The change is recorded in the audit log.
      </p>
      {fields.map((f) => (
        <div key={f}>
          <label htmlFor={`${formId}-${f}`} className="label">
            {fieldLabels[f]}
          </label>
          <textarea
            id={`${formId}-${f}`}
            className="input min-h-16"
            rows={f === 'strand' || f === 'subStrand' ? 1 : 3}
            value={values[f]}
            required={f === 'strand' || f === 'indicator'}
            onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}
          />
        </div>
      ))}
      <div>
        <label htmlFor={`${formId}-week`} className="label">
          Week
        </label>
        <select
          id={`${formId}-week`}
          className="input w-40"
          value={values.weekNumber}
          onChange={(e) => setValues((v) => ({ ...v, weekNumber: Number(e.target.value) }))}
        >
          {weekOptions().map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {save.isError && <Alert>{fullErrorMessage(save.error)}</Alert>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onDone}>
          Cancel
        </button>
        <button
          type="submit"
          className="btn-primary"
          disabled={save.isPending}
          aria-busy={save.isPending}
        >
          {save.isPending ? 'Saving…' : 'Save topic'}
        </button>
      </div>
    </form>
  );
}
