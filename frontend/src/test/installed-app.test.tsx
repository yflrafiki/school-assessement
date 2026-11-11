import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getSessionToken, setSessionToken } from '../lib/api';
import { watchInstallOffer } from '../lib/installedApp';
import { InstallAppBanner, OfflineBanner } from '../features/install/AppBanners';

/** Pretends the page runs as the installed app (or not). */
function asInstalledApp(installed: boolean) {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: installed && query === '(display-mode: standalone)',
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  setSessionToken(null);
  localStorage.clear();
  sessionStorage.clear();
});

describe('staying signed in', () => {
  it('keeps the sign-in per tab in a browser', () => {
    asInstalledApp(false);
    setSessionToken('tab-token');
    expect(sessionStorage.getItem('teaching-monitor.session')).toBe('tab-token');
    expect(localStorage.getItem('teaching-monitor.session')).toBeNull();
  });

  it('keeps it across reopening in the installed app, and forgets it on sign-out', () => {
    asInstalledApp(true);
    setSessionToken('app-token');
    expect(localStorage.getItem('teaching-monitor.session')).toBe('app-token');
    expect(getSessionToken()).toBe('app-token');
    setSessionToken(null);
    expect(localStorage.getItem('teaching-monitor.session')).toBeNull();
  });
});

describe('install banner', () => {
  it('offers the browser install dialog when there is one, and can be dismissed for good', async () => {
    asInstalledApp(false);
    watchInstallOffer();
    const prompt = vi.fn(async () => {});
    render(<InstallAppBanner />);
    expect(screen.queryByText(/Install the app/)).toBeNull();

    const offer = Object.assign(new Event('beforeinstallprompt'), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    });
    act(() => {
      window.dispatchEvent(offer);
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Install' }));
    expect(prompt).toHaveBeenCalled();

    window.dispatchEvent(
      Object.assign(new Event('beforeinstallprompt'), {
        prompt,
        userChoice: Promise.resolve({ outcome: 'dismissed' as const }),
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(screen.queryByText(/Install the app/)).toBeNull();
    expect(localStorage.getItem('teaching-monitor.install-dismissed')).toBe('1');
  });

  it('is not shown inside the installed app', () => {
    asInstalledApp(true);
    vi.stubGlobal('navigator', { ...navigator, userAgent: 'iPhone' });
    render(<InstallAppBanner />);
    expect(screen.queryByText(/Install the app/)).toBeNull();
  });

  it('gives iPhone users the Share-menu steps', () => {
    asInstalledApp(false);
    vi.stubGlobal('navigator', { ...navigator, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS)' });
    render(<InstallAppBanner />);
    expect(screen.getByText(/Add to Home Screen/)).toBeInTheDocument();
  });
});

describe('offline notice', () => {
  it('appears when the connection drops and goes when it returns', () => {
    render(<OfflineBanner />);
    expect(screen.queryByText(/No internet connection/)).toBeNull();
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByText(/No internet connection/)).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByText(/No internet connection/)).toBeNull();
  });
});
