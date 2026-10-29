import type { RequestHandler } from 'express';
import { prisma } from '../lib/db.js';
import { hashToken } from '../lib/tokens.js';
import { AppError } from '../lib/errors.js';

// Short lifetimes limit what a stolen token is worth. An open tab stays signed in, because it
// keeps talking to the server (the notification check alone does that every couple of minutes);
// a tab left closed, or a laptop asleep, is signed out after 2 hours, and everyone signs in
// again at least once every 12 hours.
export const SESSION_IDLE_MS = 2 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 60 * 1000;

/**
 * Sessions travel in `Authorization: Bearer <token>`, not in a cookie. The web app keeps the
 * token in the tab's sessionStorage, so every browser tab holds its own sign-in: a headmaster
 * and a teacher can be signed in side by side on the same address. Browsers never attach this
 * header on their own, so cross-site request forgery is not possible and no CSRF token is needed.
 */
function bearerToken(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length >= 20 && token.length <= 100 ? token : null;
}

/** Attaches req.auth when a valid session token is present. Never rejects on its own. */
export const loadSession: RequestHandler = async (req, _res, next) => {
  const token = bearerToken(req.get('authorization'));
  if (!token) return next();

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { teacherProfile: { select: { id: true } } } } },
  });

  const now = Date.now();
  const valid =
    session &&
    !session.revokedAt &&
    session.expiresAt.getTime() > now &&
    session.lastSeenAt.getTime() + SESSION_IDLE_MS > now &&
    session.user.status === 'ACTIVE';
  if (!valid) return next();

  if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(now) } });
  }

  req.auth = {
    userId: session.user.id,
    schoolId: session.user.schoolId,
    role: session.user.role,
    teacherProfileId: session.user.teacherProfile?.id ?? null,
    sessionId: session.id,
    fullName: session.user.fullName,
  };
  next();
};

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(new AppError('UNAUTHENTICATED', 'Please sign in'));
  next();
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Routes that receive a file instead of JSON, with the one media type each accepts. */
const FILE_UPLOADS: Record<string, string> = {
  '/curriculum/imports/pdf': 'application/pdf',
  '/timetable/import/pdf': 'application/pdf',
};

/** Request bodies must be JSON (or the declared file type); anything else is refused before routing. */
export const requireJson: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  const hasBody = req.headers['content-length'] && req.headers['content-length'] !== '0';
  const fileType = FILE_UPLOADS[req.path];
  if (hasBody && fileType) {
    return req.is(fileType)
      ? next()
      : next(new AppError('VALIDATION_ERROR', 'Upload the file as a PDF'));
  }
  if (hasBody && !req.is('application/json')) {
    return next(new AppError('VALIDATION_ERROR', 'Requests must be sent as JSON'));
  }
  next();
};
