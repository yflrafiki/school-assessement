import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route } from 'react-router-dom';
import { screen } from '@testing-library/react';
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

function api(terms: unknown[]) {
  return mockApi((_m, path) => {
    if (path === '/terms') return { status: 200, body: { data: terms } };
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
    expect(screen.getByRole('combobox')).toHaveDisplayValue(/First Term 2026\/2027 \(current\)/);
    expect(document.querySelector('input[type="file"]')).toHaveAttribute(
      'accept',
      'application/pdf,.pdf',
    );
  });
});
