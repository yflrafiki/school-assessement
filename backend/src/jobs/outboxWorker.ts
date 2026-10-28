import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { prisma } from '../lib/db.js';
import { emailProvider, type EmailTemplateName } from '../lib/mailer.js';

const SEND_SPACING_MS = 1100; // EmailJS allows 1 request per second.
const IDLE_POLL_MS = 3000;
const MAX_ATTEMPTS = 5;

interface ClaimedRow {
  id: string;
  school_id: string | null;
  to_email: string;
  template: EmailTemplateName;
  payload: Record<string, string>;
  attempts: number;
}

/** Sends at most one pending email. Returns true when a row was processed. */
export async function processNextEmail(): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<ClaimedRow[]>`
      SELECT id, school_id, to_email, template::text AS template, payload, attempts
      FROM email_outbox
      WHERE status = 'PENDING' AND available_at <= now()
      ORDER BY available_at, id
      LIMIT 1
      FOR UPDATE SKIP LOCKED`;
    const row = rows[0];
    if (!row) return false;

    try {
      await emailProvider().send({ to: row.to_email, template: row.template, params: row.payload });
      // The payload holds the token link, so it is cleared once delivered.
      await tx.emailOutbox.update({
        where: { id: row.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          payload: {},
          attempts: row.attempts + 1,
          lastError: null,
        },
      });
      if (row.school_id) await warnIfNearQuota(tx, row.school_id);
    } catch (err) {
      const attempts = row.attempts + 1;
      const failed = attempts >= MAX_ATTEMPTS;
      logger.warn({ err, emailId: row.id, attempts }, 'Email send failed');
      await tx.emailOutbox.update({
        where: { id: row.id },
        data: {
          attempts,
          lastError: String(err instanceof Error ? err.message : err).slice(0, 500),
          status: failed ? 'FAILED' : 'PENDING',
          ...(failed ? { payload: {} } : {}),
          availableAt: new Date(Date.now() + 2 ** attempts * 30_000),
        },
      });
    }
    return true;
  });
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function warnIfNearQuota(tx: Tx, schoolId: string) {
  if (env.EMAIL_PROVIDER !== 'emailjs') return;
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  // The quota belongs to the EmailJS account, which every school shares.
  const sent = await tx.emailOutbox.count({
    where: { status: 'SENT', sentAt: { gte: monthStart } },
  });
  if (sent < Math.floor(env.EMAILJS_MONTHLY_QUOTA * 0.8)) return;

  const headmasters = await tx.user.findMany({
    where: { schoolId, role: 'HEADMASTER', status: 'ACTIVE' },
    select: { id: true },
  });
  for (const h of headmasters) {
    const already = await tx.notification.findFirst({
      where: { recipientId: h.id, type: 'EMAIL_QUOTA_WARNING', createdAt: { gte: monthStart } },
      select: { id: true },
    });
    if (already) continue;
    await tx.notification.create({
      data: {
        schoolId,
        recipientId: h.id,
        type: 'EMAIL_QUOTA_WARNING',
        title: 'Email quota almost used',
        body: `${sent} of ${env.EMAILJS_MONTHLY_QUOTA} invitation and reset emails have been sent this month. Further emails may be delayed until next month.`,
      },
    });
  }
}

/** In-process worker loop. Stops cleanly when the returned function is called. */
export function startOutboxWorker(): () => Promise<void> {
  let stopped = false;
  let wake: (() => void) | undefined;
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms);
      wake = () => {
        clearTimeout(t);
        resolve();
      };
    });

  const loop = (async () => {
    while (!stopped) {
      let worked = false;
      try {
        worked = await processNextEmail();
      } catch (err) {
        logger.error({ err }, 'Outbox worker error');
      }
      if (!stopped) await sleep(worked ? SEND_SPACING_MS : IDLE_POLL_MS);
    }
  })();

  return async () => {
    stopped = true;
    wake?.();
    await loop;
  };
}
