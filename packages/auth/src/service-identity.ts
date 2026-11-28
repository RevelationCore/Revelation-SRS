/**
 * Service identity (ADR-029, pattern P-24).
 *
 * A service calling another service authenticates as itself, through a
 * client-credentials client that Keycloak binds to one tenant. The tenant
 * comes only from the verified token. A service role is honoured only on a
 * token whose authorised party (`azp`) is that service's own client for the
 * token's tenant, and that names no person; anything else loses the role.
 */

import { vleConnectorClientId, wellbeingServiceClientId } from '@revelation-srs/service-client';

/** The wellbeing service's role for its two hand-offs to core. */
export const WELLBEING_SERVICE_ROLE = 'wellbeing-service';

/** The VLE connector's role (ADR-032): registrations, mark passback and adjustment replies, VLE only. */
export const VLE_CONNECTOR_SERVICE_ROLE = 'vle-connector-service';

/** Each service role, and the function naming the only client that may carry it for a tenant. */
export const SERVICE_ROLE_CLIENTS: Readonly<Record<string, (tenantId: string) => string>> = {
  [WELLBEING_SERVICE_ROLE]: wellbeingServiceClientId,
  [VLE_CONNECTOR_SERVICE_ROLE]: vleConnectorClientId,
};

export interface ServiceRoleContext {
  tenantId:     string;
  /** The token's `azp` claim. */
  azp?:         string | undefined;
  /** The token's `srs_person_id` claim: a person's token never carries a service role. */
  srsPersonId?: string | undefined;
}

/**
 * Keeps each service role only when the token was issued to that role's
 * own client for the token's tenant and names no person. Returns the roles
 * to honour and the ones dropped (for a warning; never log the token).
 */
export function bindServiceRoles(roles: readonly string[], ctx: ServiceRoleContext): { roles: string[]; dropped: string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const role of roles) {
    const clientFor = SERVICE_ROLE_CLIENTS[role];
    if (!clientFor) { kept.push(role); continue; }
    if (!ctx.srsPersonId && ctx.azp !== undefined && ctx.azp === clientFor(ctx.tenantId)) kept.push(role);
    else dropped.push(role);
  }
  return { roles: kept, dropped };
}
