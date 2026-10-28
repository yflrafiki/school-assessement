import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { relativeTime } from '../../lib/format';
import { PageHeader, Section } from '../../components/PageHeader';
import { EmptyState, QueryView } from '../../components/States';
import type { Notification } from '../../types/api';
import { unreadKey } from './NotificationBell';

interface NotificationPage {
  data: Notification[];
  meta: { nextCursor: string | null };
}

export function NotificationsPage({ area }: { area: 'teacher' | 'headmaster' }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const query = useInfiniteQuery({
    queryKey: ['notifications', 'list'],
    queryFn: ({ pageParam }) =>
      api.get<NotificationPage>('/notifications', { cursor: pageParam, limit: 20 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['notifications'] });
    void qc.invalidateQueries({ queryKey: unreadKey });
  };
  const markRead = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`),
    onSuccess: refresh,
  });
  const markAll = useMutation({
    mutationFn: () => api.patch('/notifications/read-all'),
    onSuccess: refresh,
  });

  function open(n: Notification) {
    if (!n.readAt) markRead.mutate(n.id);
    if (n.recordId)
      navigate(
        area === 'headmaster' ? `/h/activity?record=${n.recordId}` : `/t/records/${n.recordId}`,
      );
  }

  const items = query.data?.pages.flatMap((p) => p.data) ?? [];
  const hasUnread = items.some((n) => !n.readAt);

  return (
    <>
      <PageHeader
        title="Notifications"
        actions={
          <button
            type="button"
            className="btn-secondary"
            disabled={!hasUnread || markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            Mark all as read
          </button>
        }
      />
      <Section>
        <QueryView query={{ ...query, data: query.data }}>
          {() =>
            items.length ? (
              <>
                <ul className="divide-y divide-line">
                  {items.map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => open(n)}
                        className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-canvas ${n.readAt ? '' : 'bg-accent-soft/40'}`}
                      >
                        <span
                          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? 'bg-transparent' : 'bg-accent'}`}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block text-sm ${n.readAt ? 'text-ink' : 'font-semibold text-ink'}`}
                          >
                            {n.title}
                            {!n.readAt && <span className="sr-only"> (unread)</span>}
                          </span>
                          <span className="block text-sm text-muted">{n.body}</span>
                        </span>
                        <span className="shrink-0 text-xs text-muted">
                          {relativeTime(n.createdAt)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {query.hasNextPage && (
                  <div className="border-t border-line p-3 text-center">
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={query.isFetchingNextPage}
                      onClick={() => void query.fetchNextPage()}
                    >
                      {query.isFetchingNextPage ? 'Loading…' : 'Load older notifications'}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <EmptyState
                title="No notifications"
                description={
                  area === 'headmaster'
                    ? 'You are notified here each time a teacher submits a lesson record.'
                    : 'Notices from the school appear here.'
                }
              />
            )
          }
        </QueryView>
      </Section>
    </>
  );
}
