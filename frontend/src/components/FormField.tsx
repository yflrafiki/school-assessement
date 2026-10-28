import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';

/**
 * Label, control, hint and error with the right ids and aria attributes.
 * The single child is the input, select or textarea.
 */
export function FormField({
  label,
  error,
  hint,
  children,
  required,
}: {
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
  children: ReactElement;
  required?: boolean;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
      })
    : children;
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
        {required && <span className="text-bad"> *</span>}
      </label>
      {control}
      {hint && !error && (
        <p id={hintId} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-xs text-bad">
          {error}
        </p>
      )}
    </div>
  );
}
