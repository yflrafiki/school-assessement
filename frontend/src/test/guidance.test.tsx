import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route } from 'react-router-dom';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SetupGuide } from '../features/headmaster/SetupGuide';
import { HelpPage } from '../features/help/HelpPage';
import { makeMe, mockApi, renderAt } from './render';

afterEach(() => vi.unstubAllGlobals());

const steps = (doneUpTo: number) =>
  [
    'term',
    'weeks',
    'classes',
    'scheme',
    'teachers',
    'subjects',
    'timetable',
    'publish',
    'start',
  ].map((id, i) => ({ id, done: i < doneUpTo, detail: `detail of ${id}` }));

describe('setup checklist', () => {
  it('ticks done steps and points to the next one', async () => {
    mockApi((_m, path) =>
      path === '/setup-status'
        ? { status: 200, body: { data: { steps: steps(3), complete: false } } }
        : undefined,
    );
    renderAt('/h', <Route path="/h" element={<SetupGuide />} />, makeMe('HEADMASTER'));
    expect(await screen.findByText('3 of 9 done')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Done')).toHaveLength(3);
    const next = screen.getByRole('link', { name: /Do this next/ });
    expect(next).toHaveTextContent('Do this next: Curriculum');
    expect(next).toHaveAttribute('href', '/h/curriculum');
    expect(screen.getByText(/4\. Upload the scheme of learning/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'How the system works' })).toHaveAttribute(
      'href',
      '/h/help',
    );
  });

  it('disappears once everything is done', async () => {
    const calls = mockApi((_m, path) =>
      path === '/setup-status'
        ? { status: 200, body: { data: { steps: steps(9), complete: true } } }
        : undefined,
    );
    const { container } = renderAt(
      '/h',
      <Route path="/h" element={<SetupGuide />} />,
      makeMe('HEADMASTER'),
    );
    await vi.waitFor(() => expect(calls.length).toBe(1));
    expect(container).toBeEmptyDOMElement();
  });
});

describe('help', () => {
  it('shows teachers how to record a lesson, and explains the words used', async () => {
    renderAt(
      '/t/help',
      <Route path="/t/help" element={<HelpPage area="teacher" />} />,
      makeMe('TEACHER'),
    );
    const first = screen.getByText('How do I record a lesson?').closest('details')!;
    expect(first).toHaveAttribute('open');
    expect(within(first).getByText('Record lesson')).toBeInTheDocument();
    expect(screen.getByText('Locked week')).toBeInTheDocument();
    expect(screen.queryByText('Setting up the school (once per term)')).toBeNull();

    const locked = screen.getByText(/Why does it say a week is "locked"\?/);
    await userEvent.click(locked);
    expect(locked.closest('details')).toHaveAttribute('open');
  });

  it('gives the headmaster the setup order', () => {
    renderAt(
      '/h/help',
      <Route path="/h/help" element={<HelpPage area="headmaster" />} />,
      makeMe('HEADMASTER'),
    );
    const order = screen.getByText('The order to do things in').closest('details')!;
    expect(within(order).getByText('Term dates')).toBeInTheDocument();
    expect(within(order).getByText('Publish')).toBeInTheDocument();
    expect(screen.getByText('A lesson did not take place')).toBeInTheDocument();
  });
});
