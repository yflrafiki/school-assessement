/**
 * Accepts a post-sign-in destination only if it is a path on this site. Browsers treat "\" like
 * "/", so "/\evil.com" means "//evil.com" (another site): backslashes, control characters and
 * anything that resolves to a different origin are refused, and the caller falls back to home.
 */
export function safeReturnTo(
  value: string | null,
  origin: string = window.location.origin,
): string | null {
  if (!value || value.length > 500) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin) return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}
