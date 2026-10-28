import { ERROR_STATUS, type ErrorCode } from '@school/shared';

export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.status = ERROR_STATUS[code];
  }
}

export const notFound = (what = 'Resource') => new AppError('NOT_FOUND', `${what} not found`);
export const forbidden = () => new AppError('FORBIDDEN', 'You do not have permission to do this');
export const conflict = (message: string, details?: unknown) =>
  new AppError('CONFLICT', message, details);
export const unauthenticated = (message = 'Please sign in') =>
  new AppError('UNAUTHENTICATED', message);
export const validation = (
  fields: Record<string, string[]>,
  message = 'Please check the highlighted fields',
) => new AppError('VALIDATION_ERROR', message, { fields });

/** Prisma unique violation, used to translate races into clean 409s. */
export function isUniqueViolation(err: unknown, target?: string): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: string; meta?: { target?: unknown }; message?: string };
  if (e.code !== 'P2002') return false;
  if (!target) return true;
  return JSON.stringify(e.meta ?? '').includes(target) || (e.message ?? '').includes(target);
}

/** PostgreSQL exclusion constraint violation (23P01), surfaced through the driver adapter. */
export function isExclusionViolation(err: unknown, constraint?: string): boolean {
  const text = errorText(err);
  if (!text.includes('23P01') && !text.toLowerCase().includes('exclusion constraint')) return false;
  return !constraint || text.includes(constraint);
}

function errorText(err: unknown): string {
  try {
    return `${String(err)} ${JSON.stringify(err)}`;
  } catch {
    return String(err);
  }
}
