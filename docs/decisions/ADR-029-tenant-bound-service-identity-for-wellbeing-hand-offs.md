# ADR-029: Tenant-Bound Service Identity for the Wellbeing-to-Core Hand-offs

**Status**: Accepted
**Date**: 2026-11-21
**Amends**: [ADR-028](ADR-028-exceptional-circumstances-decision-authority.md) item 8 (the holder of `circumstances:record-determined` changes from `integration-service` to the new `wellbeing-service` role)
**Follows**: [ADR-006](ADR-006-identity-provider.md) (Keycloak); [ADR-017](ADR-017-minimum-necessary-outcomes-and-restricted-evidence.md) (minimum-necessary outcomes); [ADR-026](ADR-026-browser-sessions-through-a-backend-for-frontend.md) (BFF, realm settings)
**Backlog**: BL-233, BL-234; pre-review [D-44 adjustments](../business-processes/pre-reviews/pre-review-adjustments-d-44.md) F1 and F5

## Context

The wellbeing module (`modules/wellbeing`) owns adjustment and EC cases. It hands two outcomes to core (`apps/api`):

| Hand-off | Route | Permission today | Client |
|---|---|---|---|
| F-WELL-SIS-01, approved adjustment | `POST /api/v1/students/:personId/adjustments` (`apps/api/src/routes/adjustments.ts:174`) | `adjustment:write` (`registry-administrator`, `wellbeing-advisor`) | `modules/wellbeing/src/srs/srs-adjustment-client.ts` |
| F-WELL-SIS-02, upheld EC determination | `POST /api/v1/students/:personId/exceptional-circumstances` (`apps/api/src/routes/circumstances.ts:176`) | `circumstances:write` (`registry-administrator`, `ec-case-officer`) | `modules/wellbeing/src/srs/srs-ec-client.ts` |

What the code shows:

- **Nothing reaches core.** Both HTTP clients take a static bearer token in their constructor. `modules/wellbeing/src/main.ts` calls `buildApp(config)` with no clients, so `modules/wellbeing/src/app.ts:109-110` falls back to `SrsAdjustmentStubClient` and `SrsEcStubClient` in every environment. An approval returns `stub-adj-…` and the case shows `approved` (pre-review F1, Blocker).
- **A static token cannot work.** Access tokens last 5 minutes (`accessTokenLifespan: 300` in `infra/compose/keycloak/srs-realm.json`, BL-159).
- **The tenant comes only from the token.** `packages/auth/src/plugins/jwt.ts` requires `sub` and `tenant_id` and sets `request.tenantId = claims.tenant_id`. There is no header override. `packages/auth/src/plugins/tenant.ts` runs every query under RLS for that tenant.
- **One wellbeing deployment serves every tenant.** So a single service account with a fixed `tenant_id` attribute can act for one tenant only.
- **Audiences are already per service** (`srs-api`, `srs-wellbeing`, `srs-attendance`; `packages/auth/src/settings.ts`, audience mappers in the realm).
- **No service client exists.** The realm has only the two browser clients (`srs-admin`, `srs-portal`), with a user-attribute `tenant-id` mapper. No client has `serviceAccountsEnabled`, and no code in the repository uses the `client_credentials` grant.
- **`integration-service` is broad.** It holds `mark:write`, `financial-registration:write`, `adjustment:read:all`, `application:receive` and others (`packages/domain/src/permissions.ts`). Giving it `adjustment:write` and `circumstances:write` would hand those to every connector.
- **Secrets come from OpenBao.** The agent injector renders files under `/vault/secrets/`, and the container command exports them (`infra/k8s/base/workers.yaml`, `infra/k8s/base/openbao.yaml`). `policy-wellbeing.hcl` reads only its DB credentials and NATS.
- **The deployed Keycloak is 26.0.7** (`infra/compose/docker-compose.yml`).
- **Tenancy model drift.** ADR-006 and `technology-stack.md` say one realm per tenant. The code and manifests run one realm (`srs`) with a `tenant_id` attribute and a single pinned issuer. This decision has to work under both.

## Decision

1. **Identity: one confidential client-credentials client per tenant, all for the wellbeing service.**
   - Client ID: `srs-wellbeing-svc-<tenantId>` (the tenant UUID). Both services get the name from one function, `wellbeingServiceClientId(tenantId)` in `packages/auth`. It is a code constant, not configuration, so the two sides cannot drift.
   - Keycloak settings for each client:
     - `publicClient: false`, `serviceAccountsEnabled: true`
     - `standardFlowEnabled`, `implicitFlowEnabled` and `directAccessGrantsEnabled` all `false`
     - `fullScopeAllowed: false`, with a scope mapping for the realm role `wellbeing-service` only
     - attributes `access.token.lifespan: 300` and `client_credentials.use_refresh_token: false`
     - no default or optional client scopes beyond what the mappers below need
   - Protocol mappers on the client:
     - an audience mapper for `srs-api` only. The service needs no token for `srs-wellbeing` or `srs-attendance`.
     - the `realm-roles` mapper (claim `realm_roles`), as on the browser clients
     - an `oidc-hardcoded-claim-mapper` named `tenant-id`, with `claim.name: tenant_id`, `claim.value: <tenantId>` and `access.token.claim: true`
   - The service-account user holds exactly one realm role, `wellbeing-service`. It has no `srs_person_id`.
   - Under realm-per-tenant (ADR-006), this becomes one client per realm. The ID and mappers stay the same, and core would then also map issuer to tenant. Nothing in this ADR has to be redone.

2. **How the tenant is conveyed and verified.**
   - **Conveyed by the identity provider.** The wellbeing service asks for a token from the client of the tenant that owns the outbox row it is sending. It never sends a tenant header or body field, and core still reads the tenant only from `tenant_id`.
   - **Verified by core, in `packages/auth/src/plugins/jwt.ts`, when the token is accepted:**
     - Read `azp` into `AuthenticatedUser.authorizedParty`.
     - A shared map `SERVICE_ROLE_CLIENTS` in `packages/auth` binds each service role to its client ID function. Today it has one entry: `wellbeing-service → wellbeingServiceClientId`.
     - Core keeps a service role from `realm_roles` only if `azp === wellbeingServiceClientId(claims.tenant_id)` and the token has no `srs_person_id`. Otherwise it drops the role and logs a warning (no token contents).
     - So a human token, or a token from another tenant's client, that somehow carries the role gets no service permissions. A client whose hard-coded tenant claim does not match its own ID also gets none: fail closed.
   - **RLS is unchanged.** A `personId` outside the token's tenant is a 404, as for any caller.

3. **Role and permissions: a new role `wellbeing-service` with two narrow permissions, and nothing else.**
   - Add `wellbeing-service` to `ROLES` in `packages/domain/src/permissions.ts`.
   - New permission `adjustment:record-approved`, held by `['wellbeing-service']` only. `POST /students/:personId/adjustments` changes its preHandler to `requireAnyPermission('adjustment:write', 'adjustment:record-approved')`.
     - When the caller holds only `adjustment:record-approved`, `sourceCaseId` is required (422 without it).
     - The manual staff path through `adjustment:write` is not changed here; pre-review F5 decides it separately.
   - `circumstances:record-determined` (named in ADR-028 item 8) is held by `['wellbeing-service']`, not `integration-service`. `POST /students/:personId/exceptional-circumstances` changes its preHandler to `requireAnyPermission('circumstances:write', 'circumstances:record-determined')`.
     - Until F-WELL-SIS-02 v2 ships, the route still records the outcome as `pending` for core's own decision, as today. ADR-028 item 8 then makes it record the determination as decided for this permission only.
   - `wellbeing-service` holds no read permission. The unused reconciliation fetch (`modules/wellbeing/src/consumers/reconciliation.ts`, never called) gets a read permission only when it is wired, through its own decision.
   - `integration-service` gains nothing.
   - **Audit.** Core records the service account's `sub` as the actor and `azp` as `actorDisplayName`, because service tokens carry no `name`. The approving staff member stays on the wellbeing case, and core keeps the link through `sourceCaseId`. ADR-028 item 8's `decidedBy` covers EC in v2.

4. **Client authentication to Keycloak.**
   - **Staging and production: `private_key_jwt`** (Keycloak `clientAuthenticatorType: client-jwt`, attribute `token.endpoint.auth.signing.alg: RS256`).
     - The wellbeing service holds one RSA 3072-bit key pair for the deployment. Its public certificate is registered on every `srs-wellbeing-svc-*` client.
     - The client assertion has `iss` = `sub` = client ID, `aud` = the realm issuer URL, a random `jti`, `iat`, and `exp` = now + 60 s. It is signed with `jose`, which `packages/auth` already uses.
   - **Development and test only: `client_secret_basic`**, with the published constant `DEFAULT_DEV_WELLBEING_CLIENT_SECRET`. The development realm's client for the demo tenant `00000000-0000-0000-0000-000000000001` uses it.

5. **Token caching and refresh: a `ServiceTokenProvider` in `modules/wellbeing/src/srs/service-token-provider.ts`.**
   - `getToken(tenantId)` returns a cached access token per tenant, held in memory per pod. There is no shared store and no refresh token.
   - It refreshes when less than 60 s or 20 % of the lifetime remains, whichever comes first, using `expires_in` from the token response.
   - Requests for the same tenant share one in-flight fetch (single flight).
   - The token endpoint is the realm's `/protocol/openid-connect/token`. By default it is derived from `KEYCLOAK_JWKS_URL`; `WELLBEING_SRS_TOKEN_URL` overrides it.
   - The token endpoint call times out after 5 s and each core call after 10 s, with `AbortSignal.timeout` (pattern P-09).
   - On a 401 from core, the provider drops the tenant's cached token and the client retries once with a fresh one. A second 401 is a transient failure, not `SrsHandoffRejectedError`.
   - A token endpoint failure is a transient failure too. The outbox row stays pending or failed and is retried by the hand-off relay (BL-248).
   - Tokens, assertions and keys are never logged. Metrics: `wellbeing_service_token_fetch_total{outcome}` and `wellbeing_srs_handoff_total{handoff,outcome}`.
   - `SrsAdjustmentHttpClient` and `SrsEcHttpClient` take `(srsApiUrl, tokenProvider)` instead of a static token, and call `tokenProvider.getToken(input.tenantId)`. `tenantId` is added to both input types.

6. **Transport: synchronous HTTP from the wellbeing outbox, not events.**
   - The hand-offs stay on HTTP from the existing outbox rows (`srs-handoff-repository.ts`, `srs-ec-handoff-repository.ts`). The idempotency key is committed first, and the relay (BL-248) retries pending and failed rows (pattern P-10).
   - The hand-offs do not move to NATS or the delivery ledger:
     - ADR-019's ledger covers core's outbound exchanges, not inbound ones.
     - A NATS write path would take the tenant from the message, which is the caller-asserted tenant this ADR rejects.
     - It would also lose the route's permission check, contract and immediate 422 value-set feedback.

7. **Start-up refusal outside development and test (pattern P-05).** A new `assertSrsHandoffConfig(nodeEnv, config)`, called in `main.ts` before `buildApp`, throws when `NODE_ENV` is neither `development` nor `test` and any of these holds:
   - `WELLBEING_SRS_CLIENTS` is `stub`. It defaults to `http`, and `stub` is accepted only in development and test.
   - `SRS_API_URL` is unset. The `http://localhost:3000` default applies in development and test only.
   - `WELLBEING_SRS_CLIENT_AUTH` is not `private_key_jwt`.
   - The key file `WELLBEING_SRS_CLIENT_KEY_FILE` is missing, unreadable, or does not parse as an RSA private key.
   - `WELLBEING_SRS_CLIENT_KEY_ID` is unset.

   The check is static: no token is fetched at start-up, so a brief Keycloak outage does not crash-loop the pod.

   `buildApp` also refuses a missing client, or a stub-client instance, when `config.nodeEnv` is not `development` or `test`. It falls back to a stub only when `WELLBEING_SRS_CLIENTS=stub` in development or test. `main.ts` builds the HTTP clients from config.

8. **Secrets supply.**
   - **OpenBao KV v2** path `kv/srs/wellbeing/service-client`, with fields `private_key_pem` (PKCS#8) and `key_id`.
   - **`policy-wellbeing.hcl`** gains `path "kv/data/srs/wellbeing/service-client" { capabilities = ["read"] }`.
   - **The `srs-wellbeing` Deployment** gains:
     - `vault.hashicorp.com/agent-inject-secret-srs-client-key: "kv/data/srs/wellbeing/service-client"`, with a template that renders `private_key_pem`, and `agent-inject-file-srs-client-key` set so the file is `/vault/secrets/srs-client-key`
     - the env `WELLBEING_SRS_CLIENT_KEY_FILE=/vault/secrets/srs-client-key`
     - `WELLBEING_SRS_CLIENT_KEY_ID`, rendered from `key_id` into a second file and exported in the container command, as `db` and `nats` are
   - The private key stays in a file, not in an environment variable.
   - **The provider re-reads the key file when its mtime changes**, so a rotation needs no restart.
   - **Rotation:**
     1. Write the new key pair to OpenBao.
     2. Run the provisioning script, which replaces the certificate on every `srs-wellbeing-svc-*` client.
     3. The agent re-renders the file.

     Calls fail with 401 for the short gap and the outbox retries them. Default period: 12 months, and at once on suspected compromise.
   - **Keycloak never holds the private key.**

9. **Provisioning.** Tenant onboarding creates the tenant's `srs-wellbeing-svc-<tenantId>` client and service account through the Keycloak Admin REST API, with exactly the settings in item 1. It uploads the current public certificate.
   - A new script, `infra/scripts/provision-wellbeing-service-client.ts`, does this idempotently for one tenant or all.
   - The development realm export gets the client for the demo tenant.
   - A tenant with no client fails its hand-offs with `invalid_client`, a transient and alerting failure. Core stays closed.

## Rationale

- **The tenant stays a fact the identity provider asserts and core verifies.** Every service shares `packages/auth`. A tenant override in that plugin, even one allow-listed by `azp`, would be a cross-tenant path that a single bug opens for every route (core principles 6 and 10; pattern P-02).
- **Containment is honest, not overstated.** The wellbeing service holds one key for all its clients, so a stolen key reaches every tenant, as a shared secret would under the single-client option. What per-tenant clients add:
  - one tenant can be cut off without touching the others (offboarding, an incident);
  - core can verify that the client, the tenant claim and the role agree;
  - it is the only option that also works under realm-per-tenant;
  - per-tenant keys stay possible later without a redesign.
- **Least privilege.** A dedicated role with two write-only permissions, honoured only from its own client, keeps both abilities away from connectors and humans (core principle 6).
- **Asymmetric client authentication.** RFC 9700 §2.5 recommends asymmetric client authentication (mTLS or `private_key_jwt`), so the authorization server holds no symmetric secret. With one key registered on many clients, it also means one thing to rotate instead of one secret per tenant.
- **Few moving parts.** It uses Keycloak and OpenBao, which the system already runs, and `jose`, which it already depends on. It needs no new infrastructure.

## Options considered

| Option | Verdict |
|---|---|
| Do nothing (stub clients) | Rejected. Approved adjustments are never implemented, a breach of the s.20 duty (pre-review F1) |
| Static bearer token from configuration | Rejected. Tokens last 5 minutes |
| Grant `adjustment:write` and `circumstances:write` to `integration-service` | Rejected. Every connector would gain both, and a human-staff permission would be shared with machines (least privilege) |
| One client, plus a tenant header or claim the caller may assert, accepted only for that `azp` | Rejected. It adds a caller-chosen-tenant path to the auth plugin every service shares. It cannot work across realms (ADR-006). Disabling one tenant would mean editing core configuration |
| One client per tenant, client-credentials, hard-coded tenant claim, `azp`-bound service role | **Chosen** |
| Keycloak token exchange (RFC 8693), per tenant | Rejected. Standard token exchange is fully supported only from Keycloak 26.2, and only internal-to-internal; the deployed version is 26.0.7. Exchange cannot set a different tenant claim without per-tenant target clients anyway, so it adds a step to the chosen option. Exchanging the approving user's token fails for outbox retries made after it has expired |
| Keycloak dynamic scopes to pick the tenant | Rejected. Preview feature |
| mTLS client authentication (RFC 8705) | Rejected for now. It needs a client-certificate PKI and TLS passthrough to Keycloak, for the same assurance `private_key_jwt` gives |
| Send the outcomes over NATS or the delivery ledger instead of HTTP | Rejected. The tenant would come from the message, core would lose the route contract and 422 feedback, and ADR-019's ledger is for core's outbound exchanges |

## Consequences

- **Core changes:**
  - `packages/auth` gains `authorizedParty`, `wellbeingServiceClientId`, `SERVICE_ROLE_CLIENTS` and service-role filtering;
  - `packages/domain` gains a role and a permission;
  - two routes change their preHandler.

  This is Alpha, so the breaking change to `SrsAdjustmentHttpClient` and `SrsEcHttpClient` constructors is acceptable now.
- **ADR-028 item 8 changes:** `circumstances:record-determined` goes to `wellbeing-service`, not `integration-service`. ADR-028's status line should note "Amended by ADR-029 (item 8)".
- **Onboarding has one more step:** one Keycloak client per tenant, created by script. Forgetting it fails closed and visibly.
- **The deployment must allow the traffic.** Today `allow-ingress-to-api` (`infra/k8s/base/network-policies.yaml`) accepts port 3000 only from the ingress controller, so the wellbeing pod cannot reach the API. The wellbeing pod also needs to reach Keycloak.
- **The issuer must match.** Keycloak must issue tokens with the public issuer that core pins, even when the wellbeing service calls the internal token endpoint (`KC_HOSTNAME` set in the deployment). The cross-component test covers it.
- **To confirm, without blocking the decision:**
  - the key rotation period (default 12 months), by the platform operator and the institution's information security lead;
  - single realm or realm per tenant (ADR-006 drift), by the architecture owner. This ADR works under both.

## Guard

- **`packages/auth` unit test (`service-role-binding.test.ts`).** Expected outcomes:

  | Token | `wellbeing-service` role |
  |---|---|
  | `azp` matches `srs-wellbeing-svc-<tenant_id>` | kept |
  | `azp` = `srs-admin` | dropped |
  | `azp` = another tenant's client | dropped |
  | matching `azp` but `srs_person_id` present | dropped |
- **`apps/api/test/wellbeing-service-handoff.int.test.ts`** (RS256 tokens signed with `jose`). Expected responses on both routes:

  | Caller | Response |
  |---|---|
  | `wellbeing-service` with matching `azp` | 201 |
  | the same role with a mismatched `azp` | 403 |
  | `integration-service` | 403 |
  | service caller on adjustments without `sourceCaseId` | 422 |
  | another tenant's `personId` | 404 |
- **`packages/domain` permissions test.** `wellbeing-service` holds exactly `adjustment:record-approved` and `circumstances:record-determined`, and those two are held by no other role.
- **Realm test over `srs-realm.json`.** Every client with `serviceAccountsEnabled`:
  - has the standard, implicit and direct grant flows off;
  - has `fullScopeAllowed: false`;
  - has an audience of `srs-api` only;
  - has a hard-coded `tenant_id` equal to its client ID suffix.

  The role `wellbeing-service` is mapped only to service accounts of `srs-wellbeing-svc-*` clients.
- **`modules/wellbeing/test/insecure-config.int.test.ts`** gains cases. In production mode, start-up throws for:
  - `WELLBEING_SRS_CLIENTS=stub`
  - `client_secret`
  - a missing or invalid key file
  - a missing `SRS_API_URL`
  - `buildApp` without real clients
- **`modules/wellbeing/test/service-token-provider.test.ts`:**
  - cache hit;
  - refresh before expiry;
  - single flight under concurrency;
  - retry once after a 401;
  - timeout;
  - key re-read on mtime change;
  - assertion claims (`iss`, `sub`, `aud`, `jti`, `exp` ≤ 60 s).
- **`apps/api/test/cross-component/adjustment-handoff.int.test.ts`** drops its static token. It runs the real provider against a token endpoint stub that checks the client assertion and issues a token with the hard-coded tenant claim.
- **Manifest test.** The `srs-wellbeing` Deployment has the key-file annotation and env, `policy-wellbeing.hcl` reads the new path, and a network policy admits `srs-wellbeing` to `srs-api:3000`.

## Follow-up work

| Title | Type | Area | Priority | Size |
|---|---|---|---|---|
| `wellbeing-service` role, `adjustment:record-approved`, `circumstances:record-determined`; `azp`-bound service-role filtering in `packages/auth` | Integration | Auth & access | P0 | S |
| `ServiceTokenProvider` (`private_key_jwt`, cache, single flight, 401 retry, timeouts) and HTTP clients taking a provider and `tenantId` | Integration | Integrations | P0 | M |
| Wellbeing `main.ts` builds real clients; `assertSrsHandoffConfig` and `buildApp` refuse stubs outside development and test (BL-233) | Defect | Adjustments & EC | P0 | S |
| Keycloak per-tenant `srs-wellbeing-svc-*` client: development realm entry and idempotent provisioning script | Integration | Platform | P0 | S |
| OpenBao path, policy and agent injection for the wellbeing client key; rotation runbook | Operations | Platform | P0 | S |
| Network policy: admit `srs-wellbeing` to `srs-api:3000`; check the issuer matches on the internal token endpoint | Defect | Platform | P0 | S |
| Guards: service-role binding unit test, hand-off role matrix, realm test, manifest test | Test | Auth & access | P0 | S |
| Note "Amended by ADR-029 (item 8)" on ADR-028 | Docs | Documentation | P2 | S |

## Implementation notes (2026-11-21)

- **The assertion's `kid` is derived, not configured.** Testing against Keycloak 26.0.7 showed that for a `client-jwt` client with a registered certificate, Keycloak looks the assertion's `kid` up by the id it gives the certificate's public key: base64url of SHA-256 over the DER SubjectPublicKeyInfo (its `KeyUtils.createKeyId`). A configured label such as `key_id`, and an RFC 7638 thumbprint, are both refused (`client_credentials_setup_required`). `createClientAssertion` therefore uses `keycloakKeyId(privateKey)` by default. `WELLBEING_SRS_CLIENT_KEY_ID` becomes an optional override, no longer required at start-up, and the OpenBao secret needs only `private_key_pem`.
- **The provisioning script is `infra/scripts/provision-wellbeing-service-client.mjs`**, plain Node with no build step, rather than `.ts`. It registers the deployment's X.509 certificate, made with `openssl req -batch -new -x509 -key private_key.pem -subj /CN=srs-wellbeing-service -days 400`.
- **Verified live:**
  - The development realm's demo-tenant client issues a token with `azp`, `tenant_id`, only `wellbeing-service`, audience `srs-api` and a 300 s lifetime.
  - Core validates that token with RS256 and records a hand-off (`apps/api/test/cross-component/wellbeing-service-identity-live.int.test.ts`, run with `KEYCLOAK_LIVE_URL`).
  - A tenant provisioned by the script obtains a `private_key_jwt` token, and an unprovisioned tenant is refused.
