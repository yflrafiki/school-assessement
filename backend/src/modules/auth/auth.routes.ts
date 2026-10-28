import { Router, type Request } from 'express';
import {
  changePasswordBody,
  forgotPasswordBody,
  invitationAcceptBody,
  invitationValidateBody,
  loginBody,
  resetPasswordBody,
  updateMeBody,
} from '@school/shared';
import { auth, body } from '../../lib/http.js';
import { forbidden } from '../../lib/errors.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/session.js';
import * as service from './auth.service.js';

export const authRouter = Router();

const client = (req: Request) => ({
  ip: req.ip,
  userAgent: req.get('user-agent'),
  requestId: req.requestId,
});

const loginLimit = rateLimit({ name: 'login', windowMs: 15 * 60 * 1000, max: 30 });
const tokenLimit = rateLimit({ name: 'token', windowMs: 15 * 60 * 1000, max: 30 });
const forgotLimit = rateLimit({ name: 'forgot', windowMs: 60 * 60 * 1000, max: 10 });

authRouter.post('/auth/login', loginLimit, async (req, res) => {
  const input = body(req, loginBody);
  const { token } = await service.login(input.email, input.password, client(req));
  // A tab that signs in again replaces its own previous session rather than leaving it alive.
  if (req.auth) await service.logout(req.auth.sessionId);
  res.json({ data: { token } });
});

authRouter.post('/auth/logout', requireAuth, async (req, res) => {
  await service.logout(auth(req).sessionId);
  res.status(204).end();
});

authRouter.get('/auth/me', requireAuth, async (req, res) => {
  res.json({ data: await service.getMe(auth(req).userId) });
});

authRouter.patch('/auth/me', requireAuth, async (req, res) => {
  const a = auth(req);
  if (a.role === 'TEACHER') throw forbidden();
  const { fullName } = body(req, updateMeBody);
  await service.updateOwnName(a.userId, a.schoolId, fullName, req.requestId);
  res.json({ data: await service.getMe(a.userId) });
});

authRouter.post('/auth/invitations/validate', tokenLimit, async (req, res) => {
  const { token } = body(req, invitationValidateBody);
  res.json({ data: await service.validateInvitation(token) });
});

authRouter.post('/auth/invitations/accept', tokenLimit, async (req, res) => {
  const input = body(req, invitationAcceptBody);
  const { token } = await service.acceptInvitation(input, client(req));
  if (req.auth) await service.logout(req.auth.sessionId);
  res.json({ data: { token } });
});

authRouter.post('/auth/password/forgot', forgotLimit, async (req, res) => {
  const { email } = body(req, forgotPasswordBody);
  await service.forgotPassword(email, client(req));
  res.status(202).json({
    data: {
      message:
        'If an active account uses that email, a reset link has been sent. It expires in 60 minutes.',
    },
  });
});

authRouter.post('/auth/password/reset', tokenLimit, async (req, res) => {
  const input = body(req, resetPasswordBody);
  await service.resetPassword(input, client(req));
  res.json({
    data: { message: 'Your password has been changed. Sign in with your new password.' },
  });
});

authRouter.post('/auth/password/change', requireAuth, async (req, res) => {
  const a = auth(req);
  await service.changePassword(a.userId, a.sessionId, body(req, changePasswordBody), client(req));
  res.json({ data: { message: 'Your password has been changed.' } });
});
