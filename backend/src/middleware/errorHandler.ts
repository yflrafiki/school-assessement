import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '@school/shared';
import { logger } from '../config/logger.js';
import { AppError, isUniqueViolation } from '../lib/errors.js';

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new AppError('NOT_FOUND', 'Route not found'));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let appError: AppError;
  let status: number | undefined;

  if (err instanceof AppError) {
    appError = err;
  } else if (err?.type === 'entity.parse.failed') {
    appError = new AppError('VALIDATION_ERROR', 'The request body is not valid JSON');
    status = 400;
  } else if (err?.type === 'entity.too.large') {
    appError = new AppError('VALIDATION_ERROR', 'The request body is too large');
  } else if (isUniqueViolation(err)) {
    appError = new AppError('CONFLICT', 'This conflicts with an existing record');
  } else if (err instanceof ZodError) {
    // Data that failed validation deeper in a service is still the caller's input, not a crash.
    const fields: Record<string, string[]> = {};
    for (const issue of err.issues)
      (fields[issue.path.join('.') || '_'] ??= []).push(issue.message);
    appError = new AppError('VALIDATION_ERROR', 'Some of the data is not valid', { fields });
  } else {
    appError = new AppError('INTERNAL_ERROR', 'Something went wrong. Please try again.');
  }

  // The full error (with stack) goes to the logs; the response never contains internals.
  if (appError.status >= 500) {
    logger.error({ err, requestId: req.requestId, path: req.path }, 'Unhandled error');
  }

  const body: ApiErrorBody = {
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details === undefined ? {} : { details: appError.details }),
      requestId: req.requestId,
    },
  };
  res.status(status ?? appError.status).json(body);
};
