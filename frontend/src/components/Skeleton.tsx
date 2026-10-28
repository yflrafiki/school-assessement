import type { ReactNode } from 'react';

/**
 * Placeholder blocks shown while content loads, in the shape of what is coming.
 * The pulse respects "reduce motion" settings; screen readers hear one "Loading" message.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`block rounded bg-line/70 motion-safe:animate-pulse ${className}`}
    />
  );
}

function Loading({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={className}>
      <span className="sr-only">{label}…</span>
      {children}
    </div>
  );
}

/** Rows of a table or list: the default for data pages. */
export function SkeletonRows({
  rows = 6,
  columns = 4,
  label = 'Loading',
}: {
  rows?: number;
  columns?: number;
  label?: string;
}) {
  const widths = ['w-2/5', 'w-1/4', 'w-1/3', 'w-1/5', 'w-1/4', 'w-1/6'];
  return (
    <Loading label={label}>
      <div className="hidden gap-4 border-b border-line bg-canvas px-3 py-2.5 md:flex">
        {Array.from({ length: columns }, (_, c) => (
          <Skeleton key={c} className="h-3 flex-1" />
        ))}
      </div>
      <ul className="divide-y divide-line">
        {Array.from({ length: rows }, (_, r) => (
          <li
            key={r}
            className="flex flex-col gap-2 px-3 py-3.5 md:flex-row md:items-center md:gap-4"
          >
            {Array.from({ length: columns }, (_, c) => (
              <span key={c} className="md:flex-1">
                <Skeleton
                  className={`h-3.5 ${c === 0 ? 'w-3/4' : (widths[(r + c) % widths.length] ?? 'w-1/3')} ${c > 1 ? 'hidden md:block' : ''}`}
                />
                {c === 0 && <Skeleton className="mt-2 h-3 w-1/2" />}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </Loading>
  );
}

/** A row of figure cards, as on the overview pages. */
export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card px-4 py-3">
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="mt-3 h-7 w-1/3" />
          <Skeleton className="mt-2 h-3 w-3/4" />
        </div>
      ))}
    </div>
  );
}

/** A bordered section with a title bar and rows, like <Section>. */
export function SkeletonSection({
  rows = 4,
  className = '',
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className={`card ${className}`}>
      <div className="border-b border-line px-4 py-3.5">
        <Skeleton className="h-3.5 w-1/3" />
      </div>
      <ul className="divide-y divide-line">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="flex items-center justify-between gap-4 px-4 py-3.5">
            <span className="flex-1">
              <Skeleton className="h-3.5 w-3/5" />
              <Skeleton className="mt-2 h-3 w-2/5" />
            </span>
            <Skeleton className="h-6 w-20" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Headmaster overview: figure cards above two sections. */
export function HeadOverviewSkeleton() {
  return (
    <Loading label="Loading the overview" className="space-y-5">
      <SkeletonCards />
      <div className="grid gap-5 lg:grid-cols-2">
        <SkeletonSection rows={5} />
        <SkeletonSection rows={5} />
      </div>
    </Loading>
  );
}

/** Teacher overview: today's lessons beside the class list. */
export function TeacherOverviewSkeleton() {
  return (
    <Loading label="Loading your overview" className="grid gap-5 lg:grid-cols-3">
      <SkeletonSection rows={4} className="lg:col-span-2" />
      <SkeletonSection rows={3} />
    </Loading>
  );
}

/** The whole app frame (sidebar, header, page), shown while the session is checked. */
export function AppShellSkeleton() {
  return (
    <Loading label="Opening your account" className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col bg-nav lg:flex">
        <div className="border-b border-white/10 px-4 py-4">
          <span className="block h-3.5 w-2/3 rounded bg-white/15 motion-safe:animate-pulse" />
          <span className="mt-2 block h-3 w-1/2 rounded bg-white/10 motion-safe:animate-pulse" />
        </div>
        <div className="space-y-2 px-3 py-4">
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className="block h-8 rounded-md bg-white/10 motion-safe:animate-pulse" />
          ))}
        </div>
      </aside>
      <div className="flex h-14 items-center justify-between border-b border-line bg-surface px-4">
        <Skeleton className="h-4 w-32 lg:hidden" />
        <Skeleton className="ml-auto h-8 w-8 rounded-md" />
      </div>
      <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
        <div>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="mt-2 h-3.5 w-72 max-w-full" />
        </div>
        <SkeletonCards />
        <SkeletonSection rows={5} />
      </div>
    </Loading>
  );
}
