import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FiBell, FiX } from 'react-icons/fi';
import type { LiveNotification } from './useLiveNotifications';

const SHOW_MS = 8000;

/** A short pop-up for a notification that just arrived. It hides by itself after a few seconds. */
export function LiveToast({
  notification,
  href,
  onClose,
}: {
  notification: LiveNotification | null;
  href: string | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(onClose, SHOW_MS);
    return () => clearTimeout(timer);
  }, [notification, onClose]);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-20 z-50 flex justify-end md:bottom-6 md:left-auto"
    >
      {notification && (
        <div
          role="status"
          className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border border-line bg-surface p-3 shadow-xl"
        >
          <FiBell className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium text-ink">{notification.title}</p>
            <p className="text-muted">{notification.body}</p>
            {href && (
              <Link to={href} onClick={onClose} className="link mt-1 inline-block">
                Open record
              </Link>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost h-7 px-1.5"
            aria-label="Dismiss notification"
          >
            <FiX aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
