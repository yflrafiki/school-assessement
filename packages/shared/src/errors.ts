export const ERROR_CODES = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'WEEK_LOCKED',
  'DUPLICATE_TEACHING_RECORD',
  'CONFLICT',
  'INVITATION_INVALID',
  'TOKEN_INVALID',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  WEEK_LOCKED: 409,
  DUPLICATE_TEACHING_RECORD: 409,
  CONFLICT: 409,
  INVITATION_INVALID: 400,
  TOKEN_INVALID: 400,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export interface FieldErrorDetails {
  fields: Record<string, string[]>;
}

export interface WeekLockedDetails {
  requestedWeek: number;
  blockingWeek: number;
  outstandingLessons: { id: string; date: string; startTime: string }[];
}
