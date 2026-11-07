import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route } from 'react-router-dom';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfilePage } from '../features/auth/ProfilePage';
import { makeMe, mockApi, renderAt } from './render';

afterEach(() => vi.unstubAllGlobals());

describe('changing your own email', () => {
  it('asks for the password and shows the new address afterwards', async () => {
    const me = makeMe('HEADMASTER');
    const calls = mockApi((method, path, body) =>
      method === 'PATCH' && path === '/auth/me/email'
        ? { status: 200, body: { data: { ...me, email: (body as { email: string }).email } } }
        : undefined,
    );
    renderAt('/h/profile', <Route path="/h/profile" element={<ProfilePage />} />, me);
    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    await userEvent.type(screen.getByLabelText('New email'), 'head@ipel.example');
    await userEvent.type(screen.getByLabelText(/Your current password/), 'Correct-Horse-Battery-9');
    await userEvent.click(screen.getByRole('button', { name: 'Change email' }));

    expect(await screen.findByText(/Email changed/)).toBeInTheDocument();
    expect(screen.getByText('head@ipel.example')).toBeInTheDocument();
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        email: 'head@ipel.example',
        currentPassword: 'Correct-Horse-Battery-9',
      }),
    );
  });

  it('is not offered to teachers', () => {
    renderAt(
      '/t/profile',
      <Route path="/t/profile" element={<ProfilePage />} />,
      makeMe('TEACHER'),
    );
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
    expect(screen.getByText(/ask your headmaster/)).toBeInTheDocument();
  });
});
