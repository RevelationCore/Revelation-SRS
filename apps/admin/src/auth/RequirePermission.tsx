import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { hasPermission, type Permission, type Role } from '@revelation-srs/domain';
import { Spinner } from '@revelation-srs/ui';

import { useAuth } from './AuthContext.js';

export function userHasAnyPermission(userRoles: string[], permissions: Permission[]): boolean {
  return permissions.some(permission => hasPermission(userRoles as Role[], permission));
}

export function RequirePermission({
  permissions,
  children,
}: {
  permissions: Permission[];
  children: ReactNode;
}) {
  const { token, roles, isReady } = useAuth();

  if (!isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner size="lg" label="Checking permissions…" />
      </div>
    );
  }
  if (!token) return <Navigate to="/login" replace />;
  if (!userHasAnyPermission(roles, permissions)) return <Navigate to="/403" replace />;
  return <>{children}</>;
}

