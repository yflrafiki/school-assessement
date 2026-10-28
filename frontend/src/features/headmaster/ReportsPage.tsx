import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { PageMeta } from '@school/shared';
import { api, type One } from '../../lib/api';
import { formatDate, percent } from '../../lib/format';
import { useUrlState } from '../../lib/useUrlState';
import { PageHeader, Section } from '../../components/PageHeader';
import { DataTable } from '../../components/DataTable';
import { FilterBar, FilterSelect, Pagination } from '../../components/Filters';
import { EmptyState, QueryView } from '../../components/States';
import {
  classOptions,
  levelOptions,
  subjectOptions,
  useClasses,
  useSubjects,
  useTerms,
} from '../reference';

interface WeeklyReport {
  termId: string | null;
  weeks: {
    weekNumber: number;
    assignmentsWithLessons: number;
    assignmentsComplete: number;
    rate: number | null;
  }[];
}
interface ActivityReport {
  data: {
    dateFrom: string;
    dateTo: string;
    rows: {
      teacher: { id: string; fullName: string; staffId: string };
      submitted: number;
      onTime: number;
      late: number;
    }[];
  };
  meta: PageMeta;
}

export function ReportsPage() {
  const terms = useTerms();
  const subjects = useSubjects();
  const classes = useClasses();
  const { values, set, page } = useUrlState([
    'termId',
    'level',
    'subjectId',
    'classId',
    'dateFrom',
    'dateTo',
  ] as const);

  const weekly = useQuery({
    queryKey: ['reports', 'weekly', values.termId, values.level, values.subjectId, values.classId],
    queryFn: () =>
      api
        .get<One<WeeklyReport>>('/reports/weekly-progress', {
          termId: values.termId,
          level: values.level,
          subjectId: values.subjectId,
          classId: values.classId,
        })
        .then((r) => r.data),
  });
  const activity = useQuery({
    queryKey: ['reports', 'activity', values.dateFrom, values.dateTo, page],
    queryFn: () =>
      api.get<ActivityReport>('/reports/teaching-activity', {
        dateFrom: values.dateFrom,
        dateTo: values.dateTo,
        page,
      }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Reports"
        description="Completion is measured per class subject and week from lessons. Activity counts submitted records."
      />
      <div className="space-y-5">
        <Section title="Weekly completion rate">
          <FilterBar>
            <FilterSelect
              label="Term"
              allLabel="Current"
              value={values.termId}
              onChange={(termId) => set({ ...values, termId })}
              options={(terms.data ?? []).map((t) => ({ value: t.id, label: t.name }))}
            />
            <FilterSelect
              label="Level"
              value={values.level}
              onChange={(level) => set({ ...values, level })}
              options={levelOptions}
            />
            <FilterSelect
              label="Subject"
              value={values.subjectId}
              onChange={(subjectId) => set({ ...values, subjectId })}
              options={subjectOptions(subjects.data, { assignableOnly: true })}
            />
            <FilterSelect
              label="Class"
              value={values.classId}
              onChange={(classId) => set({ ...values, classId })}
              options={classOptions(classes.data)}
            />
          </FilterBar>
          <QueryView query={weekly}>
            {(r) =>
              r.weeks.some((w) => w.assignmentsWithLessons) ? (
                <table className="table">
                  <caption className="sr-only">Weekly completion</caption>
                  <thead>
                    <tr>
                      <th>Week</th>
                      <th>Class subjects with lessons</th>
                      <th>Complete</th>
                      <th>Rate</th>
                      <th className="w-1/3">
                        <span className="sr-only">Bar</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.weeks.map((w) => (
                      <tr key={w.weekNumber}>
                        <td>Week {w.weekNumber}</td>
                        <td className="tabular-nums">{w.assignmentsWithLessons}</td>
                        <td className="tabular-nums">{w.assignmentsComplete}</td>
                        <td className="tabular-nums">{percent(w.rate)}</td>
                        <td>
                          <span className="block h-2 overflow-hidden rounded bg-canvas" aria-hidden>
                            <span
                              className="block h-full bg-accent"
                              style={{ width: `${(w.rate ?? 0) * 100}%` }}
                            />
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyState
                  title="No lessons to measure yet"
                  description="Rates appear once the timetable is published."
                />
              )
            }
          </QueryView>
        </Section>

        <Section title="Teaching activity by teacher">
          <FilterBar>
            <label className="flex items-center gap-1.5 text-sm text-muted">
              From
              <input
                type="date"
                className="input w-auto"
                value={values.dateFrom}
                onChange={(e) => set({ ...values, dateFrom: e.target.value })}
              />
            </label>
            <label className="flex items-center gap-1.5 text-sm text-muted">
              To
              <input
                type="date"
                className="input w-auto"
                value={values.dateTo}
                onChange={(e) => set({ ...values, dateTo: e.target.value })}
              />
            </label>
          </FilterBar>
          <QueryView query={activity}>
            {(res) => (
              <>
                <p className="px-4 pt-3 text-sm text-muted">
                  Lessons dated {formatDate(res.data.dateFrom)} to {formatDate(res.data.dateTo)}.
                </p>
                {res.data.rows.length ? (
                  <>
                    <DataTable
                      rows={res.data.rows}
                      rowKey={(r) => r.teacher.id}
                      columns={[
                        {
                          key: 'teacher',
                          header: 'Teacher',
                          render: (r) => (
                            <Link
                              to={`/h/activity?teacherProfileId=${r.teacher.id}&dateFrom=${res.data.dateFrom}&dateTo=${res.data.dateTo}`}
                              className="link"
                            >
                              {r.teacher.fullName}
                            </Link>
                          ),
                        },
                        {
                          key: 'submitted',
                          header: 'Records submitted',
                          render: (r) => r.submitted,
                        },
                        { key: 'onTime', header: 'Same day', render: (r) => r.onTime },
                        {
                          key: 'late',
                          header: 'Late',
                          render: (r) => (r.late ? <span className="text-warn">{r.late}</span> : 0),
                        },
                      ]}
                    />
                    <Pagination
                      meta={res.meta}
                      onPage={(p) => set({ ...values, page: String(p) })}
                    />
                  </>
                ) : (
                  <EmptyState title="No records in this period" />
                )}
              </>
            )}
          </QueryView>
        </Section>
      </div>
    </>
  );
}
