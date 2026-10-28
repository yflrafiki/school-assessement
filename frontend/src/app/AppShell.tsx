import { useCallback, useState, type ComponentType } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  FiActivity,
  FiBarChart2,
  FiBell,
  FiBookOpen,
  FiCalendar,
  FiClipboard,
  FiGrid,
  FiHome,
  FiLayers,
  FiLogOut,
  FiMenu,
  FiSettings,
  FiTrendingUp,
  FiUser,
  FiUsers,
  FiX,
} from 'react-icons/fi';
import type { Permission } from '@school/shared';
import { api, setSessionToken } from '../lib/api';
import { useCurrentUser } from '../features/auth/useMe';
import { NotificationBell } from '../features/notifications/NotificationBell';
import { LiveToast } from '../features/notifications/LiveToast';
import {
  useLiveNotifications,
  type LiveNotification,
} from '../features/notifications/useLiveNotifications';

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Shown only when the user has this permission (from the API's permission list). */
  permission?: Permission;
  end?: boolean;
  /** Included in the mobile bottom bar. */
  primary?: boolean;
}

const TEACHER_NAV: NavItem[] = [
  { to: '/t', label: 'Overview', icon: FiHome, end: true, primary: true },
  { to: '/t/subjects', label: 'My subjects and classes', icon: FiLayers },
  { to: '/t/scheme', label: 'Weekly scheme of work', icon: FiBookOpen, primary: true },
  { to: '/t/records', label: 'Teaching records', icon: FiClipboard, primary: true },
  { to: '/t/progress', label: 'Weekly progress', icon: FiTrendingUp },
  { to: '/t/notifications', label: 'Notifications', icon: FiBell },
  { to: '/t/profile', label: 'Profile', icon: FiUser },
];

const HEADMASTER_NAV: NavItem[] = [
  {
    to: '/h',
    label: 'Overview',
    icon: FiHome,
    end: true,
    permission: 'reports.view',
    primary: true,
  },
  {
    to: '/h/daily',
    label: 'Daily lessons',
    icon: FiCalendar,
    permission: 'lessons.manage',
    primary: true,
  },
  {
    to: '/h/activity',
    label: 'Teaching activity',
    icon: FiActivity,
    permission: 'records.view_all',
    primary: true,
  },
  {
    to: '/h/teachers',
    label: 'Teachers',
    icon: FiUsers,
    permission: 'teachers.manage',
    primary: true,
  },
  {
    to: '/h/assignments',
    label: 'Subjects and classes',
    icon: FiLayers,
    permission: 'school.setup',
  },
  { to: '/h/timetable', label: 'Timetable', icon: FiGrid, permission: 'timetable.manage' },
  { to: '/h/progress', label: 'Weekly progress', icon: FiTrendingUp, permission: 'reports.view' },
  { to: '/h/curriculum', label: 'Curriculum', icon: FiBookOpen, permission: 'curriculum.import' },
  { to: '/h/reports', label: 'Reports', icon: FiBarChart2, permission: 'reports.view' },
  { to: '/h/notifications', label: 'Notifications', icon: FiBell },
  { to: '/h/settings', label: 'Settings', icon: FiSettings, permission: 'school.setup' },
  { to: '/h/profile', label: 'Profile', icon: FiUser },
];

export function AppShell({ area }: { area: 'teacher' | 'headmaster' }) {
  const me = useCurrentUser();
  const location = useLocation();
  // The drawer belongs to the page it was opened on, so navigating closes it.
  const [drawerPath, setDrawerPath] = useState<string | null>(null);
  const drawerOpen = drawerPath === location.pathname;
  const setDrawerOpen = (open: boolean) => setDrawerPath(open ? location.pathname : null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const items = (area === 'teacher' ? TEACHER_NAV : HEADMASTER_NAV).filter(
    (i) => !i.permission || me.permissions.includes(i.permission),
  );
  const base = area === 'teacher' ? '/t' : '/h';

  // New notifications arrive the moment they happen; show each one briefly.
  const [toast, setToast] = useState<LiveNotification | null>(null);
  const closeToast = useCallback(() => setToast(null), []);
  const { connected } = useLiveNotifications(setToast);
  const toastHref = toast?.recordId
    ? area === 'headmaster'
      ? `/h/activity?record=${toast.recordId}`
      : `/t/records/${toast.recordId}`
    : null;

  async function signOut() {
    try {
      await api.post('/auth/logout');
    } finally {
      setSessionToken(null);
      qc.clear();
      navigate('/login', { replace: true });
    }
  }

  const nav = (
    <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end ?? false}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-md px-3 py-2 text-sm ${isActive ? 'bg-nav-active font-medium text-white' : 'text-nav-text hover:bg-nav-hover hover:text-white'}`
          }
        >
          <item.icon className="h-4 w-4 shrink-0" aria-hidden />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );

  const brand = (
    <div className="border-b border-white/10 px-4 py-4">
      <p className="text-sm font-semibold text-white">Teaching Monitor</p>
      <p className="truncate text-xs text-nav-text" title={me.school.name}>
        {me.school.name}
      </p>
    </div>
  );

  const footer = (
    <div className="border-t border-white/10 p-3">
      <p className="truncate px-1 text-sm text-white">{me.fullName}</p>
      <p className="truncate px-1 text-xs text-nav-text">
        {me.role === 'SCHOOL_ADMIN'
          ? 'School admin'
          : me.role === 'HEADMASTER'
            ? 'Headmaster'
            : 'Teacher'}
      </p>
      <button
        type="button"
        onClick={signOut}
        className="mt-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-nav-text hover:bg-nav-hover hover:text-white"
      >
        <FiLogOut className="h-4 w-4" aria-hidden /> Sign out
      </button>
    </div>
  );

  return (
    <div className="min-h-screen lg:pl-64">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col bg-nav lg:flex">
        {brand}
        {nav}
        {footer}
      </aside>

      {/* Tablet and mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-nav/50"
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-nav shadow-2xl">
            <div className="flex items-start justify-between">
              {brand}
              <button
                type="button"
                className="m-3 rounded p-1 text-nav-text hover:text-white"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close menu"
              >
                <FiX className="h-5 w-5" aria-hidden />
              </button>
            </div>
            {nav}
            {footer}
          </aside>
        </div>
      )}

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-line bg-surface px-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-ghost px-2 lg:hidden"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
          >
            <FiMenu className="h-5 w-5" aria-hidden />
          </button>
          <span className="truncate text-sm text-muted lg:hidden">{me.school.name}</span>
        </div>
        <NotificationBell to={`${base}/notifications`} live={connected} />
      </header>

      <main id="main" className="mx-auto max-w-7xl px-4 py-6 pb-24 sm:px-6 lg:pb-8">
        <Outlet />
      </main>

      <LiveToast notification={toast} href={toastHref} onClose={closeToast} />

      {/* Mobile bottom bar */}
      <nav
        aria-label="Quick"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-surface md:hidden"
      >
        {items
          .filter((i) => i.primary)
          .slice(0, 4)
          .map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end ?? false}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 py-2 text-[11px] ${isActive ? 'text-accent' : 'text-muted'}`
              }
            >
              <item.icon className="h-5 w-5" aria-hidden />
              <span className="max-w-full truncate px-1">{item.label.split(' ')[0]}</span>
            </NavLink>
          ))}
      </nav>
    </div>
  );
}

export function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-lg font-semibold text-ink">Teaching Monitor</p>
          <p className="text-sm text-muted">Weekly teaching records for Junior High Schools</p>
        </div>
        <div className="card p-6">{children}</div>
      </div>
    </div>
  );
}
