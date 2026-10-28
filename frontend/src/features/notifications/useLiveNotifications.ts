import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSessionToken } from '../../lib/api';
import { parseSse } from '../../lib/sse';
import { meKey } from '../auth/useMe';
import { unreadKey } from './NotificationBell';

export interface LiveNotification {
  title: string;
  body: string;
  recordId: string | null;
}

const RETRY_DELAYS_MS = [1000, 2000, 5000, 10_000, 30_000];

/**
 * Keeps a live connection to the server so new notifications appear the moment they happen.
 * Reconnects with back-off if the connection drops (network change, server restart, the
 * server's hourly re-authentication). Uses fetch rather than EventSource so the session
 * token travels in the Authorization header, never in the URL.
 */
export function useLiveNotifications(onNotification: (n: LiveNotification) => void) {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const handler = useRef(onNotification);
  useEffect(() => {
    handler.current = onNotification;
  }, [onNotification]);

  useEffect(() => {
    let stopped = false;
    let controller: AbortController | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const scheduleRetry = () => {
      if (stopped) return;
      const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)] ?? 30_000;
      attempt += 1;
      retryTimer = setTimeout(() => void connect(), delay);
    };

    const connect = async () => {
      const token = getSessionToken();
      if (!token || stopped) return;
      controller = new AbortController();
      try {
        const res = await fetch('/api/v1/notifications/stream', {
          headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
          signal: controller.signal,
        });
        if (res.status === 401) {
          // Session over: let the normal sign-in flow take over instead of retrying.
          setConnected(false);
          void qc.invalidateQueries({ queryKey: meKey });
          return;
        }
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const parsed = parseSse(buffer + decoder.decode(value, { stream: true }));
          buffer = parsed.rest;
          for (const e of parsed.events) {
            if (e.event === 'ready') {
              attempt = 0;
              setConnected(true);
              // Catch up on anything that arrived while disconnected.
              void qc.invalidateQueries({ queryKey: ['notifications'] });
            } else if (e.event === 'notification') {
              void qc.invalidateQueries({ queryKey: ['notifications'] });
              void qc.invalidateQueries({ queryKey: unreadKey });
              void qc.invalidateQueries({ queryKey: ['dashboard'] });
              void qc.invalidateQueries({ queryKey: ['records'] });
              handler.current(JSON.parse(e.data) as LiveNotification);
            } else if (e.event === 'session-ended') {
              stopped = true;
              void qc.invalidateQueries({ queryKey: meKey });
            }
          }
        }
      } catch {
        // Aborted on unmount, or the network dropped: handled below.
      }
      setConnected(false);
      scheduleRetry();
    };

    void connect();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      controller?.abort();
    };
  }, [qc]);

  return { connected };
}
