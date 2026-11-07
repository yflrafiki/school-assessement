import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { prisma } from '../lib/db.js';
import { audit } from '../lib/audit.js';
import { hashPassword, passwordProblem } from '../lib/password.js';

interface AdminSettings {
  email?: string | undefined;
  name?: string | undefined;
  password?: string | undefined;
}

/**
 * Creates the system admin once, at start-up, from SYSTEM_ADMIN_EMAIL, SYSTEM_ADMIN_NAME and
 * SYSTEM_ADMIN_PASSWORD, for hosts without a shell to run create-system-admin. It does nothing
 * when a system admin already exists, so it can never replace or change an account; the
 * settings should be removed from the host once the account exists.
 */
export async function bootstrapSystemAdmin(
  settings: AdminSettings = {
    email: env.SYSTEM_ADMIN_EMAIL,
    name: env.SYSTEM_ADMIN_NAME,
    password: env.SYSTEM_ADMIN_PASSWORD,
  },
): Promise<'created' | 'skipped'> {
  const email = settings.email?.trim().toLowerCase();
  const name = settings.name?.trim();
  const password = settings.password;
  if (!email && !name && !password) return 'skipped';

  if (await prisma.user.findFirst({ where: { role: 'SYSTEM_ADMIN' }, select: { id: true } })) {
    logger.info(
      'A system admin already exists, so SYSTEM_ADMIN_* settings were ignored. Remove them from the environment.',
    );
    return 'skipped';
  }
  if (!email || !name || !password) {
    logger.warn('Set SYSTEM_ADMIN_EMAIL, SYSTEM_ADMIN_NAME and SYSTEM_ADMIN_PASSWORD together.');
    return 'skipped';
  }
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    logger.warn(
      'SYSTEM_ADMIN_EMAIL is already used by another account. Choose an email no one at the school uses.',
    );
    return 'skipped';
  }
  const problem = passwordProblem(password, [email.split('@')[0] ?? '', ...name.split(/\s+/)]);
  if (problem) {
    logger.warn(`SYSTEM_ADMIN_PASSWORD was not accepted: ${problem}`);
    return 'skipped';
  }

  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        schoolId: null,
        email,
        fullName: name,
        role: 'SYSTEM_ADMIN',
        status: 'ACTIVE',
        passwordHash,
        passwordChangedAt: new Date(),
      },
    });
    await audit(tx, {
      schoolId: null,
      actorId: null,
      action: 'system_admin.created_by_operator',
      entityType: 'User',
      entityId: user.id,
      metadata: { via: 'start-up settings' },
    });
  });
  logger.info(
    { email },
    'System admin created. Now remove SYSTEM_ADMIN_PASSWORD (and the other SYSTEM_ADMIN_* settings) from the environment.',
  );
  return 'created';
}
