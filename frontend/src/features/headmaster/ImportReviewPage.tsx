import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type One, type Page } from '../../lib/api';
import { levelLabel } from '../../lib/format';
import { fullErrorMessage } from '../../lib/forms';
import { useUrlState } from '../../lib/useUrlState';
import { PageHeader, Section } from '../../components/PageHeader';
import { DataTable } from '../../components/DataTable';
import { FilterBar, FilterSelect, Pagination, SearchInput } from '../../components/Filters';
import { Alert, EmptyState, QueryView } from '../../components/States';
import { Badge, StatusBadge } from '../../components/StatusBadge';
import { ConfirmDialog, Drawer } from '../../components/Overlays';
import { levelOptions } from '../reference';
import type { ImportBatch, ImportRow } from '../../types/api';

const FLAG_LABELS: Record<string, string> = {
  TRUNCATED: 'Cut off in source',
  CODE_LEVEL_MISMATCH: 'Code level mismatch',
  MERGED_CELL_INHERITED: 'From merged cell',
  OCR_OR_SPACING_NOISE: 'Spacing or text noise',
  UNREADABLE: 'Unreadable',
};

export function ImportReviewPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const { values, set, page } = useUrlState(['flagged', 'decision', 'level', 'subject'] as const);
  const [reviewing, setReviewing] = useState<ImportRow | null>(null);
  const [approving, setApproving] = useState(false);
  const flagged = values.flagged || 'true';

  const batch = useQuery({
    queryKey: ['curriculum', 'import', id],
    queryFn: () => api.get<One<ImportBatch>>(`/curriculum/imports/${id}`).then((r) => r.data),
  });
  const rows = useQuery({
    queryKey: ['curriculum', 'import', id, 'rows', { ...values, flagged, page }],
    queryFn: () =>
      api.get<Page<ImportRow>>(`/curriculum/imports/${id}/rows`, {
        ...values,
        flagged: flagged === 'all' ? '' : flagged,
        page,
      }),
    placeholderData: keepPreviousData,
  });

  return (
    <QueryView query={batch}>
      {(b) => (
        <>
          <PageHeader
            title={`Import: ${b.fileName}`}
            description={
              <>
                <Link to="/h/curriculum" className="link">
                  Curriculum
                </Link>{' '}
                · {b.term.name} · <StatusBadge status={b.status} />
              </>
            }
            actions={
              b.status === 'STAGED' ? (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={b.counts.flaggedPending > 0}
                  onClick={() => setApproving(true)}
                  title={b.counts.flaggedPending ? 'Review every flagged row first' : undefined}
                >
                  Approve and import
                </button>
              ) : b.scheme ? (
                <Link to="/h/curriculum" className="btn-secondary">
                  Go to scheme v{b.scheme.version}
                </Link>
              ) : null
            }
          />
          <div className="mb-5 grid gap-3 sm:grid-cols-4">
            {[
              ['Rows', b.counts.total],
              ['Flagged', b.counts.flagged],
              ['Flagged, not reviewed', b.counts.flaggedPending],
              ['Rejected', b.counts.decisions.REJECTED ?? 0],
            ].map(([label, value]) => (
              <div key={label} className="card px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
              </div>
            ))}
          </div>
          {(b.report.warnings?.length ||
            b.report.notes?.length ||
            b.report.imported !== undefined) && (
            <Section title="Import report" className="mb-5">
              <div className="space-y-3 px-4 py-3 text-sm">
                {b.report.imported !== undefined && (
                  <p>
                    Imported {b.report.imported}, rejected {b.report.rejected ?? 0}, duplicates
                    skipped {b.report.duplicates ?? 0}, corrected {b.report.corrected ?? 0}.
                  </p>
                )}
                {!!b.report.notes?.length && (
                  <div>
                    <p className="font-medium">Extractor notes</p>
                    <ul className="mt-1 list-disc pl-5 text-muted">
                      {b.report.notes.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {!!b.report.warnings?.length && (
                  <div>
                    <p className="font-medium">Structure checks</p>
                    <ul className="mt-1 list-disc pl-5 text-warn">
                      {b.report.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Section>
          )}
          <Section>
            <FilterBar>
              <FilterSelect
                label="Rows"
                allLabel="Flagged"
                value={flagged === 'true' ? '' : flagged}
                onChange={(v) => set({ flagged: v })}
                options={[
                  { value: 'false', label: 'Not flagged' },
                  { value: 'all', label: 'All rows' },
                ]}
              />
              <FilterSelect
                label="Decision"
                value={values.decision}
                onChange={(decision) => set({ decision, flagged: values.flagged })}
                options={['PENDING', 'APPROVED', 'CORRECTED', 'REJECTED'].map((d) => ({
                  value: d,
                  label: d.charAt(0) + d.slice(1).toLowerCase(),
                }))}
              />
              <FilterSelect
                label="Level"
                value={values.level}
                onChange={(level) => set({ level, flagged: values.flagged })}
                options={levelOptions}
              />
              <SearchInput
                value={values.subject}
                onChange={(subject) => set({ subject, flagged: values.flagged })}
                placeholder="Subject"
                label="Subject"
              />
            </FilterBar>
            <QueryView query={rows}>
              {(res) =>
                res.data.length ? (
                  <>
                    <DataTable
                      rows={res.data}
                      rowKey={(r) => r.id}
                      onRowClick={b.status === 'STAGED' ? setReviewing : undefined}
                      columns={[
                        {
                          key: 'where',
                          header: 'Level, subject, week',
                          render: (r) => (
                            <span className="whitespace-nowrap">
                              {levelLabel(r.level)} · {r.subjectName} · W{r.weekNumber}
                              <span className="block text-xs text-muted">Page {r.sourcePage}</span>
                            </span>
                          ),
                        },
                        {
                          key: 'text',
                          header: 'Indicator',
                          className: 'max-w-md',
                          render: (r) => (
                            <span className="text-sm">
                              {r.indicator || <em className="text-muted">empty</em>}
                              <span className="block text-xs text-muted">
                                {r.strand} › {r.subStrand}
                              </span>
                            </span>
                          ),
                        },
                        {
                          key: 'flags',
                          header: 'Flags',
                          render: (r) => (
                            <span className="flex flex-wrap gap-1">
                              {r.flags.map((f) => (
                                <Badge key={f} tone="warn">
                                  {FLAG_LABELS[f] ?? f}
                                </Badge>
                              ))}
                            </span>
                          ),
                        },
                        {
                          key: 'decision',
                          header: 'Decision',
                          render: (r) => <StatusBadge status={r.decision} />,
                        },
                      ]}
                    />
                    <Pagination
                      meta={res.meta}
                      onPage={(p) => set({ ...values, page: String(p) })}
                    />
                  </>
                ) : (
                  <EmptyState title="No rows match" />
                )
              }
            </QueryView>
          </Section>
          <ReviewDrawer batchId={id} row={reviewing} onClose={() => setReviewing(null)} />
          <ConfirmDialog
            open={approving}
            title="Approve and import?"
            body="A draft scheme is created from every approved and corrected row. Rejected rows are skipped. You publish the scheme as a separate step."
            confirmLabel="Approve and import"
            onClose={() => setApproving(false)}
            onConfirm={async () => {
              await api.post(`/curriculum/imports/${id}/approve`);
              void qc.invalidateQueries({ queryKey: ['curriculum'] });
            }}
          />
        </>
      )}
    </QueryView>
  );
}

function ReviewDrawer({
  batchId,
  row,
  onClose,
}: {
  batchId: string;
  row: ImportRow | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [text, setText] = useState({
    strand: '',
    subStrand: '',
    contentStandard: '',
    indicator: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [lastId, setLastId] = useState<string | null>(null);
  if (row && row.id !== lastId) {
    setLastId(row.id);
    setNote(row.reviewNote ?? '');
    setText({
      strand: row.strand,
      subStrand: row.subStrand,
      contentStandard: row.contentStandard,
      indicator: row.indicator,
    });
    setError(null);
  }

  const review = useMutation({
    mutationFn: (decision: 'APPROVED' | 'CORRECTED' | 'REJECTED') =>
      api.patch(`/curriculum/imports/${batchId}/rows/${row?.id}`, {
        decision,
        note: note || undefined,
        ...(decision === 'CORRECTED' ? { corrected: text } : {}),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['curriculum', 'import', batchId] });
      onClose();
    },
    onError: (e) => setError(fullErrorMessage(e)),
  });
  const changed =
    row &&
    (text.strand !== row.strand ||
      text.subStrand !== row.subStrand ||
      text.contentStandard !== row.contentStandard ||
      text.indicator !== row.indicator);

  return (
    <Drawer
      open={!!row}
      onClose={onClose}
      title="Review row"
      footer={
        <>
          <button
            type="button"
            className="btn-danger"
            disabled={review.isPending}
            onClick={() => review.mutate('REJECTED')}
          >
            Reject
          </button>
          {changed ? (
            <button
              type="button"
              className="btn-primary"
              disabled={review.isPending || !note.trim()}
              onClick={() => review.mutate('CORRECTED')}
            >
              Save correction
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary"
              disabled={review.isPending}
              onClick={() => review.mutate('APPROVED')}
            >
              {row?.flags.includes('TRUNCATED') ? 'Approve as truncated' : 'Approve'}
            </button>
          )}
        </>
      }
    >
      {row && (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            {levelLabel(row.level)} · {row.subjectName} · Week {row.weekNumber} · PDF page{' '}
            {row.sourcePage}
          </p>
          <div className="flex flex-wrap gap-1">
            {row.flags.map((f) => (
              <Badge key={f} tone="warn">
                {FLAG_LABELS[f] ?? f}
              </Badge>
            ))}
          </div>
          {row.flags.includes('TRUNCATED') && (
            <Alert tone="info">
              The source text is cut off. Approve it as truncated; do not guess the missing words.
              The full wording is in the national syllabus.
            </Alert>
          )}
          {(['strand', 'subStrand', 'contentStandard', 'indicator'] as const).map((k) => (
            <label key={k} className="block text-sm">
              <span className="label">
                {
                  {
                    strand: 'Strand',
                    subStrand: 'Sub-strand',
                    contentStandard: 'Content standard',
                    indicator: 'Indicator',
                  }[k]
                }
              </span>
              <textarea
                className="input"
                rows={k === 'indicator' || k === 'contentStandard' ? 3 : 1}
                value={text[k]}
                onChange={(e) => setText({ ...text, [k]: e.target.value })}
              />
            </label>
          ))}
          <label className="block text-sm">
            <span className="label">
              Review note {changed && <span className="text-bad">*</span>}
            </span>
            <textarea
              className="input"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={changed ? 'Explain the correction' : 'Optional'}
            />
          </label>
          {error && <Alert>{error}</Alert>}
        </div>
      )}
    </Drawer>
  );
}
