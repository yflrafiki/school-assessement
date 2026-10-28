import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import type { Me } from '@school/shared';
import { ROLE_PERMISSIONS } from '@school/shared';
import { makeQueryClient } from '../app/providers';
import { meKey } from '../features/auth/useMe';
import { setSessionToken } from '../lib/api';

export type Handler = (
  method: string,
  path: string,
  body: unknown,
) => { status: number; body?: unknown } | undefined;

/** Replaces fetch with a router over method and path; unmatched calls fail the test loudly. */
export function mockApi(handler: Handler) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const path = url.pathname.replace('/api/v1', '') + url.search;
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    const res = handler(method, path, body);
    if (!res) throw new Error(`Unexpected API call ${method} ${path}`);
    return new Response(res.status === 204 ? null : JSON.stringify(res.body ?? {}), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return calls;
}

export function makeMe(role: Me['role']): Me {
  return {
    id: 'u1',
    email: 'user@test.example',
    fullName: role === 'TEACHER' ? 'Kofi Boateng' : 'Ama Mensah',
    role,
    status: 'ACTIVE',
    school: { id: 's1', name: 'Test JHS', timezone: 'Africa/Accra' },
    teacherProfileId: role === 'TEACHER' ? 't1' : null,
    permissions: [...ROLE_PERMISSIONS[role]],
  };
}

export function renderAt(path: string, routes: ReactNode, me: Me | null = null) {
  const client = makeQueryClient();
  client.setDefaultOptions({ queries: { retry: false } });
  // A signed-in tab holds its own token in sessionStorage.
  setSessionToken(me ? 'test-session-token-for-this-tab' : null);
  client.setQueryData(meKey, me);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>{routes}</Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
