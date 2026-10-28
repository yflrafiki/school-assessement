import type { RequestHandler } from 'express';
import { ROLE_PERMISSIONS, type Permission, type Role } from '@school/shared';
import { AppError } from '../lib/errors.js';

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) return next(new AppError('UNAUTHENTICATED', 'Please sign in'));
    if (!roles.includes(req.auth.role))
      return next(new AppError('FORBIDDEN', 'You do not have permission to do this'));
    next();
  };
}

export function requirePermission(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) return next(new AppError('UNAUTHENTICATED', 'Please sign in'));
    if (!ROLE_PERMISSIONS[req.auth.role].includes(permission)) {
      return next(new AppError('FORBIDDEN', 'You do not have permission to do this'));
    }
    next();
  };
}
