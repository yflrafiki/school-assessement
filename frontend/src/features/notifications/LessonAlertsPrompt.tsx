import { useState } from 'react';
import { FiBell } from 'react-icons/fi';

/**
 * Offers the computer's own notifications for lesson reminders, so a teacher working in
 * another window still sees them. Shown only while the browser has not been asked yet; the
 * in-page pop-up and the bell work either way.
 */
export function LessonAlertsPrompt() {
  const supported = typeof Notification !== 'undefined';
  const [permission, setPermission] = useState(supported ? Notification.permission : 'denied');
  if (!supported || permission !== 'default') return null;

  return (
    <div className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-accent/30 bg-accent-soft px-4 py-3 text-sm">
      <FiBell className="h-4 w-4 shrink-0 text-accent" aria-hidden />
      <p className="min-w-0 flex-1">
        You get a reminder 10 minutes before each lesson. Allow notifications to see it even when
        this page is in the background.
      </p>
      <button
        type="button"
        className="btn-primary h-8 text-xs"
        onClick={() => void Notification.requestPermission().then(setPermission)}
      >
        Allow notifications
      </button>
    </div>
  );
}
