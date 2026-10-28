// Keeps every browser tab on its own server session.
//
// The session token lives in sessionStorage, which browsers keep per tab, but they COPY it
// when a tab is duplicated or a link is opened in a new tab. Two tabs would then share one
// session, and signing out (or in as someone else) in one would sign the other out too.
// Each tab therefore holds a private tab id. On start-up a tab asks the other open tabs, over
// a BroadcastChannel, whether one of them already owns its id. If so, it is a copy: it takes a
// new id and swaps the shared token for a fresh session of its own (POST /auth/sessions/fork).

import { api, getSessionToken, setSessionToken, type One } from './api';

const TAB_KEY = 'teaching-monitor.tab';
const CHANNEL = 'teaching-monitor-tabs';
const WAIT_MS = 250;

type Message = { type: 'claim?' | 'claimed'; tabId: string };

export interface TabSessionDeps {
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  channel: Pick<
    BroadcastChannel,
    'postMessage' | 'addEventListener' | 'removeEventListener'
  > | null;
  getToken: () => string | null;
  setToken: (token: string | null) => void;
  fork: () => Promise<string>;
  newId: () => string;
  waitMs?: number;
}

/** Returns a function that settles this tab's identity; resolves to true when it was a copy. */
export function createTabSession(deps: TabSessionDeps) {
  let myTabId = '';

  // Answer other tabs for as long as this tab is open.
  deps.channel?.addEventListener('message', (e: MessageEvent<Message>) => {
    if (e.data?.type === 'claim?' && myTabId && e.data.tabId === myTabId) {
      deps.channel?.postMessage({ type: 'claimed', tabId: myTabId } satisfies Message);
    }
  });

  const takeNewId = () => {
    myTabId = deps.newId();
    try {
      deps.storage.setItem(TAB_KEY, myTabId);
    } catch {
      // Storage blocked: the tab simply keeps its id in memory.
    }
  };

  const ownedElsewhere = (tabId: string) =>
    new Promise<boolean>((resolve) => {
      const channel = deps.channel!;
      const onMessage = (e: MessageEvent<Message>) => {
        if (e.data?.type === 'claimed' && e.data.tabId === tabId) finish(true);
      };
      const timer = setTimeout(() => finish(false), deps.waitMs ?? WAIT_MS);
      function finish(result: boolean) {
        clearTimeout(timer);
        channel.removeEventListener('message', onMessage as EventListener);
        resolve(result);
      }
      channel.addEventListener('message', onMessage as EventListener);
      channel.postMessage({ type: 'claim?', tabId } satisfies Message);
    });

  const readTabId = () => {
    try {
      return deps.storage.getItem(TAB_KEY);
    } catch {
      return null;
    }
  };

  return async function settle(): Promise<boolean> {
    const stored = readTabId();
    // Nothing to share: a fresh tab, a signed-out tab, or a browser without BroadcastChannel.
    if (!stored || !deps.getToken() || !deps.channel) {
      takeNewId();
      return false;
    }
    if (!(await ownedElsewhere(stored))) {
      myTabId = stored; // A refresh of this same tab.
      return false;
    }
    takeNewId();
    try {
      deps.setToken(await deps.fork());
    } catch {
      // The shared session has already ended: this tab starts signed out.
      deps.setToken(null);
    }
    return true;
  };
}

/** The app's own tab session, using the real browser APIs. */
export const settleTabSession = createTabSession({
  storage: sessionStorage,
  channel: typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL),
  getToken: getSessionToken,
  setToken: setSessionToken,
  fork: () => api.post<One<{ token: string }>>('/auth/sessions/fork').then((r) => r.data.token),
  newId: () => crypto.randomUUID(),
});
