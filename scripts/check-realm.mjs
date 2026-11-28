#!/usr/bin/env node
// The Keycloak realm export keeps the token rules the services rely on
// (BL-161, BL-332):
// - realm: access tokens of at most 300 s, refresh-token rotation with no reuse;
// - browser clients (ADR-026, BL-161): confidential (the BFF holds the
//   tokens), redirecting only to /bff/auth/callback with no wildcards, with
//   back-channel logout, and offline_access neither offered nor requested;
// - service clients (ADR-029, ADR-032): srs-wellbeing-svc-<tenant> and
//   srs-vle-svc-<tenant> have a hard-coded tenant_id equal to their suffix,
//   only the srs-api audience, no interactive flows, full scope off, and their
//   service account holds only that service's role.
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const realm = JSON.parse(readFileSync(`${root}infra/compose/keycloak/srs-realm.json`, 'utf8'));
const errors = [];

if (!(realm.accessTokenLifespan <= 300)) errors.push(`realm accessTokenLifespan is ${realm.accessTokenLifespan}, above 300`);
// ADR-026 item 7: SSO limits match the BFF's 30-minute idle and 10-hour absolute session limits.
if (realm.ssoSessionIdleTimeout !== 1800 || realm.ssoSessionMaxLifespan !== 36000) errors.push(`realm SSO session limits must be 1800 s idle and 36000 s maximum (BFF_SESSION_IDLE_SECONDS, BFF_SESSION_MAX_SECONDS), not ${realm.ssoSessionIdleTimeout} and ${realm.ssoSessionMaxLifespan}`);
if (realm.revokeRefreshToken !== true || realm.refreshTokenMaxReuse !== 0) errors.push('realm must rotate refresh tokens with no reuse (revokeRefreshToken, refreshTokenMaxReuse 0)');

const SERVICE = /^srs-(wellbeing|vle)-svc-([0-9a-f-]{36})$/;
const SERVICE_ROLE = { wellbeing: 'wellbeing-service', vle: 'vle-connector-service' };
for (const c of realm.clients) {
  const m = SERVICE.exec(c.clientId);
  if (!m) {
    if (c.standardFlowEnabled) {
      if (c.publicClient !== false) errors.push(`${c.clientId}: browser clients are confidential, behind the BFF (ADR-026)`);
      for (const uri of c.redirectUris ?? []) {
        if (uri.includes('*')) errors.push(`${c.clientId}: wildcard redirect URI ${uri}`);
        if (!uri.endsWith('/bff/auth/callback')) errors.push(`${c.clientId}: redirect URI ${uri} is not the BFF callback`);
      }
      if (!c.attributes?.['backchannel.logout.url'] || c.attributes?.['backchannel.logout.session.required'] !== 'true') errors.push(`${c.clientId}: needs back-channel logout with the session required`);
      const lifespan = Number(c.attributes?.['access.token.lifespan'] ?? realm.accessTokenLifespan);
      if (lifespan > 300) errors.push(`${c.clientId}: access tokens last ${lifespan} s`);
      if ([...(c.defaultClientScopes ?? []), ...(c.optionalClientScopes ?? [])].includes('offline_access')) errors.push(`${c.clientId}: offers offline_access`);
    }
    continue;
  }
  const tenant = m[2];
  const role = SERVICE_ROLE[m[1]];
  const flows = ['standardFlowEnabled', 'implicitFlowEnabled', 'directAccessGrantsEnabled'].filter((k) => c[k]);
  if (flows.length) errors.push(`${c.clientId}: interactive flows on (${flows.join(', ')})`);
  if (c.publicClient !== false || c.serviceAccountsEnabled !== true) errors.push(`${c.clientId}: must be a confidential client with a service account`);
  if (c.fullScopeAllowed !== false) errors.push(`${c.clientId}: fullScopeAllowed must be false`);
  if (c.attributes?.['client_credentials.use_refresh_token'] !== 'false') errors.push(`${c.clientId}: must not issue refresh tokens`);
  const tenantClaim = (c.protocolMappers ?? []).find((p) => p.protocolMapper === 'oidc-hardcoded-claim-mapper' && p.config?.['claim.name'] === 'tenant_id');
  if (tenantClaim?.config?.['claim.value'] !== tenant) errors.push(`${c.clientId}: hard-coded tenant_id must be ${tenant}`);
  const audiences = (c.protocolMappers ?? []).filter((p) => p.protocolMapper === 'oidc-audience-mapper').map((p) => p.config?.['included.custom.audience']);
  if (JSON.stringify(audiences) !== JSON.stringify(['srs-api'])) errors.push(`${c.clientId}: audiences must be exactly srs-api, not ${audiences.join(', ')}`);
  if ((c.protocolMappers ?? []).some((p) => p.config?.['claim.name'] === 'srs_person_id')) errors.push(`${c.clientId}: must not map srs_person_id`);
  const user = (realm.users ?? []).find((u) => u.serviceAccountClientId === c.clientId);
  if (JSON.stringify(user?.realmRoles ?? []) !== JSON.stringify([role])) errors.push(`${c.clientId}: its service account must hold only ${role}`);
  const scope = (realm.scopeMappings ?? []).find((s) => s.client === c.clientId);
  if (JSON.stringify(scope?.roles ?? []) !== JSON.stringify([role])) errors.push(`${c.clientId}: its scope must map only ${role}`);
}

// The BFF must not ask for offline_access either (BL-159, ADR-026).
const oidc = readFileSync(`${root}apps/bff/src/oidc.ts`, 'utf8');
if (/scope:\s*'[^']*offline_access/.test(oidc)) errors.push('apps/bff/src/oidc.ts requests offline_access');

if (errors.length) {
  console.error(`check:realm found ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`check:realm ok: ${realm.clients.length} clients (${realm.clients.filter((c) => SERVICE.test(c.clientId)).length} service), token rules hold`);
