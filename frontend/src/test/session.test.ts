import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, getSessionToken, setSessionToken } from '../lib/api';
import { fetchMe } from '../features/auth/useMe';
import { mockApi } from './render';

afterEach(() => {
  vi.unstubAllGlobals();
  setSessionToken(null);
});

describe('per-tab session', () => {
  it('treats a tab without its own token as signed out, without calling the server', async () => {
    const calls = mockApi(() => undefined);
    setSessionToken(null);
    expect(await fetchMe()).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('sends the tab token as a Bearer header and never relies on cookies', async () => {
    let seen: Headers | undefined;
    let credentials: RequestCredentials | undefined;
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen = new Headers(init?.headers);
      credentials = init?.credentials;
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    setSessionToken('tab-token-abc');
    await api.get('/classes');
    expect(seen?.get('Authorization')).toBe('Bearer tab-token-abc');
    expect(credentials).toBe('omit');
  });

  it('forgets the token when the server says the session has ended', async () => {
    mockApi(() => ({
      status: 401,
      body: { error: { code: 'UNAUTHENTICATED', message: 'Please sign in' } },
    }));
    setSessionToken('expired-token');
    await expect(api.get('/classes')).rejects.toThrow('Please sign in');
    expect(getSessionToken()).toBeNull();
  });
});
