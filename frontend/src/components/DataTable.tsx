import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
  /** Hidden in the stacked mobile layout when the value is already in the row title. */
  hideOnMobile?: boolean;
}

/**
 * A plain table on wide screens that degrades to stacked rows on small screens.
 * Clicking a row (or pressing Enter on it) calls onRowClick.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  caption,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  caption?: string;
}) {
  const clickable = !!onRowClick;
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="table">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={c.className}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                className={clickable ? 'cursor-pointer hover:bg-canvas' : undefined}
                onClick={clickable ? () => onRowClick(row) : undefined}
                onKeyDown={clickable ? (e) => e.key === 'Enter' && onRowClick(row) : undefined}
                tabIndex={clickable ? 0 : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} className={c.className}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-line md:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)}>
            <div
              className={`px-4 py-3 ${clickable ? 'cursor-pointer active:bg-canvas' : ''}`}
              onClick={clickable ? () => onRowClick(row) : undefined}
              onKeyDown={clickable ? (e) => e.key === 'Enter' && onRowClick(row) : undefined}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
            >
              <dl className="grid grid-cols-[minmax(0,7rem)_1fr] gap-x-3 gap-y-1 text-sm">
                {columns
                  .filter((c) => !c.hideOnMobile)
                  .map((c) => (
                    <div key={c.key} className="contents">
                      <dt className="text-xs text-muted">{c.header}</dt>
                      <dd className="min-w-0 break-words">{c.render(row)}</dd>
                    </div>
                  ))}
              </dl>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
