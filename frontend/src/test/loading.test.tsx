import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route } from 'react-router-dom';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginPage } from '../features/auth/AuthPages';
import { QueryView } from '../components/States';
import { renderAt } from './render';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('sign-in feedback', () => {
  it('shows the request is in flight: busy button, locked fields, status, then a slow-server note', async () => {
    // A sign-in request that never answers, so the pending state stays on screen.
    vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
    renderAt('/login', <Route path="/login" element={<LoginPage />} />);

    await userEvent.type(screen.getByLabelText('Email'), 'head@test.example');
    await userEvent.type(screen.getByLabelText('Password'), 'Accra-Sunrise-2026');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    const button = await screen.findByRole('button', { name: /Signing in/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByLabelText('Email')).toBeDisabled();
    expect(screen.getByLabelText('Password')).toBeDisabled();
    expect(screen.getByText('Checking your details…')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(4100);
    });
    expect(screen.getByText(/server can take a few seconds to wake up/)).toBeInTheDocument();
  });
});

describe('loading placeholders', () => {
  it('renders a skeleton, not a spinner, while data loads', () => {
    render(
      <QueryView query={{ data: undefined, error: null, isPending: true, refetch: () => {} }}>
        {() => <p>Loaded</p>}
      </QueryView>,
    );
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveTextContent('Loading');
    expect(status.querySelector('.animate-spin')).toBeNull();
    expect(screen.queryByText('Loaded')).toBeNull();
  });

  it('uses a page-specific skeleton when one is given', () => {
    render(
      <QueryView
        query={{ data: undefined, error: null, isPending: true, refetch: () => {} }}
        skeleton={<div data-testid="dashboard-skeleton" />}
      >
        {() => <p>Loaded</p>}
      </QueryView>,
    );
    expect(screen.getByTestId('dashboard-skeleton')).toBeInTheDocument();
  });
});
