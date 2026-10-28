import { useEffect, useId, useState, type ReactNode } from 'react';
import { FiChevronLeft, FiChevronRight, FiSearch, FiX } from 'react-icons/fi';
import type { PageMeta } from '@school/shared';
import { useDebounced } from '../lib/useDebounced';

/** Search box that reports its value after the user pauses typing. */
export function SearchInput({
  value,
  onChange,
  placeholder,
  label = 'Search',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
}) {
  const [text, setText] = useState(value);
  const [lastValue, setLastValue] = useState(value);
  const debounced = useDebounced(text, 300);
  const id = useId();

  // Follow outside changes (for example "Clear filters") without an extra effect.
  if (value !== lastValue) {
    setLastValue(value);
    setText(value);
  }
  useEffect(() => {
    if (debounced !== value) onChange(debounced);
    // Only react to the debounced text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  return (
    <div className="relative min-w-0 flex-1 sm:max-w-xs">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <FiSearch
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
        aria-hidden
      />
      <input
        id={id}
        type="search"
        className="input pl-9"
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
      />
    </div>
  );
}

export interface Option {
  value: string;
  label: string;
}

export function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel = 'All',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  allLabel?: string;
}) {
  const id = useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        className="input w-auto max-w-full pr-8"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title={label}
      >
        <option value="">
          {label}: {allLabel}
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function FilterBar({
  children,
  onClear,
  active,
}: {
  children: ReactNode;
  onClear?: () => void;
  active?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
      {children}
      {onClear && active && (
        <button type="button" className="btn-ghost" onClick={onClear}>
          <FiX aria-hidden /> Clear filters
        </button>
      )}
    </div>
  );
}

export function Pagination({ meta, onPage }: { meta: PageMeta; onPage: (page: number) => void }) {
  if (meta.total === 0) return null;
  const from = (meta.page - 1) * meta.pageSize + 1;
  const to = Math.min(meta.total, meta.page * meta.pageSize);
  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-muted"
    >
      <span>
        {from}–{to} of {meta.total}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="btn-secondary px-2"
          disabled={meta.page <= 1}
          onClick={() => onPage(meta.page - 1)}
          aria-label="Previous page"
        >
          <FiChevronLeft aria-hidden />
        </button>
        <span className="px-2">
          Page {meta.page} of {meta.totalPages}
        </span>
        <button
          type="button"
          className="btn-secondary px-2"
          disabled={meta.page >= meta.totalPages}
          onClick={() => onPage(meta.page + 1)}
          aria-label="Next page"
        >
          <FiChevronRight aria-hidden />
        </button>
      </div>
    </nav>
  );
}
