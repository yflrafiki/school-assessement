import { describe, expect, it, vi } from 'vitest';
import { createTabSession, type TabSessionDeps } from '../lib/tabSession';

/** One simulated browser tab: its own sessionStorage copy and its own view of the channel. */
function tab(
  name: string,
  storage: Map<string, string>,
  token: string | null,
  fork = vi.fn(async () => `${name}-forked`),
) {
  const state = { token };
  const deps: TabSessionDeps = {
    storage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => void storage.set(k, v) },
    channel: new BroadcastChannel('tab-session-test'),
    getToken: () => state.token,
    setToken: (t) => {
      state.token = t;
    },
    fork,
    newId: () => `${name}-${Math.random().toString(36).slice(2)}`,
    waitMs: 100,
  };
  return { settle: createTabSession(deps), state, fork, storage };
}

describe('tab session', () => {
  it('a duplicated tab forks its own session; the original keeps its own', async () => {
    const original = tab('original', new Map(), 'shared-token');
    expect(await original.settle()).toBe(false);

    // The browser copies the original tab's sessionStorage (tab id and token) into the duplicate.
    const copy = tab('copy', new Map(original.storage), 'shared-token');
    expect(await copy.settle()).toBe(true);
    expect(copy.fork).toHaveBeenCalledOnce();
    expect(copy.state.token).toBe('copy-forked');
    expect(copy.storage.get('teaching-monitor.tab')).not.toBe(
      original.storage.get('teaching-monitor.tab'),
    );
    expect(original.state.token).toBe('shared-token');
  });

  it('a refreshed tab keeps its session when no other tab owns its id', async () => {
    const storage = new Map([['teaching-monitor.tab', 'lonely-tab']]);
    const refreshed = tab('refreshed', storage, 'my-token');
    expect(await refreshed.settle()).toBe(false);
    expect(refreshed.fork).not.toHaveBeenCalled();
    expect(refreshed.state.token).toBe('my-token');
  });

  it('a signed-out tab never forks', async () => {
    const t = tab('fresh', new Map(), null);
    expect(await t.settle()).toBe(false);
    expect(t.fork).not.toHaveBeenCalled();
  });

  it('if the shared session already ended, the copy starts signed out', async () => {
    const original = tab('original2', new Map(), 'old-token');
    await original.settle();
    const copy = tab(
      'copy2',
      new Map(original.storage),
      'old-token',
      vi.fn(async () => Promise.reject(new Error('401'))),
    );
    expect(await copy.settle()).toBe(true);
    expect(copy.state.token).toBeNull();
  });
});
