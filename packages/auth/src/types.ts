import type { TenantScopedDb } from '@revelation-srs/db';
import type { Role } from '@revelation-srs/domain';

/** Parsed JWT claims attached to every authenticated request. */
export interface AuthenticatedUser {
  /** Keycloak subject (UUID). */
  sub: string;
  /** Tenant UUID - from the custom `tenant_id` claim added by Keycloak mapper. */
  tenantId: string;
  /** Realm roles assigned to the user. */
  roles: Role[];
  /** Display name from `name` claim. */
  displayName: string;
  /** Email address. */
  email: string;
  /** Raw `preferred_username` claim. */
  preferredUsername: string;
  /** SRS person UUID — present only for student personas (from srs_person_id JWT claim). */
  srsPersonId?: string;
}

/** Fastify module augmentation so request.user is typed throughout the app. */
declare module 'fastify' {
  interface FastifyRequest {
    user: AuthenticatedUser;
    tenantId: string;
    withDb<T>(fn: (db: TenantScopedDb) => Promise<T>): Promise<T>;
  }
  interface FastifyContextConfig {
    skipAuth?: boolean;
  }
}
