import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route } from 'react-router-dom';
import { screen } from '@testing-library/react';
import { AppShell } from '../app/AppShell';
import { homeFor } from '../app/guards';
import { AdminOverview } from '../features/admin/AdminPages';
import { makeMe, mockApi, renderAt } from './render';

afterEach(() => vi.unstubAllGlobals());

const overview = {
  date: '2026-11-07',
  schools: 2,
  people: { headmasters: 2, schoolAdmins: 0, teachers: 11, teachersInvited: 1, deactivated: 0 },
  sessions: { signedIn: 6, onlineNow: 3 },
  teaching: { lessonsToday: 40, recordsToday: 12, recordsThisWeek: 50, overdue: 4 },
  emails: { SENT: 14, FAILED: 1 },
  lockedAccounts: [
    { id: 'u9', fullName: 'Yaw Mensah', email: 'yaw@ipel.example', school: 'Ipel International' },
  ],
  recentActivity: [
    {
      id: 'a1',
      action: 'record.submitted',
      createdAt: new Date().toISOString(),
      actor: { id: 'u1', fullName: 'Kofi Boateng', role: 'TEACHER' },
      school: { id: 's1', name: 'Ipel International' },
    },
  ],
};

const school = {
  school: {
    id: 's1',
    name: 'Ipel International',
    timezone: 'Africa/Accra',
    createdAt: '2026-10-28',
  },
  setup: { steps: [{ id: 'term', done: true, detail: 'First Term' }], complete: false },
  people: [],
  teachersBehind: [{ fullName: 'Ama Owusu', overdueLessons: 3 }],
  recentRecords: [],
  recentActivity: overview.recentActivity,
};

describe('system admin', () => {
  it('lands on its own area', () => {
    expect(homeFor('SYSTEM_ADMIN')).toBe('/a');
  });

  it('sees the whole system at a glance, in plain words, with no notification bell', async () => {
    const me = {
      ...makeMe('HEADMASTER'),
      role: 'SYSTEM_ADMIN' as const,
      permissions: ['system.view' as const],
    };
    const calls = mockApi((_m, path) =>
      path === '/admin/overview'
        ? { status: 200, body: { data: overview } }
        : path === '/admin/schools'
          ? { status: 200, body: { data: [{ id: 's1', name: 'Ipel International' }] } }
          : path === '/admin/schools/s1'
            ? { status: 200, body: { data: school } }
            : undefined,
    );
    renderAt(
      '/a',
      <Route path="/a" element={<AppShell area="admin" />}>
        <Route index element={<AdminOverview />} />
      </Route>,
      me,
    );
    expect(await screen.findByRole('heading', { name: 'Test JHS' })).toBeInTheDocument();
    expect(await screen.findByText('6 people active in the last 2 hours')).toBeInTheDocument();
    expect(await screen.findByText(/submitted a lesson record/)).toHaveTextContent(
      'Kofi Boateng submitted a lesson record',
    );
    expect(
      screen.getByText(/1 invitation or password emails could not be sent/),
    ).toBeInTheDocument();
    expect(screen.getByText('Yaw Mensah')).toBeInTheDocument();
    expect(screen.getByText('3 not recorded')).toBeInTheDocument();
    expect(screen.getAllByText('System admin').length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: /Notifications/ })).toBeNull();
    // Only the admin's own data is asked for: no notification stream or school pages.
    expect(calls.every((c) => c.path.startsWith('/admin/'))).toBe(true);
  });
});
