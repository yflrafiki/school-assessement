import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route } from 'react-router-dom';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssignmentsPage } from '../features/headmaster/AssignmentsPage';
import { makeMe, mockApi, renderAt } from './render';

afterEach(() => vi.unstubAllGlobals());

const term = {
  id: 't1',
  academicYearId: 'y1',
  academicYearName: '2026/2027',
  number: 1,
  name: 'First Term',
  startDate: '2026-09-07',
  endDate: '2026-12-11',
  isCurrent: true,
  weekCount: 14,
};

describe('assigning a teacher before any class exists', () => {
  it('explains why the class list is empty and adds a class per level in one click', async () => {
    const classes: { id: string; level: string; name: string; isActive: boolean }[] = [];
    const calls = mockApi((method, path, body) => {
      if (path === '/terms') return { status: 200, body: { data: [term] } };
      if (path === '/subjects') return { status: 200, body: { data: [] } };
      if (path.startsWith('/teachers'))
        return { status: 200, body: { data: [], meta: { page: 1, pageSize: 100, total: 0 } } };
      if (path.startsWith('/assignments')) return { status: 200, body: { data: [] } };
      if (path === '/classes' && method === 'GET') return { status: 200, body: { data: classes } };
      if (path === '/classes' && method === 'POST') {
        const c = { id: `c${classes.length}`, isActive: true, ...(body as object) } as never;
        classes.push(c);
        return { status: 201, body: { data: c } };
      }
      return undefined;
    });
    renderAt(
      '/h/assignments',
      <Route path="/h/assignments" element={<AssignmentsPage />} />,
      makeMe('HEADMASTER'),
    );
    expect(await screen.findByText(/No classes yet/)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Add one class per level (B7, B8, B9)' }),
    );
    await waitFor(() => expect(screen.queryByText(/No classes yet/)).toBeNull());
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([
      { level: 'BASIC_7', name: 'B7' },
      { level: 'BASIC_8', name: 'B8' },
      { level: 'BASIC_9', name: 'B9' },
    ]);
    expect(screen.getAllByRole('option', { name: 'B7 (Basic 7)' }).length).toBeGreaterThan(0);
  });
});
