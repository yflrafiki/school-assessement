import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FiUpload } from 'react-icons/fi';
import { createImportBody } from '@school/shared';
import { api, type One } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { fullErrorMessage } from '../../lib/forms';
import { PageHeader, Section } from '../../components/PageHeader';
import { DataTable } from '../../components/DataTable';
import { Alert, EmptyState, QueryView } from '../../components/States';
import { StatusBadge } from '../../components/StatusBadge';
import { ConfirmDialog } from '../../components/Overlays';
import { useCan } from '../auth/useMe';
import { useTerms } from '../reference';
import type { ImportBatch } from '../../types/api';

interface Scheme {
  id: string;
  termId: string;
  termName: string;
  version: number;
  title: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  publishedAt: string | null;
  entryCount: number;
}

export function CurriculumPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const terms = useTerms();
  const canPublish = useCan('school.setup');
  const fileRef = useRef<HTMLInputElement>(null);
  const [termId, setTermId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState<Scheme | null>(null);
  const effectiveTerm = termId || terms.data?.find((t) => t.isCurrent)?.id || '';

  const schemes = useQuery({
    queryKey: ['curriculum', 'schemes'],
    queryFn: () => api.get<One<Scheme[]>>('/curriculum/schemes').then((r) => r.data),
  });
  const imports = useQuery({
    queryKey: ['curriculum', 'imports'],
    queryFn: () =>
      api
        .get<One<(Omit<ImportBatch, 'counts' | 'term'> & { termName: string })[]>>(
          '/curriculum/imports',
        )
        .then((r) => r.data),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      // The scheme-of-learning PDF is read on the server. A JSON extraction is still accepted.
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
        return api.upload<One<ImportBatch>>('/curriculum/imports/pdf', file, 'application/pdf', {
          termId: effectiveTerm,
          fileName: file.name,
        });
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        throw new Error('Upload the scheme of learning as a PDF file.');
      }
      const body = createImportBody.safeParse({ ...(parsed as object), termId: effectiveTerm });
      if (!body.success)
        throw new Error(
          `The file does not match the extractor format: ${body.error.issues[0]?.path.join('.')} ${body.error.issues[0]?.message}`,
        );
      return api.post<One<ImportBatch>>('/curriculum/imports', body.data);
    },
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['curriculum'] });
      navigate(`/h/curriculum/imports/${res.data.id}`);
    },
    onError: (e) =>
      setError(e instanceof Error && !('code' in e) ? e.message : fullErrorMessage(e)),
  });

  return (
    <>
      <PageHeader
        title="Curriculum"
        description="Upload the term's scheme of learning, review the flagged rows, then publish it so teachers can record lessons."
      />

      <Section title="Upload the term's scheme of learning" className="mb-5">
        <div className="space-y-4 px-4 py-4">
          {terms.isPending ? (
            <p className="text-sm text-muted">Loading terms…</p>
          ) : !terms.data?.length ? (
            <Alert tone="warn">
              No term has been set up yet. The scheme of learning belongs to a term, so create the
              academic year and the term first
              {canPublish ? (
                <>
                  {' '}
                  in{' '}
                  <Link to="/h/settings?tab=terms" className="font-medium underline">
                    Settings → Years and terms
                  </Link>
                  , then come back here.
                </>
              ) : (
                '. Ask the headmaster to do this, then come back here.'
              )}
            </Alert>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-sm">
                  <span className="label">Term</span>
                  <select
                    className="input w-auto"
                    value={effectiveTerm}
                    onChange={(e) => setTermId(e.target.value)}
                    disabled={upload.isPending}
                  >
                    {terms.data.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} {t.academicYearName}
                        {t.isCurrent ? ' (current)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="sr-only"
                  id="import-file"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    setError(null);
                    if (f) upload.mutate(f);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!effectiveTerm || upload.isPending}
                  aria-busy={upload.isPending}
                  onClick={() => fileRef.current?.click()}
                >
                  {upload.isPending ? (
                    <span
                      aria-hidden
                      className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white motion-safe:animate-spin"
                    />
                  ) : (
                    <FiUpload aria-hidden />
                  )}
                  {upload.isPending ? 'Reading the PDF…' : 'Choose the PDF and upload'}
                </button>
              </div>
              {upload.isPending ? (
                <p role="status" className="text-sm text-muted">
                  Reading every table in the PDF. This takes a few seconds; please keep this page
                  open.
                </p>
              ) : (
                <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
                  <li>
                    Upload the scheme-of-learning PDF for the term (for example the CEPME file).
                  </li>
                  <li>
                    Review the flagged rows: approve the cut-off rows in one step, then check the
                    few others one by one.
                  </li>
                  <li>
                    Approve the import, then publish the scheme below. Teachers can then record
                    lessons.
                  </li>
                </ol>
              )}
            </>
          )}
        </div>
      </Section>

      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}
      <div className="space-y-5">
        <Section title="Schemes">
          <QueryView query={schemes}>
            {(rows) =>
              rows.length ? (
                <DataTable
                  rows={rows}
                  rowKey={(s) => s.id}
                  columns={[
                    { key: 'title', header: 'Scheme', render: (s) => s.title },
                    { key: 'term', header: 'Term', render: (s) => s.termName },
                    { key: 'entries', header: 'Topics', render: (s) => s.entryCount },
                    {
                      key: 'status',
                      header: 'Status',
                      render: (s) => <StatusBadge status={s.status} />,
                    },
                    {
                      key: 'published',
                      header: 'Published',
                      render: (s) => (s.publishedAt ? formatDateTime(s.publishedAt) : '–'),
                    },
                    {
                      key: 'actions',
                      header: '',
                      render: (s) =>
                        s.status === 'DRAFT' && canPublish ? (
                          <button
                            type="button"
                            className="btn-secondary h-7 text-xs"
                            onClick={() => setPublishing(s)}
                          >
                            Publish
                          </button>
                        ) : null,
                    },
                  ]}
                />
              ) : (
                <EmptyState
                  title="No schemes yet"
                  description="Upload the extractor output, review it and approve it to create a scheme."
                />
              )
            }
          </QueryView>
        </Section>
        <Section title="Imports">
          <QueryView query={imports}>
            {(rows) =>
              rows.length ? (
                <DataTable
                  rows={rows}
                  rowKey={(b) => b.id}
                  onRowClick={(b) => navigate(`/h/curriculum/imports/${b.id}`)}
                  columns={[
                    { key: 'file', header: 'File', render: (b) => b.fileName },
                    { key: 'term', header: 'Term', render: (b) => b.termName },
                    {
                      key: 'created',
                      header: 'Uploaded',
                      render: (b) => formatDateTime(b.createdAt),
                    },
                    {
                      key: 'status',
                      header: 'Status',
                      render: (b) => <StatusBadge status={b.status} />,
                    },
                    {
                      key: 'open',
                      header: '',
                      render: (b) => (
                        <Link to={`/h/curriculum/imports/${b.id}`} className="link text-sm">
                          Review
                        </Link>
                      ),
                    },
                  ]}
                />
              ) : (
                <EmptyState
                  title="No imports yet"
                  description="Choose the term, then upload the scheme-of-learning PDF. Every row is read from its tables and shown for review before anything reaches teachers."
                />
              )
            }
          </QueryView>
        </Section>
      </div>
      <ConfirmDialog
        open={!!publishing}
        title="Publish this scheme?"
        body="It becomes the scheme for the term. Any earlier published version is archived, and every class subject is re-paced. Records already submitted keep their topics."
        confirmLabel="Publish"
        onClose={() => setPublishing(null)}
        onConfirm={async () => {
          await api.post(`/curriculum/schemes/${publishing?.id}/publish`);
          void qc.invalidateQueries();
        }}
      />
    </>
  );
}
