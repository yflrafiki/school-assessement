import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ROLES, USER_STATUSES } from '@school/shared';
import { api, type One, type Page } from '../../lib/api';
import { formatDateTime, relativeTime } from '../../lib/format';
import { useUrlState } from '../../lib/useUrlState';
import { PageHeader, Section } from '../../components/PageHeader';
import { DataTable } from '../../components/DataTable';
import { FilterBar, FilterSelect, Pagination, SearchInput } from '../../components/Filters';
import { Badge, StatusBadge } from '../../components/StatusBadge';
import { Alert, EmptyState, QueryView } from '../../components/States';
import { useCurrentUser } from '../auth/useMe';
import { ACTION_GROUPS, describeAction } from './activityText';

// ---------- Shared shapes ----------

interface ActivityRow {
  id: string;
  action: string;
  createdAt: string;
  actor: { id: string; fullName: string; role: string } | null;
  school: { id: string; name: string } | null;
}

const ROLE_LABELS: Record<string, string> = {
  TEACHER: 'Teacher',
  HEADMASTER: 'Headmaster',
  SCHOOL_ADMIN: 'School admin',
  SYSTEM_ADMIN: 'System admin',
};

function useSchools() {
  return useQuery({
    queryKey: ['admin', 'schools'],
    queryFn: () => api.get<One<SchoolRow[]>>('/admin/schools').then((r) => r.data),
  });
}

function ActivityList({ rows }: { rows: ActivityRow[] }) {
  if (!rows.length) return <EmptyState title="Nothing yet" description="No activity recorded." />;
  return (
    <ul className="divide-y divide-line">
      {rows.map((a) => (
        <li
          key={a.id}
          className="flex flex-wrap items-baseline justify-between gap-x-3 px-4 py-2.5"
        >
          <p className="min-w-0 text-sm">
            <strong className="font-medium">{a.actor?.fullName ?? 'The server'}</strong>{' '}
            {describeAction(a.action)}
          </p>
          <time
            className="text-xs text-muted"
            dateTime={a.createdAt}
            title={formatDateTime(a.createdAt)}
          >
            {relativeTime(a.createdAt)}
          </time>
        </li>
      ))}
    </ul>
  );
}

function Figure({
  label,
  value,
  note,
  to,
}: {
  label: string;
  value: number | string;
  note?: string;
  to?: string;
}) {
  const body = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</p>
      {note && <p className="mt-0.5 text-xs text-muted">{note}</p>}
    </>
  );
  return to ? (
    <Link to={to} className="card block px-4 py-3 hover:border-accent">
      {body}
    </Link>
  ) : (
    <div className="card px-4 py-3">{body}</div>
  );
}

// ---------- Overview ----------

interface Overview {
  date: string;
  schools: number;
  people: {
    headmasters: number;
    schoolAdmins: number;
    teachers: number;
    teachersInvited: number;
    deactivated: number;
  };
  sessions: { signedIn: number; onlineNow: number };
  teaching: {
    lessonsToday: number;
    recordsToday: number;
    recordsThisWeek: number;
    overdue: number;
  };
  emails: Record<string, number>;
  lockedAccounts: { id: string; fullName: string; email: string; school: string | null }[];
  recentActivity: ActivityRow[];
}

export function AdminOverview() {
  const me = useCurrentUser();
  const schools = useSchools();
  const schoolId = schools.data?.[0]?.id;
  const query = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: () => api.get<One<Overview>>('/admin/overview').then((r) => r.data),
    refetchInterval: 60_000,
  });
  return (
    <>
      <PageHeader
        title={me.school.name}
        description="Everything happening in the school. You can see all of it here, but not change anything."
      />
      <QueryView query={query}>
        {(d) => (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Figure
                label="Teachers"
                value={d.people.teachers}
                note={`${d.people.teachersInvited} invited, not signed in yet`}
                to="/a/people?role=TEACHER"
              />
              <Figure
                label="Signed in now"
                value={d.sessions.onlineNow}
                note={`${d.sessions.signedIn} people active in the last 2 hours`}
              />
              <Figure
                label="Headmasters"
                value={d.people.headmasters}
                to="/a/people?role=HEADMASTER"
              />
              <Figure label="Lessons today" value={d.teaching.lessonsToday} />
              <Figure
                label="Records today"
                value={d.teaching.recordsToday}
                note={`${d.teaching.recordsThisWeek} this week`}
                to="/a/activity?action=record."
              />
              <Figure
                label="Lessons not recorded"
                value={d.teaching.overdue}
                note="From earlier school days"
              />
              <Figure
                label="Emails waiting"
                value={d.emails.PENDING ?? 0}
                note={`${d.emails.SENT ?? 0} sent, ${d.emails.FAILED ?? 0} failed`}
              />
            </div>
            {(d.emails.FAILED ?? 0) > 0 && (
              <Alert tone="warn">
                {d.emails.FAILED} invitation or password emails could not be sent. Check the email
                settings (EmailJS) on the server.
              </Alert>
            )}
            {d.lockedAccounts.length > 0 && (
              <Section title="Locked out right now">
                <ul className="divide-y divide-line">
                  {d.lockedAccounts.map((u) => (
                    <li key={u.id} className="px-4 py-2.5 text-sm">
                      <strong className="font-medium">{u.fullName}</strong>{' '}
                      <span className="text-muted">
                        {u.email} · too many wrong passwords; unlocks by itself after a short wait
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            {schoolId && <SchoolBody id={schoolId} />}
          </div>
        )}
      </QueryView>
    </>
  );
}

// ---------- The school ----------

interface SchoolRow {
  id: string;
  name: string;
  createdAt: string;
  headmasters: number;
  teachers: number;
  teachersInvited: number;
  classes: number;
  term: string | null;
  setup: { done: number; total: number; complete: boolean };
  lessonsThisWeek: number;
  recordsThisWeek: number;
  overdue: number;
  lastActivityAt: string | null;
}

interface SchoolDetail {
  school: { id: string; name: string; timezone: string; createdAt: string };
  setup: { steps: { id: string; done: boolean; detail: string }[]; complete: boolean };
  people: {
    id: string;
    fullName: string;
    email: string;
    role: string;
    status: string;
    lastLoginAt: string | null;
    locked: boolean;
  }[];
  teachersBehind: { fullName: string; overdueLessons: number }[];
  recentRecords: {
    id: string;
    teacher: string;
    subject: string;
    className: string;
    weekNumber: number;
    submittedAt: string;
    isLate: boolean;
    summary: string;
  }[];
  recentActivity: ActivityRow[];
}

const STEP_TITLES: Record<string, string> = {
  term: 'Term dates',
  weeks: 'Week dates',
  classes: 'Classes',
  scheme: 'Scheme of learning',
  teachers: 'Teachers',
  subjects: "Teachers' subjects",
  timetable: 'Timetable',
  publish: 'Lessons created',
  start: 'Recording start',
};

/** The school's records, people, setup, teachers behind and activity. */
function SchoolBody({ id }: { id: string }) {
  const query = useQuery({
    queryKey: ['admin', 'school', id],
    queryFn: () => api.get<One<SchoolDetail>>(`/admin/schools/${id}`).then((r) => r.data),
    refetchInterval: 60_000,
  });
  return (
    <QueryView query={query}>
      {(d) => (
        <>
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="space-y-5 lg:col-span-2">
              <Section title="Lesson records">
                {d.recentRecords.length ? (
                  <ul className="divide-y divide-line">
                    {d.recentRecords.map((r) => (
                      <li key={r.id} className="px-4 py-2.5 text-sm">
                        <p>
                          <strong className="font-medium">{r.teacher}</strong> · {r.subject},{' '}
                          {r.className} · week {r.weekNumber}
                          {r.isLate && (
                            <span className="ml-1.5 align-middle">
                              <Badge tone="warn">Late</Badge>
                            </span>
                          )}
                        </p>
                        <p className="line-clamp-2 text-muted">{r.summary}</p>
                        <p className="text-xs text-muted">{formatDateTime(r.submittedAt)}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState
                    title="No records yet"
                    description="Teachers have not submitted any."
                  />
                )}
              </Section>
              <Section title="People">
                <DataTable
                  rows={d.people}
                  rowKey={(p) => p.id}
                  columns={[
                    {
                      key: 'name',
                      header: 'Name',
                      render: (p) => (
                        <>
                          <span className="font-medium">{p.fullName}</span>
                          <span className="block text-xs text-muted">{p.email}</span>
                        </>
                      ),
                    },
                    { key: 'role', header: 'Role', render: (p) => ROLE_LABELS[p.role] ?? p.role },
                    {
                      key: 'status',
                      header: 'Status',
                      render: (p) =>
                        p.locked ? (
                          <Badge tone="bad">Locked out</Badge>
                        ) : (
                          <StatusBadge status={p.status} />
                        ),
                    },
                    {
                      key: 'login',
                      header: 'Last signed in',
                      render: (p) => (p.lastLoginAt ? relativeTime(p.lastLoginAt) : 'Never'),
                    },
                  ]}
                />
              </Section>
            </div>
            <div className="space-y-5">
              <Section title="Setup">
                <ul className="divide-y divide-line">
                  {d.setup.steps.map((s) => (
                    <li key={s.id} className="px-4 py-2 text-sm">
                      <span className={s.done ? 'text-ok' : 'text-warn'}>{s.done ? '✓' : '○'}</span>{' '}
                      <span className="font-medium">{STEP_TITLES[s.id] ?? s.id}</span>
                      <span className="block pl-4 text-xs text-muted">{s.detail}</span>
                    </li>
                  ))}
                </ul>
              </Section>
              <Section title="Teachers behind">
                {d.teachersBehind.length ? (
                  <ul className="divide-y divide-line">
                    {d.teachersBehind.map((t) => (
                      <li key={t.fullName} className="flex justify-between gap-2 px-4 py-2 text-sm">
                        <span>{t.fullName}</span>
                        <span className="tabular-nums text-warn">
                          {t.overdueLessons} not recorded
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-4 py-3 text-sm text-muted">Everyone is up to date.</p>
                )}
              </Section>
              <Section
                title="Activity"
                actions={
                  <Link to="/a/activity" className="link text-sm">
                    See all
                  </Link>
                }
              >
                <ActivityList rows={d.recentActivity} />
              </Section>
            </div>
          </div>
        </>
      )}
    </QueryView>
  );
}

// ---------- People ----------

interface PersonRow {
  id: string;
  fullName: string;
  email: string;
  role: string;
  status: string;
  lastLoginAt: string | null;
  locked: boolean;
  school: { id: string; name: string } | null;
}

export function AdminPeople() {
  const { values, set } = useUrlState(['search', 'role', 'status'] as const);
  const page = Number(values.page) || 1;
  const setPage = (p: number) => set({ page: String(p) });
  const query = useQuery({
    queryKey: ['admin', 'users', values, page],
    queryFn: () => api.get<Page<PersonRow>>('/admin/users', { ...values, pageSize: 25 }),
    placeholderData: keepPreviousData,
  });
  // A new filter starts again from the first page.
  const filter = (patch: Partial<typeof values>) => set({ ...patch, page: '1' });
  return (
    <>
      <PageHeader
        title="People"
        description="Everyone with an account: headmaster, staff and teachers."
      />
      <Section>
        <FilterBar>
          <SearchInput
            value={values.search}
            onChange={(v) => filter({ search: v })}
            placeholder="Name or email"
          />
          <FilterSelect
            label="Role"
            value={values.role}
            onChange={(v) => filter({ role: v })}
            options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] ?? r }))}
          />
          <FilterSelect
            label="Status"
            value={values.status}
            onChange={(v) => filter({ status: v })}
            options={USER_STATUSES.map((s) => ({
              value: s,
              label:
                s === 'PENDING_ACTIVATION' ? 'Invited' : s === 'ACTIVE' ? 'Active' : 'Deactivated',
            }))}
          />
        </FilterBar>
        <QueryView query={query}>
          {(res) =>
            res.data.length ? (
              <>
                <DataTable
                  rows={res.data}
                  rowKey={(p) => p.id}
                  columns={[
                    {
                      key: 'name',
                      header: 'Name',
                      render: (p) => (
                        <>
                          <span className="font-medium">{p.fullName}</span>
                          <span className="block text-xs text-muted">{p.email}</span>
                        </>
                      ),
                    },
                    { key: 'role', header: 'Role', render: (p) => ROLE_LABELS[p.role] ?? p.role },
                    {
                      key: 'status',
                      header: 'Status',
                      render: (p) =>
                        p.locked ? (
                          <Badge tone="bad">Locked out</Badge>
                        ) : (
                          <StatusBadge status={p.status} />
                        ),
                    },
                    {
                      key: 'login',
                      header: 'Last signed in',
                      render: (p) => (p.lastLoginAt ? relativeTime(p.lastLoginAt) : 'Never'),
                    },
                  ]}
                />
                <Pagination meta={res.meta} onPage={setPage} />
              </>
            ) : (
              <EmptyState title="Nobody matches" description="Try other filters." />
            )
          }
        </QueryView>
      </Section>
    </>
  );
}

// ---------- Activity ----------

export function AdminActivity() {
  const { values, set } = useUrlState(['action'] as const);
  const page = Number(values.page) || 1;
  const setPage = (p: number) => set({ page: String(p) });
  const query = useQuery({
    queryKey: ['admin', 'activity', values, page],
    queryFn: () => api.get<Page<ActivityRow>>('/admin/activity', { ...values, pageSize: 30 }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  // A new filter starts again from the first page.
  const filter = (patch: Partial<typeof values>) => set({ ...patch, page: '1' });
  return (
    <>
      <PageHeader
        title="Activity"
        description="Everything people have done in the system, newest first. This history cannot be changed or deleted."
      />
      <Section>
        <FilterBar>
          <FilterSelect
            label="What"
            value={values.action}
            onChange={(v) => filter({ action: v })}
            options={ACTION_GROUPS}
          />
        </FilterBar>
        <QueryView query={query}>
          {(res) => (
            <>
              <ActivityList rows={res.data} />
              <Pagination meta={res.meta} onPage={setPage} />
            </>
          )}
        </QueryView>
      </Section>
    </>
  );
}
