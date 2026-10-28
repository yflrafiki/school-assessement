import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Filters, search and paging live in the URL so pages are bookmarkable and the
 * back button works. Changing any filter resets to page 1.
 */
export function useUrlState<K extends string>(keys: readonly K[]) {
  const [params, setParams] = useSearchParams();

  const values = useMemo(() => {
    const out = {} as Record<K | 'page', string>;
    for (const k of keys) out[k] = params.get(k) ?? '';
    out.page = params.get('page') ?? '1';
    return out;
  }, [params, keys]);

  const set = useCallback(
    (patch: Partial<Record<K | 'page', string>>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch) as [string, string | undefined][]) {
            if (v) next.set(k, v);
            else next.delete(k);
          }
          if (!('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const clear = useCallback(() => setParams(new URLSearchParams(), { replace: true }), [setParams]);

  return { values, set, clear, page: Number(values.page) || 1 };
}
