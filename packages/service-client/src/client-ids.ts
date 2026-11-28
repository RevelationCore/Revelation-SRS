/**
 * Each service's Keycloak client for a tenant (ADR-029, ADR-032). Code
 * constants, not configuration, so the calling service and core cannot
 * drift apart. Core binds each service role to its client in
 * packages/auth (SERVICE_ROLE_CLIENTS).
 */

export function wellbeingServiceClientId(tenantId: string): string {
  return `srs-wellbeing-svc-${tenantId}`;
}

export function vleConnectorClientId(tenantId: string): string {
  return `srs-vle-svc-${tenantId}`;
}

/** Published development secret for the wellbeing service's demo-tenant client; refused outside development and test. */
export const DEFAULT_DEV_WELLBEING_CLIENT_SECRET = 'dev-wellbeing-service-secret';

/** Published development secret for the VLE connector's demo-tenant client; refused outside development and test. */
export const DEFAULT_DEV_VLE_CLIENT_SECRET = 'dev-vle-connector-secret';
