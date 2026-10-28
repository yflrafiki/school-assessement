import { ROLE_PERMISSIONS, type Me } from '@school/shared';
import { env } from '../../config/env.js';
import { prisma, type Db } from '../../lib/db.js';
import { AppError, validation } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { publishToUser } from '../../lib/events.js';
import { hashToken, newToken } from '../../lib/tokens.js';
import {
  burnPasswordCheck,
  hashPassword,
  passwordProblem,
  verifyPassword,
} from '../../lib/password.js';
import { SESSION_ABSOLUTE_MS } from '../../middleware/session.js';

export const INVITATION_TTL_MS = 72 * 60 * 60 * 1000;
export const RESET_TTL_MS = 60 * 60 * 1000;
const MAX_STAFF_ID_ATTEMPTS = 5;
const MAX_LOGIN_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const RESET_THROTTLE_MS = 2 * 60 * 1000;

const badCredentials = () => new AppError('UNAUTHENTICATED', 'The email or password is incorrect');
const invitationInvalid = () =>
  new AppError(
    'INVITATION_INVALID',
    'This invitation link or staff ID is not valid. Ask your headmaster to send a new invitation.',
  );
const resetInvalid = () =>
  new AppError(
    'TOKEN_INVALID',
    'This password reset link is not valid or has expired. Request a new one.',
  );

interface ClientInfo {
  ip?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string;
}

export async function createSession(db: Db, userId: string, client: ClientInfo) {
  const token = newToken();
  await db.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + SESSION_ABSOLUTE_MS),
      ipAddress: client.ip?.slice(0, 64) ?? null,
      userAgent: client.userAgent?.slice(0, 300) ?? null,
    },
  });
  return { token };
}

export async function revokeAllSessions(db: Db, userId: string, exceptSessionId?: string) {
  const where = {
    userId,
    revokedAt: null,
    ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
  };
  const ended = await db.session.findMany({ where, select: { id: true } });
  const result = await db.session.updateMany({ where, data: { revokedAt: new Date() } });
  // Close those sessions' live notification connections at once. If the surrounding
  // transaction rolls back, the tabs simply reconnect with their still-valid sessions.
  for (const s of ended) publishToUser(userId, { type: 'session-ended', sessionId: s.id });
  return result;
}

export async function login(email: string, password: string, client: ClientInfo) {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !user.passwordHash || user.status !== 'ACTIVE') {
    await burnPasswordCheck(password);
    throw badCredentials();
  }
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    await burnPasswordCheck(password);
    throw new AppError(
      'RATE_LIMITED',
      'Too many failed attempts. Try again in 15 minutes or reset your password.',
    );
  }

  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) {
    const failures = user.failedLoginCount + 1;
    const lock = failures >= MAX_LOGIN_FAILURES;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: lock ? 0 : failures,
        lockedUntil: lock ? new Date(Date.now() + LOCKOUT_MS) : user.lockedUntil,
      },
    });
    if (lock) {
      await audit(prisma, {
        schoolId: user.schoolId,
        actorId: null,
        action: 'auth.lockout',
        entityType: 'User',
        entityId: user.id,
        ...(client.requestId ? { requestId: client.requestId } : {}),
      });
    }
    throw badCredentials();
  }

  return prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    return createSession(tx, user.id, client);
  });
}

export async function logout(sessionId: string) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { userId: true },
  });
  await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (session) publishToUser(session.userId, { type: 'session-ended', sessionId });
}

export async function getMe(userId: string): Promise<Me> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { school: true, teacherProfile: { select: { id: true } } },
  });
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    status: user.status,
    school: { id: user.school.id, name: user.school.name, timezone: user.school.timezone },
    teacherProfileId: user.teacherProfile?.id ?? null,
    permissions: [...ROLE_PERMISSIONS[user.role]],
  };
}

// ---------- Invitations ----------

/**
 * Creates a fresh invitation for a pending user, revoking any earlier one, and queues the email.
 * Must run inside the caller's transaction.
 */
export async function issueInvitation(tx: Db, userId: string, issuedById: string | null) {
  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    include: { school: true },
  });
  await tx.authToken.updateMany({
    where: { userId, type: 'INVITATION', consumedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  const token = newToken();
  await tx.authToken.create({
    data: {
      userId,
      type: 'INVITATION',
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      createdById: issuedById,
    },
  });
  await tx.emailOutbox.create({
    data: {
      schoolId: user.schoolId,
      toEmail: user.email,
      template: 'INVITATION',
      payload: {
        to_name: user.fullName,
        school_name: user.school.name,
        // Token in the fragment so it never reaches server or proxy logs.
        link: `${env.APP_BASE_URL}/activate#token=${token}`,
        expires_in: '72 hours',
      },
    },
  });
  return token;
}

async function findUsableToken(db: Db, token: string, type: 'INVITATION' | 'PASSWORD_RESET') {
  const row = await db.authToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { school: true, teacherProfile: true } } },
  });
  if (
    !row ||
    row.type !== type ||
    row.consumedAt ||
    row.revokedAt ||
    row.expiresAt.getTime() <= Date.now() ||
    row.failedAttempts >= MAX_STAFF_ID_ATTEMPTS
  ) {
    return null;
  }
  return row;
}

export async function validateInvitation(token: string) {
  const row = await findUsableToken(prisma, token, 'INVITATION');
  if (!row || row.user.status !== 'PENDING_ACTIVATION') throw invitationInvalid();
  return { fullName: row.user.fullName, schoolName: row.user.school.name, email: row.user.email };
}

export async function acceptInvitation(
  input: { token: string; staffId: string; password: string },
  client: ClientInfo,
) {
  const basic = passwordProblem(input.password);
  if (basic) throw validation({ password: [basic] });
  const passwordHash = await hashPassword(input.password);

  const outcome = await prisma.$transaction(async (tx) => {
    const tokenHash = hashToken(input.token);
    // Serialise concurrent attempts on the same token.
    await tx.$queryRaw`SELECT id FROM auth_tokens WHERE token_hash = ${tokenHash} FOR UPDATE`;
    const row = await findUsableToken(tx, input.token, 'INVITATION');
    if (!row || row.user.status !== 'PENDING_ACTIVATION' || !row.user.teacherProfile) {
      return { ok: false as const };
    }

    const expected = row.user.teacherProfile.staffId.trim().toLowerCase();
    if (input.staffId.trim().toLowerCase() !== expected) {
      const attempts = row.failedAttempts + 1;
      await tx.authToken.update({
        where: { id: row.id },
        data: {
          failedAttempts: attempts,
          ...(attempts >= MAX_STAFF_ID_ATTEMPTS ? { revokedAt: new Date() } : {}),
        },
      });
      await audit(tx, {
        schoolId: row.user.schoolId,
        actorId: null,
        action:
          attempts >= MAX_STAFF_ID_ATTEMPTS ? 'invitation.burned' : 'invitation.staff_id_mismatch',
        entityType: 'User',
        entityId: row.userId,
        metadata: { attempts },
        ...(client.requestId ? { requestId: client.requestId } : {}),
      });
      return { ok: false as const };
    }

    const contextual = passwordProblem(input.password, [
      row.user.email.split('@')[0] ?? '',
      row.user.teacherProfile.staffId,
      ...row.user.fullName.split(/\s+/),
    ]);
    if (contextual) return { ok: false as const, passwordError: contextual };

    await tx.user.update({
      where: { id: row.userId },
      data: { passwordHash, status: 'ACTIVE', passwordChangedAt: new Date(), failedLoginCount: 0 },
    });
    await tx.authToken.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
    await audit(tx, {
      schoolId: row.user.schoolId,
      actorId: row.userId,
      action: 'invitation.accepted',
      entityType: 'User',
      entityId: row.userId,
      ...(client.requestId ? { requestId: client.requestId } : {}),
    });
    const session = await createSession(tx, row.userId, client);
    return { ok: true as const, session };
  });

  if (!outcome.ok) {
    if ('passwordError' in outcome && outcome.passwordError) {
      throw validation({ password: [outcome.passwordError] });
    }
    throw invitationInvalid();
  }
  return outcome.session;
}

// ---------- Password reset ----------

export async function issuePasswordReset(tx: Db, userId: string, issuedById: string | null) {
  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    include: { school: true },
  });
  await tx.authToken.updateMany({
    where: { userId, type: 'PASSWORD_RESET', consumedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  const token = newToken();
  await tx.authToken.create({
    data: {
      userId,
      type: 'PASSWORD_RESET',
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
      createdById: issuedById,
    },
  });
  await tx.emailOutbox.create({
    data: {
      schoolId: user.schoolId,
      toEmail: user.email,
      template: 'PASSWORD_RESET',
      payload: {
        to_name: user.fullName,
        school_name: user.school.name,
        link: `${env.APP_BASE_URL}/reset-password#token=${token}`,
        expires_in: '60 minutes',
      },
    },
  });
  return token;
}

/** Always resolves the same way so the response never reveals whether the email exists. */
export async function forgotPassword(email: string, client: ClientInfo) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.status !== 'ACTIVE') return;

  const recent = await prisma.authToken.findFirst({
    where: {
      userId: user.id,
      type: 'PASSWORD_RESET',
      createdAt: { gt: new Date(Date.now() - RESET_THROTTLE_MS) },
    },
    select: { id: true },
  });
  if (recent) return;

  await prisma.$transaction(async (tx) => {
    await issuePasswordReset(tx, user.id, null);
    await audit(tx, {
      schoolId: user.schoolId,
      actorId: null,
      action: 'password.reset_requested',
      entityType: 'User',
      entityId: user.id,
      ...(client.requestId ? { requestId: client.requestId } : {}),
    });
  });
}

export async function resetPassword(
  input: { token: string; password: string },
  client: ClientInfo,
) {
  const basic = passwordProblem(input.password);
  if (basic) throw validation({ password: [basic] });
  const passwordHash = await hashPassword(input.password);

  const ok = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM auth_tokens WHERE token_hash = ${hashToken(input.token)} FOR UPDATE`;
    const row = await findUsableToken(tx, input.token, 'PASSWORD_RESET');
    if (!row || row.user.status !== 'ACTIVE') return false;

    await tx.user.update({
      where: { id: row.userId },
      data: { passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null },
    });
    await tx.authToken.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
    await revokeAllSessions(tx, row.userId);
    await audit(tx, {
      schoolId: row.user.schoolId,
      actorId: row.userId,
      action: 'password.reset',
      entityType: 'User',
      entityId: row.userId,
      ...(client.requestId ? { requestId: client.requestId } : {}),
    });
    return true;
  });
  if (!ok) throw resetInvalid();
}

export async function changePassword(
  userId: string,
  sessionId: string,
  input: { currentPassword: string; newPassword: string },
  client: ClientInfo,
) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { teacherProfile: true },
  });
  if (!user.passwordHash || !(await verifyPassword(user.passwordHash, input.currentPassword))) {
    throw validation({ currentPassword: ['Your current password is incorrect'] });
  }
  const problem = passwordProblem(input.newPassword, [
    user.email.split('@')[0] ?? '',
    user.teacherProfile?.staffId ?? '',
    ...user.fullName.split(/\s+/),
  ]);
  if (problem) throw validation({ newPassword: [problem] });
  if (input.newPassword === input.currentPassword) {
    throw validation({ newPassword: ['Choose a password different from your current one'] });
  }
  const passwordHash = await hashPassword(input.newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash, passwordChangedAt: new Date() },
    });
    await revokeAllSessions(tx, userId, sessionId);
    await audit(tx, {
      schoolId: user.schoolId,
      actorId: userId,
      action: 'password.changed',
      entityType: 'User',
      entityId: userId,
      ...(client.requestId ? { requestId: client.requestId } : {}),
    });
  });
}
