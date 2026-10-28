import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Me, Permission } from '@school/shared';
import { ApiError, api, getSessionToken, type One } from '../../lib/api';

export const meKey = ['auth', 'me'] as const;

export async function fetchMe(): Promise<Me | null> {
  // A tab without its own token is signed out, whatever other tabs are doing.
  if (!getSessionToken()) return null;
  try {
    const res = await api.get<One<Me>>('/auth/me');
    return res.data;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export function useMe() {
  return useQuery({ queryKey: meKey, queryFn: fetchMe, staleTime: 5 * 60 * 1000, retry: false });
}

/** The signed-in user. Only use inside routes guarded by RequireAuth. */
export function useCurrentUser(): Me {
  const { data } = useMe();
  if (!data) throw new Error('useCurrentUser used outside an authenticated route');
  return data;
}

export function useCan(permission: Permission): boolean {
  const { data } = useMe();
  return !!data?.permissions.includes(permission);
}

export function useRefreshMe() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: meKey });
}
