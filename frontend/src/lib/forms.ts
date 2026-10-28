import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from './api';

/**
 * Maps server field errors onto the form. Returns the message for anything that
 * is not tied to a field, so the form can show it above the submit button.
 */
export function applyServerErrors<T extends FieldValues>(
  err: unknown,
  setError: UseFormSetError<T>,
  knownFields: readonly string[],
): string | null {
  if (!(err instanceof ApiError)) return 'Something went wrong. Please try again.';
  const unmatched: string[] = [];
  for (const [field, messages] of Object.entries(err.fields)) {
    const root = field.split('.')[0] ?? field;
    if (knownFields.includes(root)) {
      setError(root as Path<T>, { type: 'server', message: messages.join(' ') });
    } else {
      unmatched.push(...messages);
    }
  }
  if (unmatched.length) return unmatched.join(' ');
  return Object.keys(err.fields).length ? null : err.message;
}

export function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';
}

/** The error message plus any field messages, for forms that show one summary line. */
export function fullErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return errorMessage(err);
  const fields = Object.values(err.fields).flat();
  return fields.length ? fields.join(' ') : err.message;
}
