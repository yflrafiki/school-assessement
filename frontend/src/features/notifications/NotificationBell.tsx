import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { FiBell } from 'react-icons/fi';
import { api, type One } from '../../lib/api';

export const unreadKey = ['notifications', 'unread-count'] as const;

/**
 * Unread count. Live updates normally refresh it the instant something arrives; the timer is
 * only a safety net, checked rarely while the live connection is up and every 30 s if it is not.
 */
export function useUnreadCount(live = false) {
  return useQuery({
    queryKey: unreadKey,
    queryFn: () =>
      api.get<One<{ count: number }>>('/notifications/unread-count').then((r) => r.data.count),
    refetchInterval: live ? 120_000 : 30_000,
  });
}

export function NotificationBell({ to, live = false }: { to: string; live?: boolean }) {
  const { data: count = 0 } = useUnreadCount(live);
  const label = count ? `Notifications, ${count} unread` : 'Notifications';
  return (
    <Link
      to={to}
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted hover:bg-canvas hover:text-ink"
      aria-label={label}
      title={label}
    >
      <FiBell className="h-5 w-5" aria-hidden />
      {count > 0 && (
        <span
          className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-bad px-1 text-center text-[11px] font-semibold leading-[18px] text-white"
          aria-hidden
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}
