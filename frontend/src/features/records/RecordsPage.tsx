import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, type Page } from '../../lib/api';
import { formatDate, formatDateTime } from '../../lib/format';
import { useUrlState } from '../../lib/useUrlState';
import { PageHeader, Section } from '../../components/PageHeader';
import { DataTable } from '../../components/DataTable';
import { FilterBar, FilterSelect, Pagination, SearchInput } from '../../components/Filters';
import { EmptyState, QueryView } from '../../components/States';
import { StatusBadge } from '../../components/StatusBadge';
import { Drawer } from '../../components/Overlays';
import {
  classOptions,
  levelOptions,
  subjectOptions,
  useClasses,
  useSubjects,
  weekOptions,
} from '../reference';
import { RecordView, useRecord } from './RecordDetail';
import type { TeachingRecord } from '../../types/api';

const KEYS = [
  'q',
  'teacherProfileId',
  'level',
  'subjectId',
  'classId',
  'weekNumber',
  'dateFrom',
  'dateTo',
  'status',
  'completion',
  'sort',
  'record',
] as const;

export function RecordsPage({ area }: { area: 'teacher' | 'headmaster' }) {
  const navigate = useNavigate();
  const { values, set, clear, page } = useUrlState(KEYS);
  const subjects = useSubjects();
  const classes = useClasses();
  const { record: openRecord, ...filters } = values;

  const records = useQuery({
    queryKey: ['records', 'list', filters],
    queryFn: () =>
      api.get<Page<TeachingRecord>>('/teaching-records', {
        ...filters,
        page,
        sort: filters.sort || '-lessonDate',
      }),
    placeholderData: keepPreviousData,
  });
  const active = KEYS.some((k) => k !== 'record' && k !== 'sort' && values[k]);
  const isHead = area === 'headmaster';

  return (
    <>
      <PageHeader
        title={isHead ? 'Teaching activity' : 'Teaching records'}
        description={
          isHead
            ? 'Every submitted lesson record in the school. Search and filters run on the server.'
            : 'Your submitted records and drafts.'
        }
      />
      <Section>
        <FilterBar onClear={clear} active={active}>
          {isHead && (
            <SearchInput
              value={values.q}
              onChange={(q) => set({ q })}
              placeholder="Teacher, staff ID or subject"
            />
          )}
          <FilterSelect
            label="Level"
            value={values.level}
            onChange={(level) => set({ level })}
            options={levelOptions}
          />
          <FilterSelect
            label="Subject"
            value={values.subjectId}
            onChange={(subjectId) => set({ subjectId })}
            options={subjectOptions(subjects.data)}
          />
          <FilterSelect
            label="Class"
            value={values.classId}
            onChange={(classId) => set({ classId })}
            options={classOptions(classes.data)}
          />
          <FilterSelect
            label="Week"
            value={values.weekNumber}
            onChange={(weekNumber) => set({ weekNumber })}
            options={weekOptions()}
          />
          {!isHead && (
            <FilterSelect
              label="Status"
              value={values.status}
              onChange={(status) => set({ status })}
              options={[
                { value: 'SUBMITTED', label: 'Submitted' },
                { value: 'DRAFT', label: 'Draft' },
              ]}
            />
          )}
          <FilterSelect
            label="Timeliness"
            value={values.completion}
            onChange={(completion) => set({ completion })}
            options={[
              { value: 'ON_TIME', label: 'On time' },
              { value: 'LATE', label: 'Late' },
            ]}
          />
          <label className="flex items-center gap-1.5 text-sm text-muted">
            From
            <input
              type="date"
              className="input w-auto"
              value={values.dateFrom}
              onChange={(e) => set({ dateFrom: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-1.5 text-sm text-muted">
            To
            <input
              type="date"
              className="input w-auto"
              value={values.dateTo}
              onChange={(e) => set({ dateTo: e.target.value })}
            />
          </label>
          <FilterSelect
            label="Sort"
            allLabel="Newest lesson first"
            value={values.sort === '-lessonDate' ? '' : values.sort}
            onChange={(sort) => set({ sort })}
            options={[
              { value: 'lessonDate', label: 'Oldest lesson first' },
              { value: '-submittedAt', label: 'Latest submitted' },
              { value: 'submittedAt', label: 'Earliest submitted' },
            ]}
          />
        </FilterBar>
        <QueryView query={records}>
          {(res) =>
            res.data.length ? (
              <>
                <DataTable
                  caption="Teaching records"
                  rows={res.data}
                  rowKey={(r) => r.id}
                  onRowClick={(r) =>
                    isHead
                      ? set({ record: r.id, page: String(page) })
                      : navigate(`/t/records/${r.id}`)
                  }
                  columns={[
                    {
                      key: 'date',
                      header: 'Lesson',
                      render: (r) => (
                        <span className="whitespace-nowrap">
                          {formatDate(r.lesson.date)}, {r.lesson.startTime}
                        </span>
                      ),
                    },
                    ...(isHead
                      ? [
                          {
                            key: 'teacher',
                            header: 'Teacher',
                            render: (r: TeachingRecord) => r.teacher.fullName,
                          },
                        ]
                      : []),
                    { key: 'subject', header: 'Subject', render: (r) => r.subject.name },
                    { key: 'class', header: 'Class', render: (r) => r.schoolClass.name },
                    { key: 'week', header: 'Week', render: (r) => r.weekNumber },
                    {
                      key: 'summary',
                      header: 'What was taught',
                      className: 'max-w-xs',
                      render: (r) => (
                        <span className="line-clamp-2 text-muted">
                          {r.taughtSummary || '(empty draft)'}
                        </span>
                      ),
                    },
                    {
                      key: 'status',
                      header: 'Status',
                      render: (r) =>
                        r.status === 'DRAFT' ? (
                          <StatusBadge status="DRAFT" />
                        ) : (
                          <StatusBadge status={r.isLate ? 'LATE' : 'ON_TIME'} />
                        ),
                    },
                    ...(isHead
                      ? [
                          {
                            key: 'submitted',
                            header: 'Submitted',
                            render: (r: TeachingRecord) => (
                              <span className="whitespace-nowrap text-muted">
                                {formatDateTime(r.submittedAt)}
                              </span>
                            ),
                          },
                        ]
                      : []),
                  ]}
                />
                <Pagination meta={res.meta} onPage={(p) => set({ page: String(p) })} />
              </>
            ) : (
              <EmptyState
                title={active ? 'No records match these filters' : 'No records yet'}
                description={
                  active
                    ? 'Try removing a filter.'
                    : isHead
                      ? 'Records appear here as teachers submit them.'
                      : 'Record a lesson from your overview or scheme of work.'
                }
                action={
                  active ? (
                    <button type="button" className="btn-secondary" onClick={clear}>
                      Clear filters
                    </button>
                  ) : undefined
                }
              />
            )
          }
        </QueryView>
      </Section>
      {isHead && (
        <RecordDrawer
          id={openRecord || null}
          onClose={() => set({ record: '', page: String(page) })}
        />
      )}
    </>
  );
}

export function RecordDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const record = useRecord(id);
  return (
    <Drawer open={!!id} onClose={onClose} title="Teaching record">
      <QueryView query={record}>{(r) => <RecordView record={r} />}</QueryView>
    </Drawer>
  );
}
