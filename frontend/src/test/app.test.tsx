import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route } from 'react-router-dom';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginPage } from '../features/auth/AuthPages';
import { AppShell } from '../app/AppShell';
import { RequireAuth } from '../app/guards';
import { RecordLessonPage } from '../features/teacher/RecordLessonPage';
import { makeMe, mockApi, renderAt } from './render';

afterEach(() => vi.unstubAllGlobals());

describe('login', () => {
  it('validates fields before calling the server', async () => {
    const calls = mockApi(() => undefined);
    renderAt('/login', <Route path="/login" element={<LoginPage />} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your password')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('shows the server message on wrong credentials', async () => {
    mockApi((method, path) => {
      if (method === 'POST' && path === '/auth/login') {
        return {
          status: 401,
          body: {
            error: { code: 'UNAUTHENTICATED', message: 'The email or password is incorrect' },
          },
        };
      }
      return undefined;
    });
    renderAt('/login', <Route path="/login" element={<LoginPage />} />);
    await userEvent.type(screen.getByLabelText('Email'), 'kofi@test.example');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The email or password is incorrect',
    );
  });
});

describe('role-based navigation', () => {
  const shell = (area: 'teacher' | 'headmaster') => (
    <Route
      path={area === 'teacher' ? '/t' : '/h'}
      element={
        <RequireAuth roles={area === 'teacher' ? ['TEACHER'] : ['HEADMASTER', 'SCHOOL_ADMIN']}>
          <AppShell area={area} />
        </RequireAuth>
      }
    />
  );

  it('never renders headmaster items for a teacher', async () => {
    mockApi((_m, path) =>
      path === '/notifications/unread-count'
        ? { status: 200, body: { data: { count: 2 } } }
        : undefined,
    );
    renderAt('/t', shell('teacher'), makeMe('TEACHER'));
    const nav = await screen.findAllByRole('navigation', { name: 'Main' });
    expect(nav[0]).toHaveTextContent('Weekly scheme of work');
    expect(nav[0]).not.toHaveTextContent('Teachers');
    expect(nav[0]).not.toHaveTextContent('Settings');
    expect(
      await screen.findByRole('link', { name: 'Notifications, 2 unread' }),
    ).toBeInTheDocument();
  });

  it('shows a school admin only the pages their permissions allow', async () => {
    mockApi((_m, path) =>
      path === '/notifications/unread-count'
        ? { status: 200, body: { data: { count: 0 } } }
        : undefined,
    );
    renderAt('/h', shell('headmaster'), makeMe('SCHOOL_ADMIN'));
    const nav = (await screen.findAllByRole('navigation', { name: 'Main' }))[0]!;
    expect(nav).toHaveTextContent('Teachers');
    expect(nav).toHaveTextContent('Curriculum');
    expect(nav).not.toHaveTextContent('Timetable');
    expect(nav).not.toHaveTextContent('Daily lessons');
  });

  it('sends a teacher away from the headmaster area', async () => {
    mockApi(() => undefined);
    renderAt(
      '/h',
      <>
        {shell('headmaster')}
        <Route path="/t" element={<p>Teacher home</p>} />
      </>,
      makeMe('TEACHER'),
    );
    expect(await screen.findByText('Teacher home')).toBeInTheDocument();
  });
});

describe('record form', () => {
  const lesson = {
    id: 'l2',
    date: '2026-09-21',
    startTime: '08:00',
    endTime: '09:00',
    status: 'SCHEDULED',
    state: 'OVERDUE',
    cancelReason: null,
    reason: null,
    weekNumber: 2,
    rescheduledFromId: null,
    assignment: {
      id: 'a1',
      subject: { id: 'm', name: 'Mathematics' },
      schoolClass: { id: 'c', name: 'B7A', level: 'BASIC_7' },
      teacher: { id: 't1', fullName: 'Kofi Boateng' },
    },
    record: null,
  };
  const entry = {
    id: 'e1',
    weekNumber: 2,
    strand: 'Number',
    subStrand: 'Place value',
    contentStandard: 'B7.1.1.2',
    indicator: 'Model numbers .......',
    isTruncated: true,
  };

  it('explains a locked week and links to the outstanding lessons', async () => {
    const calls = mockApi((method, path) => {
      if (path === '/lessons/l2') return { status: 200, body: { data: lesson } };
      if (path.startsWith('/curriculum/topics'))
        return {
          status: 200,
          body: { data: { weekNumber: 2, kind: 'TEACHING', entries: [entry] } },
        };
      if (path.startsWith('/teaching-records/by-lesson'))
        return { status: 200, body: { data: null } };
      if (method === 'POST' && path === '/teaching-records') {
        return {
          status: 409,
          body: {
            error: {
              code: 'WEEK_LOCKED',
              message:
                'Week 2 is locked. Record the outstanding lessons of week 1 first, or ask the headmaster for an exception.',
              details: {
                requestedWeek: 2,
                blockingWeek: 1,
                outstandingLessons: [{ id: 'l1', date: '2026-09-14', startTime: '08:00' }],
              },
            },
          },
        };
      }
      return undefined;
    });
    renderAt(
      '/t/lessons/l2/record',
      <Route path="/t/lessons/:lessonId/record" element={<RecordLessonPage />} />,
      makeMe('TEACHER'),
    );

    expect(await screen.findByText('Cut off in source')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.type(
      screen.getByLabelText(/What was taught/),
      'Place value with base ten blocks.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Submit record' }));

    expect(await screen.findByText(/Week 2 is locked/)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /14 Sept 2026 at 08:00|14 Sep 2026 at 08:00/ }),
    ).toHaveAttribute('href', '/t/lessons/l1/record');
    const submit = calls.find((c) => c.method === 'POST');
    expect(submit?.body).toMatchObject({ lessonId: 'l2', entryIds: ['e1'], status: 'SUBMITTED' });
  });

  it('requires a summary before submitting', async () => {
    const calls = mockApi((_m, path) => {
      if (path === '/lessons/l2') return { status: 200, body: { data: lesson } };
      if (path.startsWith('/curriculum/topics'))
        return {
          status: 200,
          body: { data: { weekNumber: 2, kind: 'TEACHING', entries: [entry] } },
        };
      if (path.startsWith('/teaching-records/by-lesson'))
        return { status: 200, body: { data: null } };
      return undefined;
    });
    renderAt(
      '/t/lessons/l2/record',
      <Route path="/t/lessons/:lessonId/record" element={<RecordLessonPage />} />,
      makeMe('TEACHER'),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Submit record' }));
    expect(await screen.findByText(/at least 10 characters/)).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(false));
  });
});
