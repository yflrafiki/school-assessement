import type { ReactNode } from 'react';

/**
 * Submit button that makes a request in flight obvious: a spinner, the pending label,
 * disabled against double submits, and announced to screen readers through aria-busy.
 */
export function SubmitButton({
  pending,
  pendingLabel,
  children,
  className = 'btn-primary',
}: {
  pending: boolean;
  pendingLabel: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending && (
        <span
          aria-hidden
          className="h-4 w-4 shrink-0 rounded-full border-2 border-white/40 border-t-white motion-safe:animate-spin"
        />
      )}
      {pending ? pendingLabel : children}
    </button>
  );
}
