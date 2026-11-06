import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route } from 'react-router-dom';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPage } from '../features/headmaster/SettingsPage';
import { makeMe, mockApi, renderAt } from './render';

afterEach(() => vi.unstubAllGlobals());

const term = {
  id: 't1',
  academicYearId: 'y1',
  academicYearName: '2026/2027',
  number: 1,
  name: 'First Term',
  // A Wednesday start, and a last day before 14 weeks are up.
  startDate: '2026-09-09',
  endDate: '2026-12-02',
  isCurrent: true,
  weekCount: 0,
};

describe('filling the term weeks', () => {
  it('keeps every week inside the term and says when fewer weeks fit', async () => {
    mockApi((_m, path) => {
      if (path === '/terms') return { status: 200, body: { data: [term] } };
      if (path === '/terms/t1/weeks') return { status: 200, body: { data: [] } };
      return undefined;
    });
    renderAt(
      '/h/settings?tab=weeks',
      <Route path="/h/settings" element={<SettingsPage />} />,
      makeMe('HEADMASTER'),
    );
    expect(await screen.findByText(/runs from/)).toHaveTextContent(/First Term runs from/);
    await userEvent.click(screen.getByRole('button', { name: 'Fill weekly from term start' }));

    // Week 1 starts on the term's first day, a Wednesday, and ends that Friday.
    expect(screen.getByLabelText('Week 1 start')).toHaveValue('2026-09-09');
    expect(screen.getByLabelText('Week 1 end')).toHaveValue('2026-09-11');
    expect(screen.getByLabelText('Week 2 start')).toHaveValue('2026-09-14');
    // The last week stops on the term's last day.
    expect(screen.getByLabelText('Week 13 start')).toHaveValue('2026-11-30');
    expect(screen.getByLabelText('Week 13 end')).toHaveValue('2026-12-02');
    expect(screen.queryByLabelText('Week 14 start')).toBeNull();
    expect(screen.getByText(/Only 13 weeks fit/)).toBeInTheDocument();
  });
});
