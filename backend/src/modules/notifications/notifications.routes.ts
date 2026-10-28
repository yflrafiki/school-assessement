import { Router } from 'express';
import { notificationsQuery } from '@school/shared';
import { prisma, type Prisma } from '../../lib/db.js';
import { auth, idParam, query } from '../../lib/http.js';
import { notFound } from '../../lib/errors.js';
import { decodeCursor, encodeCursor } from '../../lib/pagination.js';

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
