import type { Request } from 'express';
import type { z } from 'zod';
import type { Role } from '@school/shared';
import { AppError, forbidden, unauthenticated } from './errors.js';

export interface AuthContext {
  userId: string;
  schoolId: string;
  role: Role;
  teacherProfileId: string | null;
  sessionId: string;
  fullName: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthContext;
    }
  }
}

export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fields: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    (fields[key] ??= []).push(issue.message);
  }
  throw new AppError('VALIDATION_ERROR', 'Please check the highlighted fields', { fields });
}

export const body = <S extends z.ZodType>(req: Request, schema: S) => parse(schema, req.body ?? {});
export const query = <S extends z.ZodType>(req: Request, schema: S) => parse(schema, req.query);

export function auth(req: Request): AuthContext {
  if (!req.auth) throw unauthenticated();
  return req.auth;
}

/** Auth context for a teacher; throws FORBIDDEN for other roles. */
export function teacherAuth(req: Request): AuthContext & { teacherProfileId: string } {
  const a = auth(req);
  if (a.role !== 'TEACHER' || !a.teacherProfileId) throw forbidden();
  return a as AuthContext & { teacherProfileId: string };
}

export function idParam(req: Request, name = 'id'): string {
  const value = req.params[name];
  // Malformed ids are indistinguishable from missing ones.
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new AppError('NOT_FOUND', 'Resource not found');
  }
  return value;
}
