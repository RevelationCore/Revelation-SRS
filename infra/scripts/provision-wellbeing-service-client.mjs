#!/usr/bin/env node
// Provisions the wellbeing service's Keycloak client for one or more tenants
// (ADR-029 item 9, BL-329). Idempotent: run it at tenant onboarding and after
// rotating the service key, for one tenant or all of them.
//
//   KEYCLOAK_URL=https://auth.example.com KEYCLOAK_ADMIN_USER=… KEYCLOAK_ADMIN_PASSWORD=… \
//   node infra/scripts/provision-wellbeing-service-client.mjs \
//     --tenant <tenant uuid> [--tenant <uuid> …] \
//     --certificate /path/to/wellbeing-service.crt          # staging and production: private_key_jwt
//   or, in development only: --secret <client secret>       # client_secret_basic
//
// The certificate is the X.509 certificate of the deployment's wellbeing
// service key (kv/srs/wellbeing/service-client in OpenBao). Make one with:
//   openssl req -x509 -key private_key.pem -subj /CN=srs-wellbeing-service -days 400 -out wellbeing-service.crt
// Keycloak never holds the private key.
import { readFileSync } from 'node:fs';

const KC = process.env.KEYCLOAK_URL?.replace(/\/$/, '');
const REALM = process.env.KEYCLOAK_REALM ?? 'srs';
const ROLE = 'wellbeing-service';
if (!KC) fail('KEYCLOAK_URL is not set');

const args = process.argv.slice(2);
const tenants = args.flatMap((a, i) => (a === '--tenant' ? [args[i + 1]] : []));
const certFile = args[args.indexOf('--certificate') + 1] && args.includes('--certificate') ? args[args.indexOf('--certificate') + 1] : undefined;
const secret = args.includes('--secret') ? args[args.indexOf('--secret') + 1] : undefined;
if (tenants.length === 0) fail('name at least one --tenant');
if (!certFile === !secret) fail('give exactly one of --certificate (private_key_jwt) or --secret (development only)');
for (const t of tenants) if (!/^[0-9a-f-]{36}$/.test(t)) fail(`not a tenant UUID: ${t}`);

function fail(message) { console.error(`provision-wellbeing-service-client: ${message}`); process.exit(1); }

/** Same rule as wellbeingServiceClientId in packages/auth. */
const clientIdFor = (tenantId) => `srs-wellbeing-svc-${tenantId}`;

const timeout = () => AbortSignal.timeout(10_000);
let token;
async function adminToken() {
  const body = process.env.KEYCLOAK_ADMIN_CLIENT_SECRET
    ? new URLSearchParams({ grant_type: 'client_credentials', client_id: process.env.KEYCLOAK_ADMIN_CLIENT_ID ?? 'admin-cli', client_secret: process.env.KEYCLOAK_ADMIN_CLIENT_SECRET })
    : new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: process.env.KEYCLOAK_ADMIN_USER ?? '', password: process.env.KEYCLOAK_ADMIN_PASSWORD ?? '' });
  const res = await fetch(`${KC}/realms/master/protocol/openid-connect/token`, { method: 'POST', body, signal: timeout() });
  if (!res.ok) fail(`admin sign-in refused: ${res.status}`);
  return (await res.json()).access_token;
}
async function api(method, path, body) {
  const res = await fetch(`${KC}/admin/realms/${REALM}${path}`, {
    method, signal: timeout(),
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok && res.status !== 409) fail(`${method} ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 || res.status === 201 || res.status === 409 ? null : res.json();
}

const certificate = certFile
  ? readFileSync(certFile, 'utf8').replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '')
  : undefined;

function representation(tenantId) {
  const clientId = clientIdFor(tenantId);
  return {
    clientId, name: `Wellbeing service (${tenantId})`, enabled: true, publicClient: false, protocol: 'openid-connect',
    serviceAccountsEnabled: true, standardFlowEnabled: false, implicitFlowEnabled: false, directAccessGrantsEnabled: false, fullScopeAllowed: false,
    ...(certificate
      ? { clientAuthenticatorType: 'client-jwt' }
      : { clientAuthenticatorType: 'client-secret', secret }),
    attributes: {
      'access.token.lifespan': '300', 'client_credentials.use_refresh_token': 'false',
      ...(certificate ? { 'jwt.credential.certificate': certificate, 'token.endpoint.auth.signing.alg': 'RS256' } : {}),
    },
    defaultClientScopes: [], optionalClientScopes: [],
  };
}

function mappers(tenantId) {
  return [
    { name: 'audience-srs-api', protocol: 'openid-connect', protocolMapper: 'oidc-audience-mapper', config: { 'included.custom.audience': 'srs-api', 'id.token.claim': 'false', 'access.token.claim': 'true' } },
    { name: 'realm-roles', protocol: 'openid-connect', protocolMapper: 'oidc-usermodel-realm-role-mapper', config: { multivalued: 'true', 'userinfo.token.claim': 'false', 'id.token.claim': 'false', 'access.token.claim': 'true', 'claim.name': 'realm_roles', 'jsonType.label': 'String' } },
    { name: 'tenant-id', protocol: 'openid-connect', protocolMapper: 'oidc-hardcoded-claim-mapper', config: { 'claim.name': 'tenant_id', 'claim.value': tenantId, 'jsonType.label': 'String', 'id.token.claim': 'false', 'access.token.claim': 'true', 'userinfo.token.claim': 'false' } },
  ];
}

token = await adminToken();
await api('POST', '/roles', { name: ROLE, description: 'ADR-029: the wellbeing service, for its hand-offs to core' }); // 409 if it exists
const role = await api('GET', `/roles/${ROLE}`);

for (const tenantId of tenants) {
  const clientId = clientIdFor(tenantId);
  const [existing] = await api('GET', `/clients?clientId=${encodeURIComponent(clientId)}`);
  if (existing) await api('PUT', `/clients/${existing.id}`, { ...existing, ...representation(tenantId), attributes: { ...existing.attributes, ...representation(tenantId).attributes } });
  else await api('POST', '/clients', { ...representation(tenantId), protocolMappers: mappers(tenantId) });
  const [client] = await api('GET', `/clients?clientId=${encodeURIComponent(clientId)}`);

  // Mappers: add any missing, and correct the tenant claim if it drifted.
  const current = await api('GET', `/clients/${client.id}/protocol-mappers/models`);
  for (const m of mappers(tenantId)) {
    const found = current.find((c) => c.name === m.name);
    if (!found) await api('POST', `/clients/${client.id}/protocol-mappers/models`, m);
    else if (JSON.stringify(found.config) !== JSON.stringify({ ...found.config, ...m.config })) {
      await api('PUT', `/clients/${client.id}/protocol-mappers/models/${found.id}`, { ...found, config: { ...found.config, ...m.config } });
    }
  }

  // The service account holds exactly the one role, and the client's scope maps only it.
  const user = await api('GET', `/clients/${client.id}/service-account-user`);
  await api('POST', `/users/${user.id}/role-mappings/realm`, [role]);
  await api('POST', `/clients/${client.id}/scope-mappings/realm`, [role]);
  console.log(`provisioned ${clientId} (${certificate ? 'private_key_jwt' : 'client_secret_basic'})`);
}
