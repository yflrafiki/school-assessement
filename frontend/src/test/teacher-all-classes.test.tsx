import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route } from 'react-router-dom';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TeachersPage } from '../features/headmaster/TeachersPage';
import { TimetablePage } from '../features/headmaster/TimetablePage';
import { makeMe, mockApi, renderAt } from './render';

afterEach(() => vi.unstubAllGlobals());

const term = {
  id: 't1',
  academicYearId: 'y1',
  academicYearName: '2026/2027',
  number: 1,
  name: 'First Term',
  startDate: '2099-09-07',
  endDate: '2099-12-11',
  isCurrent: true,
  weekCount: 14,
};
const classes = [
  { id: 'c1', level: 'BASIC_7', name: 'FORM 1', isActive: true },
  { id: 'c2', level: 'BASIC_8', name: 'FORM 2', isActive: true },
  { id: 'c3', level: 'BASIC_9', name: 'FORM 3', isActive: true },
  { id: 'c4', level: 'BASIC_7', name: 'B7A', isActive: false },
];

describe('adding a teacher who teaches every form', () => {
  it('fills in the subject for every active class in one click', async () => {
    mockApi((_m, path) => {
      if (path === '/terms') return { status: 200, body: { data: [term] } };
      if (path === '/classes') return { status: 200, body: { data: classes } };
      if (path === '/subjects')
        return {
          status: 200,
          body: {
            data: [
              {
                id: 's1',
                name: 'Mathematics',
                code: 'MATH',
                isNational: true,
                isFramework: false,
                parentSubjectId: null,
                isActive: true,
                assignable: true,
              },
            ],
          },
        };
      if (path.startsWith('/teachers'))
        return { status: 200, body: { data: [], meta: { page: 1, pageSize: 20, total: 0 } } };
      return undefined;
    });
    renderAt(
      '/h/teachers',
      <Route path="/h/teachers" element={<TeachersPage />} />,
      makeMe('HEADMASTER'),
    );
    await userEvent.click((await screen.findAllByRole('button', { name: /Add teacher/ }))[0]!);
    const drawer = await screen.findByRole('dialog');
    await userEvent.click(within(drawer).getByRole('button', { name: /Add subject and class/ }));
    await userEvent.selectOptions(within(drawer).getByLabelText('Subject'), 's1');
    await userEvent.click(within(drawer).getByRole('button', { name: 'All classes' }));

    const subjects = within(drawer).getAllByLabelText('Subject');
    const forms = within(drawer).getAllByLabelText('Class');
    expect(subjects.map((s) => (s as HTMLSelectElement).value)).toEqual(['s1', 's1', 's1']);
    expect(forms.map((s) => (s as HTMLSelectElement).value)).toEqual(['c1', 'c2', 'c3']);
  });
});

describe('a timetable waiting for teachers', () => {
  it('says once, by class, which subjects still need a teacher', async () => {
    mockApi((method, path, body) => {
      if (path === '/terms') return { status: 200, body: { data: [term] } };
      if (path === '/classes') return { status: 200, body: { data: classes } };
      if (path.startsWith('/timetable-entries')) return { status: 200, body: { data: [] } };
      if (path.startsWith('/assignments')) return { status: 200, body: { data: [] } };
      if (method === 'POST' && path === '/timetable/import') {
        const rows = (body as { rows: { className: string; subject: string }[] }).rows;
        return {
          status: 200,
          body: {
            data: {
              rows: rows.map((r, i) => ({
                ...r,
                row: i + 1,
                error: `No teacher is assigned to "${r.subject}" for ${r.className}. Assign one under Subjects and classes, or correct the subject.`,
              })),
              created: 0,
              replaced: 0,
              saved: false,
            },
          },
        };
      }
      return undefined;
    });
    renderAt(
      '/h/timetable',
      <Route path="/h/timetable" element={<TimetablePage />} />,
      makeMe('HEADMASTER'),
    );
    await screen.findByRole('button', { name: /Choose the timetable file/ });
    const file = new File(
      ['Class,Day,8:00-9:10,9:40-11:30\nFORM 1,Mon,Maths,Social\nFORM 2,Mon,Science,\n'],
      'timetable.csv',
      { type: 'text/csv' },
    );
    await userEvent.upload(document.querySelector('input[type="file"]') as HTMLInputElement, file);
    await userEvent.click(await screen.findByRole('button', { name: 'Check' }));

    expect(await screen.findByText(/All of these rows are/)).toBeInTheDocument();
    expect(screen.getByText('FORM 1').closest('li')).toHaveTextContent('FORM 1: Maths, Social');
    expect(screen.getByText('FORM 2').closest('li')).toHaveTextContent('FORM 2: Science');
    expect(screen.getByRole('link', { name: 'Teachers' })).toHaveAttribute('href', '/h/teachers');
  });
});
