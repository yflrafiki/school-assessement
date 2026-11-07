import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './lib/db.js';
import { startOutboxWorker } from './jobs/outboxWorker.js';
import { startLessonReminders } from './jobs/lessonReminders.js';
import { bootstrapSystemAdmin } from './jobs/bootstrapAdmin.js';

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, emailProvider: env.EMAIL_PROVIDER }, 'API listening');
});
const stopWorker = startOutboxWorker();
const stopReminders = startLessonReminders();
bootstrapSystemAdmin().catch((err: unknown) =>
  logger.error({ err }, 'Could not create the system admin from the start-up settings'),
);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');
  const force = setTimeout(() => process.exit(1), 15_000);
  force.unref();
  server.close();
  stopReminders();
  await stopWorker();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'Unhandled rejection'));
