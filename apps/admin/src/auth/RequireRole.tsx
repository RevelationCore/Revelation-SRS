import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext.js';
import { Spinner } from '@revelation-srs/ui';

interface RequireRoleProps {
  roles:    string[];
  children: ReactNode;
}

/**
 * Renders children only when the authenticated user holds at least one of the
 * given roles. Redirects to /403 otherwise. Waits for auth to be ready before
 * making a decision so server-side rendering and hard refreshes work correctly.
 */
export function RequireRole({ roles, children }: RequireRoleProps) {
  const { token, roles: userRoles, isReady } = useAuth();

  if (!isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner size="lg" label="Checking permissions…" />
      </div>
    );
  }

  if (!token) return <Navigate to="/login" replace />;

  const allowed = roles.some(r => userRoles.includes(r));
  if (!allowed) return <Navigate to="/403" replace />;

  return <>{children}</>;
}
