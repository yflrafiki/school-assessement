import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { Permission, Role } from '@school/shared';
import { setUnauthenticatedHandler } from '../lib/api';
import { meKey, useMe } from '../features/auth/useMe';
import { ErrorState, ForbiddenState, LoadingState } from '../components/States';

export function homeFor(role: Role) {
  return role === 'TEACHER' ? '/t' : '/h';
}

/** Any 401 clears the cached user and returns to sign-in with a return path. */
export function SessionWatcher() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    setUnauthenticatedHandler(() => {
      qc.setQueryData(meKey, null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
      const returnTo = encodeURIComponent(location.pathname + location.search);
      navigate(`/login?returnTo=${returnTo}`, { replace: true });
    });
  }, [qc, navigate, location]);
  return null;
}

export function RequireAuth({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <LoadingState label="Checking your session" />;
  if (me.error) return <ErrorState error={me.error} onRetry={() => void me.refetch()} />;
  if (!me.data) {
    const returnTo = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?returnTo=${returnTo}`} replace />;
  }
  if (!roles.includes(me.data.role)) return <Navigate to={homeFor(me.data.role)} replace />;
  return <>{children}</>;
}

/** Hides a page from roles without the permission. The API enforces it regardless. */
export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const me = useMe();
  if (!me.data?.permissions.includes(permission)) return <ForbiddenState />;
  return <>{children}</>;
}

export function HomeRedirect() {
  const me = useMe();
  if (me.isPending) return <LoadingState />;
  if (!me.data) return <Navigate to="/login" replace />;
  return <Navigate to={homeFor(me.data.role)} replace />;
}
