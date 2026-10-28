import type { ReactNode } from 'react';
import { FiAlertTriangle, FiInbox, FiLock } from 'react-icons/fi';
import { ApiError } from '../lib/api';
import { SkeletonRows } from './Skeleton';

/** Loading placeholder for data pages: skeleton rows in the shape of a table or list. */
export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return <SkeletonRows label={label} />;
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-4 py-12 text-center">
      <FiInbox className="mb-3 h-6 w-6 text-muted" aria-hidden />
      <p className="font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (error instanceof ApiError && error.status === 403) return <ForbiddenState />;
  const message =
    error instanceof ApiError ? error.message : 'Something went wrong while loading this page.';
  return (
    <div role="alert" className="flex flex-col items-center px-4 py-12 text-center">
      <FiAlertTriangle className="mb-3 h-6 w-6 text-bad" aria-hidden />
      <p className="font-medium text-ink">Could not load this</p>
      <p className="mt-1 max-w-md text-sm text-muted">{message}</p>
      {error instanceof ApiError && error.requestId && (
        <p className="mt-1 text-xs text-muted">Reference: {error.requestId}</p>
      )}
      {onRetry && (
        <button type="button" className="btn-secondary mt-4" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function ForbiddenState() {
  return (
    <div className="flex flex-col items-center px-4 py-12 text-center">
      <FiLock className="mb-3 h-6 w-6 text-muted" aria-hidden />
      <p className="font-medium text-ink">You do not have access to this page</p>
      <p className="mt-1 text-sm text-muted">Ask your headmaster if you think you should.</p>
    </div>
  );
}

interface QueryLike<T> {
  data: T | undefined;
  error: unknown;
  isPending: boolean;
  refetch: () => unknown;
}

/**
 * Renders a skeleton while a query loads, an error with retry if it fails, and the children
 * once data is there. Pass `skeleton` when the page has its own shape (dashboards, forms).
 */
export function QueryView<T>({
  query,
  children,
  label,
  skeleton,
}: {
  query: QueryLike<T>;
  children: (data: T) => ReactNode;
  label?: string;
  skeleton?: ReactNode;
}) {
  if (query.isPending) return skeleton ?? <LoadingState {...(label ? { label } : {})} />;
  if (query.error || query.data === undefined)
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <>{children(query.data)}</>;
}

export function Alert({
  tone = 'bad',
  children,
}: {
  tone?: 'bad' | 'warn' | 'ok' | 'info';
  children: ReactNode;
}) {
  const classes = {
    bad: 'border-bad/30 bg-bad-soft text-bad',
    warn: 'border-warn/30 bg-warn-soft text-warn',
    ok: 'border-ok/30 bg-ok-soft text-ok',
    info: 'border-accent/30 bg-accent-soft text-accent',
  }[tone];
  return (
    <div
      role={tone === 'bad' ? 'alert' : 'status'}
      className={`rounded-md border px-3 py-2 text-sm ${classes}`}
    >
      {children}
    </div>
  );
}
