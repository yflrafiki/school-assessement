// The installable app (PWA): detecting it, offering to install it, and its service worker.

/** True when running as the installed app (home-screen icon), not in a browser tab. */
export function isInstalledApp(): boolean {
  try {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

/** Chrome's install offer, kept so a button can show it later. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

/** Listens from start-up: the browser offers installation once, early. */
export function watchInstallOffer() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

export function canPromptInstall(): boolean {
  return deferred !== null;
}

export function onInstallOfferChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Shows the browser's own "Install app?" dialog. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const offer = deferred;
  deferred = null;
  await offer.prompt();
  const { outcome } = await offer.userChoice;
  listeners.forEach((l) => l());
  return outcome === 'accepted';
}

/** iPhones and iPads install from Safari's Share menu; they never send the install offer. */
export function isAppleMobile(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/** Registers the service worker in the built app only (not while developing). */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Without it the site still works; it just cannot be used offline.
    });
  });
}
