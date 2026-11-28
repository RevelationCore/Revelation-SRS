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
  /** The client the token was issued to (`azp`): for a service, its tenant-bound client (ADR-029). */
  authorizedParty?: string;
  /**
   * SRS person UUID from the srs_person_id JWT claim: present for anyone with
   * an SRS person row (students, applicants, supervisors, examiners), set by
   * IAM (Phase 5 D-38, ADR-025). Self-service scoping always matches it to
   * database rows, never `sub` or email.
   */
  srsPersonId?: string;
  /**
   * ADR-031 item 9: the srs_person_id the token was issued with, kept when it
   * names a person since merged and srsPersonId has been resolved to the
   * survivor. Absent otherwise.
   */
  srsPersonIdAsIssued?: string;
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
