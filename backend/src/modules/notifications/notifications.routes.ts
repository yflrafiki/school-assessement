import { Router } from 'express';
import { notificationsQuery } from '@school/shared';
import { prisma, type Prisma } from '../../lib/db.js';
import { auth, idParam, query } from '../../lib/http.js';
import { AppError, notFound } from '../../lib/errors.js';
import { decodeCursor, encodeCursor } from '../../lib/pagination.js';
import { subscribe } from '../../lib/events.js';

export const notificationsRouter = Router();

notificationsRouter.get('/notifications', async (req, res) => {
  const a = auth(req);
  const q = query(req, notificationsQuery);
  const cursor = q.cursor ? decodeCursor(q.cursor) : null;
  const where: Prisma.NotificationWhereInput = {
    recipientId: a.userId,
    schoolId: a.schoolId,
    ...(q.unreadOnly === 'true' ? { readAt: null } : {}),
    ...(cursor
      ? {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        }
      : {}),
  };
  const rows = await prisma.notification.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
  });
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  res.json({
    data: page.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      recordId: n.recordId,
      readAt: n.readAt,
      createdAt: n.createdAt,
    })),
    meta: {
      nextCursor: rows.length > q.limit && last ? encodeCursor(last.createdAt, last.id) : null,
    },
  });
});

const HEARTBEAT_MS = 25_000;
/** Connections re-authenticate at least this often, which also enforces session expiry. */
const STREAM_MAX_AGE_MS = 60 * 60 * 1000;
export const MAX_STREAMS_PER_USER = 8;
const openStreams = new Map<string, number>();

/**
 * Live notifications as Server-Sent Events. The browser keeps this request open; the server
 * writes an event the moment a notification is committed. Authenticated like every other
 * request (Bearer header), so it closes as soon as its session ends.
 */
notificationsRouter.get('/notifications/stream', (req, res) => {
  const a = auth(req);
  // Each open stream holds memory on the server; a handful of tabs per person is plenty.
  const open = openStreams.get(a.userId) ?? 0;
  if (open >= MAX_STREAMS_PER_USER) {
    throw new AppError('RATE_LIMITED', 'Too many open tabs. Close some and try again.');
  }
  openStreams.set(a.userId, open + 1);

  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    // Stops proxies (Render's included) from buffering the stream.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const send = (event: string, data: unknown) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    clearTimeout(maxAge);
    unsubscribe();
    const remaining = (openStreams.get(a.userId) ?? 1) - 1;
    if (remaining > 0) openStreams.set(a.userId, remaining);
    else openStreams.delete(a.userId);
    res.end();
  };

  const unsubscribe = subscribe(a.userId, (event) => {
    if (event.type === 'notification') send('notification', event.notification);
    else if (
      event.type === 'session-ended' &&
      (!event.sessionId || event.sessionId === a.sessionId)
    ) {
      send('session-ended', {});
      close();
    }
  });
  // Comments keep idle connections from being dropped by proxies along the way.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
  const maxAge = setTimeout(close, STREAM_MAX_AGE_MS);
  req.on('close', close);

  send('ready', {});
});

notificationsRouter.get('/notifications/unread-count', async (req, res) => {
  const a = auth(req);
  const count = await prisma.notification.count({
    where: { recipientId: a.userId, schoolId: a.schoolId, readAt: null },
  });
  res.json({ data: { count } });
});

notificationsRouter.patch('/notifications/read-all', async (req, res) => {
  const a = auth(req);
  const { count } = await prisma.notification.updateMany({
    where: { recipientId: a.userId, schoolId: a.schoolId, readAt: null },
    data: { readAt: new Date() },
  });
  res.json({ data: { updated: count } });
});

notificationsRouter.patch('/notifications/:id/read', async (req, res) => {
  const a = auth(req);
  const { count } = await prisma.notification.updateMany({
    where: { id: idParam(req), recipientId: a.userId, schoolId: a.schoolId, readAt: null },
    data: { readAt: new Date() },
  });
  if (!count) {
    const exists = await prisma.notification.findFirst({
      where: { id: idParam(req), recipientId: a.userId },
      select: { id: true },
    });
    if (!exists) throw notFound('Notification');
  }
  res.json({ data: { id: idParam(req), read: true } });
});
