import { Router } from 'express';
import { prisma } from '../../lib/db.js';

export const healthRouter = Router();

healthRouter.get('/healthz', (_req, res) => {
  res.json({ data: { status: 'ok' } });
});

healthRouter.get('/readyz', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ data: { status: 'ready', database: 'ok' } });
  } catch {
    res.status(503).json({ data: { status: 'unavailable', database: 'error' } });
  }
});
