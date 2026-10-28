import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route } from 'react-router-dom';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CurriculumPage } from '../features/headmaster/CurriculumPage';
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

const entry = {
  id: 'e1',
  level: 'BASIC_7',
  subjectId: 'sub-math',
  weekNumber: 1,
  strand: 'Number',
  subStrand: 'Number and numeration systems',
  contentStandard: 'B7.1.1.1 Demonstrate understanding',
  indicator: 'B7.1.1.1.1 Model number quantities .......',
  isTruncated: true,
  sourcePage: 8,
};

function api(terms: unknown[]) {
  return mockApi((method, path) => {
    if (path === '/terms') return { status: 200, body: { data: terms } };
    if (path === '/subjects')
      return {
        status: 200,
        body: {
          data: [
            {
              id: 'sub-math',
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
    if (path.startsWith('/curriculum?'))
      return {
        status: 200,
        body: { data: { scheme: { title: 'v1' }, weeks: [], entries: [entry] } },
      };
    if (method === 'DELETE' && path === '/curriculum/entries/e1') return { status: 204 };
    if (method === 'PATCH' && path === '/curriculum/entries/e1')
      return { status: 200, body: { data: entry } };
    if (path === '/curriculum/schemes') return { status: 200, body: { data: [] } };
    if (path === '/curriculum/imports') return { status: 200, body: { data: [] } };
    return undefined;
  });
}

describe('scheme of learning upload', () => {
  it('explains that a term is needed first and links to Settings', async () => {
    api([]);
    renderAt(
      '/h/curriculum',
      <Route path="/h/curriculum" element={<CurriculumPage />} />,
      makeMe('HEADMASTER'),
    );
    expect(await screen.findByText(/No term has been set up yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Settings → Years and terms/ })).toHaveAttribute(
      'href',
      '/h/settings?tab=terms',
    );
    expect(screen.queryByRole('button', { name: /Choose the PDF/ })).toBeNull();
  });

  it('offers the PDF upload for the current term once a term exists', async () => {
    api([term]);
    renderAt(
      '/h/curriculum',
      <Route path="/h/curriculum" element={<CurriculumPage />} />,
      makeMe('HEADMASTER'),
    );
    const button = await screen.findByRole('button', { name: /Choose the PDF and upload/ });
    expect(button).toBeEnabled();
    expect(screen.getByRole('combobox', { name: 'Term' })).toHaveDisplayValue(
      /First Term 2026\/2027 \(current\)/,
    );
    expect(document.querySelector('input[type="file"]')).toHaveAttribute(
      'accept',
      'application/pdf,.pdf',
    );
  });

  it('lists the live topics and lets the headmaster correct one', async () => {
    const calls = api([term]);
    renderAt(
      '/h/curriculum',
      <Route path="/h/curriculum" element={<CurriculumPage />} />,
      makeMe('HEADMASTER'),
    );
    expect(await screen.findByText(/Model number quantities/)).toBeInTheDocument();
    expect(screen.getByText(/Mathematics · Basic 7 · Week 1/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const indicator = await screen.findByLabelText('Indicator');
    await userEvent.clear(indicator);
    await userEvent.type(indicator, 'B7.1.1.1.1 Model number quantities up to 1,000,000');
    await userEvent.click(screen.getByRole('button', { name: 'Save topic' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        indicator: 'B7.1.1.1.1 Model number quantities up to 1,000,000',
      }),
    );
  });

  it('deletes a topic after confirmation', async () => {
    const calls = api([term]);
    renderAt(
      '/h/curriculum',
      <Route path="/h/curriculum" element={<CurriculumPage />} />,
      makeMe('HEADMASTER'),
    );
    await screen.findByText(/Model number quantities/);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Delete this topic?')).toBeInTheDocument();
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.path === '/curriculum/entries/e1')).toBe(
        true,
      ),
    );
  });

  it('hides editing and deleting from a school admin', async () => {
    api([term]);
    renderAt(
      '/h/curriculum',
      <Route path="/h/curriculum" element={<CurriculumPage />} />,
      makeMe('SCHOOL_ADMIN'),
    );
    await screen.findByText(/Model number quantities/);
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });
});
