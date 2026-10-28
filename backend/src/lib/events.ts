import { EventEmitter } from 'node:events';

/**
 * In-process bus for live updates pushed to open browser tabs (Server-Sent Events).
 * It never touches the database, so an idle tab does not keep a sleeping database awake.
 * With several API instances this would move to PostgreSQL LISTEN/NOTIFY or Redis;
 * for one instance, memory is the simplest correct choice.
 */
export type LiveEvent =
  | { type: 'notification'; notification: { title: string; body: string; recordId: string | null } }
  /** Closes live connections: one session's (sign-out) or all of a user's (deactivation, reset). */
  | { type: 'session-ended'; sessionId?: string };

const bus = new EventEmitter();
// One listener per open tab; a busy school can have many.
bus.setMaxListeners(0);

const channel = (userId: string) => `user:${userId}`;

export function publishToUser(userId: string, event: LiveEvent) {
  bus.emit(channel(userId), event);
}

export function subscribe(userId: string, listener: (event: LiveEvent) => void): () => void {
  bus.on(channel(userId), listener);
  return () => bus.off(channel(userId), listener);
}
