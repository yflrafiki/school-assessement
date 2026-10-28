import { useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import { api, type One } from '../../lib/api';
import { addDays, formatDate } from '../../lib/format';
import { useUrlState } from '../../lib/useUrlState';
import { PageHeader, Section } from '../../components/PageHeader';
import { FilterBar, FilterSelect, SearchInput } from '../../components/Filters';
import { EmptyState, QueryView } from '../../components/States';
import { StatusBadge } from '../../components/StatusBadge';
import { LessonDecisions } from './LessonDecisions';
import type { Lesson } from '../../types/api';

interface Board {
  date: string;
  isClosed: boolean;
  counts: Partial<Record<string, number>>;
  lessons: Lesson[];
}

const STATE_OPTIONS = [
  'DUE',
  'OVERDUE',
  'COMPLETED',
  'UPCOMING',
  'WAIVED',
  'CANCELLED',
  'RESCHEDULED',
].map((s) => ({
  value: s,
  label: s.charAt(0) + s.slice(1).toLowerCase(),
}));

export function DailyLessons() {
  const { values, set } = useUrlState(['date', 'state', 'q'] as const);
  const board = useQuery({
    queryKey: ['daily', values.date],
    queryFn: () =>
      api.get<One<Board>>('/dashboard/headmaster/daily', { date: values.date }).then((r) => r.data),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const date = values.date || board.data?.date || '';

  const grouped = useMemo(() => {
    const q = values.q.toLowerCase();
    const lessons = (board.data?.lessons ?? []).filter(
      (l) =>
        (!values.state || l.state === values.state) &&
        (!q ||
          l.assignment.teacher.fullName.toLowerCase().includes(q) ||
          l.assignment.subject.name.toLowerCase().includes(q)),
    );
    const map = new Map<string, { teacher: Lesson['assignment']['teacher']; lessons: Lesson[] }>();
    for (const l of lessons) {
      const g = map.get(l.assignment.teacher.id) ?? { teacher: l.assignment.teacher, lessons: [] };
      g.lessons.push(l);
      map.set(l.assignment.teacher.id, g);
    }
    return [...map.values()].sort((a, b) => a.teacher.fullName.localeCompare(b.teacher.fullName));
  }, [board.data, values.state, values.q]);

  return (
    <>
      <PageHeader
        title="Daily lessons"
        description="Every timetabled lesson for the day with its state. Overdue starts on the next school day."
        actions={
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="btn-secondary px-2"
              onClick={() => date && set({ date: addDays(date, -1) })}
              aria-label="Previous day"
            >
              <FiChevronLeft aria-hidden />
            </button>
            <label htmlFor="board-date" className="sr-only">
              Date
            </label>
            <input
              id="board-date"
              type="date"
              className="input w-auto"
              value={date}
              onChange={(e) => set({ date: e.target.value })}
            />
            <button
              type="button"
              className="btn-secondary px-2"
              onClick={() => date && set({ date: addDays(date, 1) })}
              aria-label="Next day"
            >
              <FiChevronRight aria-hidden />
            </button>
            {values.date && (
              <button type="button" className="btn-ghost" onClick={() => set({ date: '' })}>
                Today
              </button>
            )}
          </div>
        }
      />
      <QueryView query={board}>
        {(b) => (
          <Section>
            <div className="flex flex-wrap gap-x-5 gap-y-1 border-b border-line px-4 py-3 text-sm">
              <span className="font-medium">{formatDate(b.date)}</span>
              {b.isClosed && <span className="text-muted">No school (weekend or holiday)</span>}
              {(['COMPLETED', 'DUE', 'OVERDUE', 'UPCOMING', 'WAIVED', 'CANCELLED'] as const).map(
                (s) =>
                  b.counts[s] ? (
                    <span key={s} className="text-muted">
                      {s.charAt(0) + s.slice(1).toLowerCase()}:{' '}
                      <span className="font-medium text-ink tabular-nums">{b.counts[s]}</span>
                    </span>
                  ) : null,
              )}
            </div>
            <FilterBar>
              <SearchInput
                value={values.q}
                onChange={(q) => set({ q, date: values.date })}
                placeholder="Teacher or subject"
              />
              <FilterSelect
                label="State"
                value={values.state}
                onChange={(state) => set({ state, date: values.date })}
                options={STATE_OPTIONS}
              />
            </FilterBar>
            {grouped.length ? (
              <div className="divide-y divide-line">
                {grouped.map((g) => (
                  <div key={g.teacher.id} className="px-4 py-3">
                    <Link
                      to={`/h/teachers/${g.teacher.id}`}
                      className="font-medium hover:text-accent"
                    >
                      {g.teacher.fullName}
                    </Link>
                    <ul className="mt-2 space-y-1.5">
                      {g.lessons.map((l) => (
                        <li
                          key={l.id}
                          className="flex flex-col gap-1 rounded-md border border-line px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <span className="text-sm">
                            <span className="tabular-nums text-muted">
                              {l.startTime}–{l.endTime}
                            </span>{' '}
                            · {l.assignment.subject.name} · {l.assignment.schoolClass.name}
                            {l.weekNumber !== null && (
                              <span className="text-muted"> · Week {l.weekNumber}</span>
                            )}
                            {l.reason && <span className="text-muted"> · {l.reason}</span>}
                          </span>
                          <span className="flex items-center gap-2">
                            <StatusBadge status={l.state} />
                            {l.record?.status === 'SUBMITTED' ? (
                              <Link
                                to={`/h/activity?record=${l.record.id}`}
                                className="link text-xs"
                              >
                                View record
                              </Link>
                            ) : (
                              <LessonDecisions lesson={l} />
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title={
                  b.lessons.length ? 'No lessons match these filters' : 'No lessons on this day'
                }
                description={
                  b.lessons.length
                    ? undefined
                    : 'Lessons appear once the timetable is published for the term.'
                }
              />
            )}
          </Section>
        )}
      </QueryView>
    </>
  );
}
