import { useEffect, useState, useSyncExternalStore } from 'react';
import { FiDownload, FiWifiOff, FiX } from 'react-icons/fi';
import {
  canPromptInstall,
  isAppleMobile,
  isInstalledApp,
  onInstallOfferChange,
  promptInstall,
} from '../../lib/installedApp';

const DISMISSED_KEY = 'teaching-monitor.install-dismissed';

function wasDismissed() {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Offers to install the app on the home screen: the browser's own dialog where there is one
 * (Android, computers), the Share-menu steps on iPhone and iPad. Hidden inside the installed
 * app and once dismissed.
 */
export function InstallAppBanner() {
  const canPrompt = useSyncExternalStore(onInstallOfferChange, canPromptInstall, () => false);
  const [dismissed, setDismissed] = useState(wasDismissed);
  const apple = isAppleMobile();
  if (isInstalledApp() || dismissed || (!canPrompt && !apple)) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Not remembered on this device; it simply shows again next time.
    }
  };

  return (
    <div className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-sm">
      <img src="/icons/icon-192.png" alt="" className="h-10 w-10 shrink-0 rounded-lg" />
      <p className="min-w-0 flex-1">
        <strong className="font-medium">Install the app on this device.</strong>{' '}
        {apple ? (
          <>
            In Safari, tap <strong>Share</strong> (the square with an arrow), then{' '}
            <strong>Add to Home Screen</strong>.
          </>
        ) : (
          'It opens from your home screen like any other app, and keeps you signed in.'
        )}
      </p>
      {canPrompt && (
        <button
          type="button"
          className="btn-primary h-8 text-xs"
          onClick={() => void promptInstall()}
        >
          <FiDownload aria-hidden /> Install
        </button>
      )}
      <button type="button" className="btn-ghost h-8 px-2" onClick={dismiss} aria-label="Not now">
        <FiX aria-hidden />
      </button>
    </div>
  );
}

/** Says plainly when the device has lost its connection; nothing can be loaded or saved then. */
export function OfflineBanner() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  if (online) return null;
  return (
    <div
      role="status"
      className="mb-5 flex items-center gap-3 rounded-lg border border-warn/40 bg-warn-soft px-4 py-3 text-sm"
    >
      <FiWifiOff className="h-4 w-4 shrink-0 text-warn" aria-hidden />
      <p>
        <strong className="font-medium">No internet connection.</strong> Lessons and records load
        and save again as soon as you are back online.
      </p>
    </div>
  );
}
