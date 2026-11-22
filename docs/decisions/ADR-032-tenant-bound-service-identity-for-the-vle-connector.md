# ADR-032: Tenant-Bound Service Identity for the VLE Connector

**Status**: Accepted
**Date**: 2026-11-22
**Extends**: [ADR-029](ADR-029-tenant-bound-service-identity-for-wellbeing-hand-offs.md). The client model, `azp` binding, `private_key_jwt`, token caching and start-up refusal all apply as written there. This ADR records only what differs for the VLE connector.
**Backlog**: BL-333 (the rest: `SERVICE_ACCOUNT_TOKEN`)
**Patterns**: P-24 (tenant-bound service identity), P-05 (refuse insecure configuration), P-09 (bound every outbound call), P-03 (deny by default), P-20 (enforceable module boundaries)

## Context

- **The connector authenticates to core with a static bearer token.** `adapters/vle` reads `SERVICE_ACCOUNT_TOKEN` (`adapters/vle/src/config.ts:75`), and sends it on every call to core:

  | Call | Core route | Permission today |
  |---|---|---|
  | `registry/client.ts`, fetch registration | `GET /integration-registrations/:registrationId` | `integration:read` |
  | `registry/client.ts`, report health | `POST /integration-registrations/:registrationId/health-check` | `integration:read` |
  | `srs-client/mark-client.ts`, mark passback (F-VLE-SIS-01, `vle-assessment-results.v1`) | `POST /module-registrations/:id/marks` | `mark:write` |
  | `srs-client/acknowledgement-client.ts`, adjustment replies (F-SIS-VLE-02) | `POST /adjustments/:id/distributions/:id/{acknowledge,failure,withdrawal/acknowledge}` | `integration:manage` or `adjustment:fulfil` |
- **A static token cannot work.** Tokens last 5 minutes (BL-159). `check:deployment-env` lists `SERVICE_ACCOUNT_TOKEN` as its one known gap (`scripts/check-deployment-env.mjs:108`).
- **The connector runs per tenant.** One connector deployment serves one tenant and one registration (`TENANT_ID`, `INTEGRATION_REGISTRATION_ID`, both required UUIDs since BL-337).
- **The connector's replies are trusted because of a broad permission.** Core treats a caller holding `integration:manage` as the connector, which may reply for connected targets (`replyActor`, `apps/api/src/routes/adjustments.ts:121`). `integration:manage` also enables and disables registrations.
- **The mark route takes whatever the caller asserts.** `mark:write` is shared with module tutors and registry staff. The ingest body lets the caller set `sourceSystem` freely (`apps/api/src/routes/marks.ts`).
- **The connector has no workspace dependencies, by design.** It keeps copies of `natsConnectOptions` (`adapters/vle/src/nats-auth.ts`) and `fetchWithTimeout` (`adapters/vle/src/http/fetch-with-timeout.ts`). `@revelation-srs/auth` depends on `@revelation-srs/db`, Fastify and `@fastify/jwt` (`packages/auth/package.json`).
- **The token provider lives in wellbeing.** `ServiceTokenProvider` is in `modules/wellbeing/src/srs/service-token-provider.ts`. It imports `createClientAssertion`, `fetchWithTimeout` and `wellbeingServiceClientId` from `@revelation-srs/auth`.

## Decision

1. **Identity: one client per tenant, exactly as in ADR-029 item 1.**
   - Client ID: `srs-vle-svc-<tenantId>`, from `vleConnectorClientId(tenantId)`.
   - The service-account user holds one realm role, `vle-connector-service`.
   - The client has an audience mapper for `srs-api` only, a hard-coded `tenant_id`, and `fullScopeAllowed: false`.
   - `SERVICE_ROLE_CLIENTS` in `packages/auth` gains `vle-connector-service → vleConnectorClientId`. The `azp` binding and the `srs_person_id` refusal are unchanged.
   - Two connector deployments for one tenant (for example Moodle and Canvas) share the client.

2. **Permissions: three narrow permissions, held by `vle-connector-service` only.**

   | Permission | Route (preHandler becomes `requireAnyPermission(<existing>, <new>)`) | Extra checks in the service when the caller holds only the new permission |
   |---|---|---|
   | `integration-registration:use:vle` | `GET /integration-registrations/:id`, `POST /integration-registrations/:id/health-check` | The registration's `contractId` must be in `VLE_CONTRACT_IDS` (`vle-course-provisioning.v1`, `vle-adjustments.v1`, `vle-assessment-results.v1`; constant in `packages/domain`), or the response is 404. `secretRef` is left out of the response |
   | `mark:record-from-vle` | `POST /module-registrations/:id/marks` only (never `PATCH` or override routes) | `sourceSystem` must be `vle`, or the response is 422. `sourceReference` (the VLE submission reference) is required, and is the idempotency key: a repeat returns the existing `markId` with 200. Locks apply as for every caller |
   | `adjustment-distribution:reply:vle` | `.../acknowledge`, `.../failure`, `.../withdrawal/acknowledge` | The distribution must have `targetSystem = 'vle'` and `fulfilmentModeCode = 'connected'`, and the body's `targetSystem` must be `vle`. Otherwise the response is 404 (target mismatch) or 409 (mode), as today |

   - **Mark passback gets its own permission.** `mark:write` is a human permission, held by module tutors and registry staff. A machine holding it could enter any mark from any source, and nothing would show it was the VLE.
   - **`replyActor`** treats `adjustment-distribution:reply:vle` as `'connector'`, alongside `integration:manage`.
   - **`integration-service` gains nothing.** Reviewing what it already holds is a separate follow-up.
   - **Audit.** As in ADR-029 item 3: the actor is the service account's `sub`, and `actorDisplayName` is the `azp`.

3. **Shared client code moves into a new leaf package, `@revelation-srs/service-client` (`packages/service-client`).**
   - **Its only dependencies are `jose` and `nats`.** It holds:
     - `fetchWithTimeout` and `DEFAULT_OUTBOUND_TIMEOUT_MS`;
     - `natsConnectOptions` and `assertNatsCredentials`;
     - `createClientAssertion` and `keycloakKeyId`;
     - `ServiceTokenProvider`, moved from `modules/wellbeing/src/srs/`;
     - `wellbeingServiceClientId` and `vleConnectorClientId`.
   - **`@revelation-srs/auth` depends on it and re-exports those names.** Existing imports keep working, and `SERVICE_ROLE_CLIENTS` stays in `packages/auth` (it is server-side).
   - **The connector depends on `@revelation-srs/service-client` only**, and deletes `nats-auth.ts` and `http/fetch-with-timeout.ts`.
   - **The connector's rule changes** from "no workspace dependencies" to "only leaf client packages". A lint `no-restricted-imports` in `adapters/*` bans `@revelation-srs/auth`, `@revelation-srs/db` and every other workspace package except `@revelation-srs/service-client` (and `@revelation-srs/domain` as a type-only dev dependency, as now).

4. **Connector configuration and start-up refusal.** A new `assertVleSrsClientConfig(nodeEnv, config)` in `adapters/vle/src/config.ts` is called before `buildApp`.

   | Variable | Default | Outside development and test |
   |---|---|---|
   | `SRS_API_URL` | `http://localhost:3000` in development and test only | Required |
   | `VLE_SRS_TOKEN_URL` | Derived from `KEYCLOAK_JWKS_URL` (`/certs` → `/token`) | One of the two is required |
   | `VLE_SRS_CLIENT_AUTH` | `client_secret_basic` in development and test, `private_key_jwt` otherwise | Must be `private_key_jwt` |
   | `VLE_SRS_CLIENT_KEY_FILE` | none | Required; must parse as an RSA private key |
   | `VLE_SRS_CLIENT_KEY_ID` | derived (`keycloakKeyId`, ADR-029 implementation notes) | Optional override |
   | `VLE_SRS_CLIENT_SECRET` | `DEFAULT_DEV_VLE_CLIENT_SECRET` | Not used |
   | `SERVICE_ACCOUNT_TOKEN` | removed | If set, start-up throws "SERVICE_ACCOUNT_TOKEN is no longer used (ADR-032)", in every environment, so stale configuration fails loudly |

   - **Error message:** `Refusing to start srs-vle-adapter in '<env>' (ADR-032): ...`.
   - **Static check.** No token is fetched at start-up.
   - **Clients.** `RegistryClient`, `MarkClient` and `AcknowledgementClient` take `(srsApiUrl, tokenProvider, tenantId)` instead of a bearer token. A 401 drops the cached token and retries once, as in ADR-029 item 5.

5. **Secrets and deployment.**
   - **The connector gets its own key pair, not the wellbeing key**, so one service's compromise or rotation does not touch the other.
   - **OpenBao.** The path is `kv/srs/vle-connector/service-client`, with field `private_key_pem`. `policy-adapter.hcl` (`infra/k8s/base/openbao.yaml`) gains `path "kv/data/srs/vle-connector/service-client" { capabilities = ["read"] }`.
   - **The `srs-vle-adapter` Deployment** gains:
     - the annotations `vault.hashicorp.com/agent-inject-secret-srs-client-key: "kv/data/srs/vle-connector/service-client"`, with a template rendering `private_key_pem` to `/vault/secrets/srs-client-key`;
     - the environment `VLE_SRS_CLIENT_KEY_FILE=/vault/secrets/srs-client-key` and `VLE_SRS_CLIENT_AUTH=private_key_jwt`;
     - `KEYCLOAK_JWKS_URL` or `VLE_SRS_TOKEN_URL`.
   - `check:deployment-env` removes the `SERVICE_ACCOUNT_TOKEN` known-gap entry.
   - **Provisioning.** `infra/scripts/provision-wellbeing-service-client.mjs` is generalised to `provision-service-client.mjs --service wellbeing|vle-connector`, with the client settings for each service in one table. The development realm export gets `srs-vle-svc-00000000-0000-0000-0000-000000000001`, using the development secret.

## Rationale

- **Same model, same guarantees.** The tenant comes from the identity provider, the role is honoured only from its own client, and nothing new is deployed (core principle 6).
- **Least privilege.** The connector loses `integration:manage` (enabling and disabling registrations) and the human `mark:write`. It gets three permissions that each name their target system, so they cannot be used for another integration.
- **The connector stays light, without copying security-critical code.** A leaf package keeps it free of database and server dependencies (core principle 2, independently replaceable). One copy of the assertion and token code, including Keycloak's derived `kid`, cannot drift.

## Options considered

| Option | Verdict |
|---|---|
| Keep `SERVICE_ACCOUNT_TOKEN` | Rejected. Tokens last 5 minutes |
| Give the connector `integration-service` | Rejected. It is far broader than the connector needs, and includes `financial-registration:write`, `email:receive` and others |
| Reuse `mark:write` and `integration:manage` for a new role | Rejected. They include human and administrative abilities the connector must not have |
| Connector depends on `@revelation-srs/auth` | Rejected. It pulls in `@revelation-srs/db`, Fastify and the JWT plugin, and couples an independently replaceable connector to core's server code |
| Third copy of the token provider in the connector | Rejected. Security code would drift (the `kid` derivation was found only by live testing) |
| **New leaf package `@revelation-srs/service-client`** | **Chosen** |

## Consequences

- `modules/wellbeing` and `packages/auth` change imports. There is no behaviour change for wellbeing.
- The constructors of the connector's three HTTP clients change, which is acceptable at Alpha.
- One more Keycloak client per tenant that runs a VLE connector, created by the generalised script.
- If the connector has an egress NetworkPolicy, it must allow Keycloak (8080), as in ADR-029. The issuer that core pins must match tokens fetched through the internal endpoint.

## Guard

- **`service-role-binding.test.ts`** gains the `vle-connector-service` rows from ADR-029: kept for the matching `azp`; dropped for another tenant's client, `srs-wellbeing-svc-*`, `srs-admin`, or when `srs_person_id` is present.
- **`apps/api/test/vle-connector-service.int.test.ts`.** Expected responses:

  | Caller and request | Response |
  |---|---|
  | connector: registration with a VLE contract | 200, without `secretRef` |
  | connector: registration with another contract | 404 |
  | connector: mark with `sourceSystem` other than `vle`, or without `sourceReference` | 422 |
  | connector: repeat mark | 200 with the same `markId` |
  | connector: mark `PATCH` | 403 |
  | connector: reply to a non-VLE or manual distribution | 404 or 409 |
  | connector: enable or disable a registration | 403 |
  | `integration-service` and a module tutor on the VLE-only routes | as today, unaffected |
- **`packages/domain` permissions test.** The three new permissions are held only by `vle-connector-service`, and that role holds nothing else.
- **`adapters/vle/test/insecure-config.test.ts`.** In production mode, these throw: `SERVICE_ACCOUNT_TOKEN` set, `client_secret_basic`, a missing or invalid key file, a missing `SRS_API_URL`, and no token URL.
- **Lint** in `adapters/*` bans workspace imports other than `@revelation-srs/service-client`.
- **`check:deployment-env`** passes with no known gaps for `srs-vle-adapter`.
- **The realm test** (ADR-029) covers `srs-vle-svc-*` clients.

## Follow-up work

| ID | Title | Type | Area | Priority | Size |
|---|---|---|---|---|---|
| BL-364 | `vle-connector-service` role, three VLE-scoped permissions with their service checks, `azp` binding entry (BL-333) | Integration | Auth & access | P0 | S |
| BL-365 | `packages/service-client` leaf package; move `ServiceTokenProvider` and helpers; auth re-exports; connector drops its copies | Tech debt | Auth & access | P0 | S |
| BL-366 | Connector clients use `ServiceTokenProvider`; `assertVleSrsClientConfig`; remove `SERVICE_ACCOUNT_TOKEN` | Integration | Integrations | P0 | S |
| BL-367 | OpenBao path, policy and injection for the connector key; generalised provisioning script; development realm client | Operations | Infrastructure | P0 | S |
| BL-368 | Guards: binding rows, VLE connector route matrix, insecure-configuration test, adapter import lint | Test | Auth & access | P0 | S |
| BL-369 | Review `integration-service` permissions against the connectors that actually use them | Review | Auth & access | P2 | S |
