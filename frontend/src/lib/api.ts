import type { ApiErrorBody, ErrorCode, PageMeta } from '@school/shared';

/** Error thrown for every non-2xx response, carrying the server's code and field errors. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK_ERROR',
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
  }

  get fields(): Record<string, string[]> {
    const d = this.details as { fields?: Record<string, string[]> } | undefined;
    return d?.fields ?? {};
  }
}

/**
 * The session token lives in sessionStorage, which the browser keeps separate for every tab.
 * That is what lets a headmaster and a teacher be signed in side by side in two tabs.
 * A refresh keeps the tab signed in; closing the tab forgets it.
 */
const SESSION_KEY = 'teaching-monitor.session';
let onUnauthenticated: (() => void) | undefined;

export function getSessionToken(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function setSessionToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(SESSION_KEY, token);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage blocked (for example strict privacy settings): the tab simply stays signed out.
  }
}

/** Registered by the app shell: clears the session and sends the user to sign in. */
export function setUnauthenticatedHandler(handler: () => void) {
  onUnauthenticated = handler;
}

type Query = Record<string, string | number | boolean | undefined | null>;

export function toQueryString(query?: Query): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getSessionToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`/api/v1${path}${toQueryString(query)}`, {
      method,
      headers,
      credentials: 'omit',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Cannot reach the server. Check your connection and try again.',
    );
  }

  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => null)) as (ApiErrorBody & T) | null;
  if (!res.ok) {
    const err = json?.error;
    const apiError = new ApiError(
      res.status,
      err?.code ?? 'INTERNAL_ERROR',
      err?.message ?? 'Something went wrong. Please try again.',
      err?.details,
      err?.requestId,
    );
    if (res.status === 401 && token) {
      // Expired or revoked (idle timeout, deactivation, password reset): forget it in this tab.
      setSessionToken(null);
      if (!path.startsWith('/auth/')) onUnauthenticated?.();
    }
    throw apiError;
  }
  return json as T;
}

export interface One<T> {
  data: T;
}
export interface Page<T> {
  data: T[];
  meta: PageMeta;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>('GET', path, undefined, query),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown = {}) => request<T>('PATCH', path, body),
  delete: <T = void>(path: string) => request<T>('DELETE', path),
};
