# ADR-026: Browser Sessions Through a Backend-for-Frontend

**Status**: Accepted
**Date**: 2026-11-20
**Follows**: [ADR-006](ADR-006-identity-provider.md) (Keycloak; the SRS as a confidential client), [ADR-007](ADR-007-frontend.md)
**Backlog**: BL-031 (this decision), BL-030 (implementation); enterprise readiness item 1.9 and finding SEC-7 in the [enterprise readiness audit](../product/enterprise-readiness-audit.md)

## Context

The admin app (`apps/admin`) and the portal (`apps/portal`) are public OAuth clients. Each runs the authorization code flow with PKCE itself (`packages/ui/src/auth/oidc.ts`). It keeps the access token and the refresh token in `localStorage` (`apps/*/src/auth/AuthContext.tsx`), and several API modules read the token from there directly (`apps/admin/src/api/client.ts`, `apps/portal/src/api/applications.ts`, `apps/portal/src/api/research.ts`, both `wellbeingModule.ts`). Any script that runs in either origin can read both tokens and use them from anywhere until they expire.

What the code and realm show:

- **Token lifetimes are long.** The realm (`infra/compose/keycloak/srs-realm.json`) issues access tokens that last 8 hours (`accessTokenLifespan: 28800`). It does not rotate refresh tokens (`revokeRefreshToken` is unset). The SPAs request `offline_access`, which gives them offline refresh tokens that outlive the SSO session.
- **Redirect URIs are loose.** Both clients allow wildcard redirect URIs (`http://localhost:5173/*`).
- **The CSP is wide.** Phase 1 added a CSP to both nginx images (`infra/docker/{admin,portal}/nginx.conf`). Its `connect-src 'self' https: wss:` is that wide because the SPAs call the API host, the wellbeing module host and Keycloak directly.
- **The admin app calls two backends.** It calls core and the wellbeing module (`apps/admin/src/api/wellbeingModule.ts`, `VITE_WELLBEING_API_URL`), using the same token. Phase 1 pinned per-service audiences (`srs-api`, `srs-wellbeing`, `srs-attendance`; `packages/auth/src/settings.ts`). Both clients carry audience mappers for all three, because core forwards the user's token to attendance through the engagement proxy.
- **The live notification stream cannot authenticate.** The portal's `createNotificationStream` (`apps/portal/src/api/notifications.ts`) puts the token in a `?token=` query string, because `EventSource` cannot send headers. The API reads only the `Authorization` header (`packages/auth/src/plugins/jwt.ts`), so the stream could never authenticate. The function is unused.
- **End-to-end tests inject tokens into `localStorage`** (`e2e/helpers/auth.ts`, `e2e/uat/personas.ts`).

RFC 10017, *OAuth 2.0 for Browser-Based Applications* (BCP 212, August 2026), ranks three architectures:
- **Backend-for-frontend (BFF):** a confidential client keeps the tokens server-side behind an HTTP-only cookie session. The RFC strongly recommends it for business applications and for applications that handle sensitive or personal data.
- **Token-mediating backend:** the backend keeps the refresh token but gives the browser the access token.
- **Browser-based OAuth client:** the browser holds every token.

The RFC also says that keeping tokens in memory or in a Web Worker does not stop an attacker who has script execution. That attacker can run a new authorization flow against the user's live Keycloak session and take fresh tokens (RFC 10017, the threat model and §8). The audit recommended keeping tokens in memory now and adding a BFF only if a penetration test asks for one.

## Decision

1. **Use a backend-for-frontend; the browser holds no OAuth tokens.**
   - A new service, `apps/bff` (Fastify, TypeScript; ADR-001, ADR-002), is deployed once per SPA: `srs-admin-bff` and `srs-portal-bff`.
   - Each is a Keycloak **confidential** client (`srs-admin`, `srs-portal`). The public clients are removed from the realm.
   - Client authentication uses a client secret from OpenBao (ADR-010); `private_key_jwt` is a later hardening step.
2. **Serve the BFF on the same origin as its SPA.**
   - Each SPA's nginx proxies `/bff/` to its BFF.
   - The browser calls only its own origin. It no longer calls the API, wellbeing or attendance hosts, or Keycloak's token endpoint.
   - The CSP becomes `connect-src 'self'`, dropping `https:` and `wss:`.
3. **BFF endpoints:**

   | Endpoint | Purpose |
   |---|---|
   | `GET /bff/auth/login?returnTo=` | Starts the authorization code flow with PKCE (S256), `state` and `nonce`. Requested scopes are `openid profile email`, never `offline_access`. `returnTo` must be a relative path. |
   | `GET /bff/auth/callback` | Validates `state`, exchanges the code, validates the ID token (issuer, audience, nonce, RS256), creates the session and redirects to `returnTo`. |
   | `GET /bff/session` | Returns `{ authenticated, sub, srsPersonId, tenantId, roles, displayName, email, expiresAt }`. Never returns a token. |
   | `POST /bff/auth/logout` | See item 9. |
   | `POST /bff/auth/backchannel-logout` | Keycloak back-channel logout (OIDC Back-Channel Logout 1.0). Validates the logout token, then deletes every session with that `sid`. It is reached on the cluster network only and is not proxied by the SPA's nginx. |
   | `/bff/srs/*` | Proxied to the SRS API. |
   | `/bff/wellbeing/*` | Proxied to the wellbeing module. Admin and portal only, because the attendance module has no browser client. |

4. **Cookies:**
   - **Session cookie:** `__Host-srs_session`, with `HttpOnly; Secure; SameSite=Strict; Path=/` and no `Domain`. Its value is a random 256-bit session identifier.
   - **Login-transaction cookie:** `__Host-srs_login`, with `HttpOnly; Secure; SameSite=Lax; Max-Age=600`. It holds the encrypted `state`, `nonce`, PKCE verifier and `returnTo`. It must be `Lax` because the callback is a cross-site top-level navigation from Keycloak.
   - **No token in a cookie.** Tokens are never written to a cookie, in line with RFC 10017 §8.1.
5. **Server-side session store in PostgreSQL** (consistent with [ADR-027](ADR-027-shared-runtime-state-in-postgresql.md)).
   - **Table:** `bff.session` holds:
     - `id_hash`, the SHA-256 of the cookie value, as the key (the raw identifier is never stored);
     - `client_id`, `sub` and Keycloak `sid`;
     - an AES-256-GCM-encrypted blob of the access, refresh and ID tokens, with a key id so that keys can be rotated (`BFF_SESSION_KEYS` from OpenBao);
     - `access_expires_at`, `idle_expires_at`, `absolute_expires_at`, `created_at` and `last_seen_at`.
   - **Database role:** the BFF connects as its own role, `srs_bff`, with DML on the `bff` schema only.
   - **No tenant data:** the BFF never reads tenant data, and the table has no `tenant_id`.
   - **Clean-up:** expired rows are deleted by a job under ADR-027's job lock.
6. **Refresh in the BFF, one refresh at a time.**
   - When a proxied request finds the access token expiring within 60 seconds, the BFF refreshes it inside a transaction holding `SELECT … FOR UPDATE` on the session row.
   - Concurrent requests, on any BFF pod, wait on the lock and then use the new token. A rotated refresh token is therefore never presented twice.
   - If the upstream returns 401, the BFF refreshes once and retries once. If that fails, the session is deleted and the SPA gets a 401.
7. **Realm settings, applied now in `srs-realm.json` and the deployment realm:**
   - `accessTokenLifespan` 300 seconds;
   - `revokeRefreshToken` true and `refreshTokenMaxReuse` 0, so refresh tokens rotate and a replayed refresh token ends the session;
   - `ssoSessionIdleTimeout` 1,800 seconds and `ssoSessionMaxLifespan` 36,000 seconds, with the BFF's idle and absolute limits matching;
   - exact redirect URIs (`https://<app-host>/bff/auth/callback`, no wildcards);
   - a back-channel logout URL per client, with `backchannel.logout.session.required` set to true.

   The current SPAs keep working with these settings, because they already refresh 60 seconds before expiry. So the settings ship ahead of the BFF.
8. **The proxy forwards only what it should.**
   - **Upstreams:** an allow-list only.
   - **Request headers:** it strips `Cookie`, `Authorization` and hop-by-hop headers, sets `Authorization: Bearer <access token>`, and forwards `traceparent` and `X-Request-Id`.
   - **Bodies:** request bodies (multipart evidence uploads) and responses (the SSE notification stream) stream through unchanged. The body limit is 25 MB.
   - **Timeouts** (pattern P-09): 30 seconds by default. The SSE route has no read timeout and relies on the existing 25-second heartbeat.
   - **Downstream services are unchanged.** They still validate a bearer token with a pinned issuer and audience (pattern P-04).
9. **Logout.**
   - **`POST /bff/auth/logout`:**
     - deletes the session row and revokes the refresh token at Keycloak's revocation endpoint;
     - clears the cookie;
     - returns Keycloak's end-session URL with `id_token_hint` and `post_logout_redirect_uri`, which the SPA navigates to.
   - **Sign-out elsewhere:** back-channel logout ends BFF sessions when the user signs out of another client or an administrator ends their Keycloak session.
10. **Multi-tab behaviour.**
    - Tabs share the session cookie, so they share one session and one refresh.
    - On logout, the SPA posts `signed-out` on a `BroadcastChannel('srs-auth')`, and other tabs go to the signed-out page. The message carries no data.
    - A tab that misses the message gets a 401 on its next call and goes to `/bff/auth/login`.
11. **CSRF.** Non-safe methods (`POST`, `PUT`, `PATCH`, `DELETE`) through `/bff/` are refused with 403 unless both of these hold:
    - `Origin` equals the BFF's configured app origin;
    - the request carries `X-SRS-Request: 1`, a custom header that a cross-site form cannot send without a CORS preflight, which the BFF never grants.

    `SameSite=Strict` is the first layer.
12. **SPA changes.**
    - `AuthContext` reads `/bff/session`.
    - `createApiClient` in `packages/ui` drops `getToken`, sends `credentials: 'same-origin'` and `X-SRS-Request: 1`, and uses base URLs `/bff/srs` and `/bff/wellbeing`.
    - On a 401, the SPA navigates to `/bff/auth/login?returnTo=<current path>`.
    - `packages/ui/src/auth/oidc.ts`, `VITE_KEYCLOAK_*`, `VITE_API_BASE_URL` and `VITE_WELLBEING_API_URL` are removed.
    - The notification stream becomes `new EventSource('/bff/srs/api/v1/notifications/stream')`, authenticated by the cookie.
13. **Audiences stay as phase 1 set them.**
    - One access token carries `srs-api`, `srs-wellbeing` and `srs-attendance`. It now stays server-side, so only the BFF and the services it calls ever hold it.
    - Narrowing to one audience per downstream call is a follow-up: Keycloak standard token exchange, once the deployment runs a Keycloak version that supports it (compose runs 26.0.7).
14. **Development and tests.**
    - Compose runs both BFFs against the local Keycloak.
    - The current "paste a token" dev login becomes `POST /bff/dev/session`. It accepts an HS256 development token and creates a session.
    - The route exists only when `NODE_ENV` is `development` or `test`, and the BFF refuses to start with it enabled elsewhere (pattern P-05).
    - The end-to-end helpers create sessions through it instead of writing to `localStorage`.
15. **Network.** The wellbeing and attendance modules stop being browser-facing. Network policies allow traffic to the wellbeing module only from the BFFs and the API. The API host keeps a public ingress for integrations and `/public/v1`.

## Rationale

- **The RFC's recommendation fits.** The two apps hold personal data, and the wellbeing module holds special-category health data. RFC 10017 strongly recommends a BFF for that case, and it is the only one of its architectures in which no token can be taken from the browser at all.
- **In memory protects less than it seems.** An attacker with script execution can still run a silent authorization flow against the live Keycloak session and take tokens away. A BFF limits an XSS attacker to acting through the victim's open page while it is open: no offline use and no refresh-token theft.
- **This is the cheapest time.** Pattern P-17 says to decide token storage before the screens are built, because every API call changes. The project is Alpha with no tenants, so the change touches one client factory and two auth contexts, not deployed tenants.
- **It removes problems as well as adding a component.**
  - The CSP narrows to `'self'`.
  - Browser CORS to the API and the wellbeing module disappears, which makes BL-033 matter only for integrations.
  - The SSE stream can authenticate.
  - The wellbeing module leaves the browser's reach.
  - ADR-006 already assumed confidential clients.
- **Downstream services do not change.** They still receive bearer tokens, so the decision is reversible at the edge.

## Options considered

| Option | Verdict |
|---|---|
| Keep tokens in `localStorage` | Rejected. Any XSS takes both tokens, for 8 hours today (audit SEC-7) |
| Tokens in memory, refresh token isolated in a Web Worker, rotation on (the audit's recommendation) | Rejected. It reduces exposure but leaves a public client: XSS can still mint tokens through a new flow (RFC 10017 threat model). It also needs its own multi-tab coordination, because each tab refreshes alone and rotation then revokes the others' tokens, or a page reload forces a fresh sign-in |
| Token-mediating backend (refresh token server-side, access token in the browser) | Rejected. It has most of the BFF's cost, still exposes access tokens and still needs a wide `connect-src` and CORS |
| Public client with DPoP-bound tokens | Rejected for now. It does not stop a new flow bound to the attacker's key (RFC 10017), and it needs DPoP support in Keycloak and all three services |
| **BFF with an HTTP-only session cookie** | **Chosen** |

## Consequences

- **One more deployable:** two instances, with one table, one database role and two secrets: the client secret and the session keys. It adds a network hop, about 1 to 3 ms in the cluster.
- **The BFF sits on the request path for every browser call.** It needs the same availability treatment as the API: two or more replicas, topology spread (readiness 2.4), and readiness gated only on its database.
- **Sign-in depends on the BFF's database being up.** That is the same Postgres the API needs, so it adds no new failure mode.
- **Integrations are unaffected.** Integration clients and the wellbeing-to-core service calls keep using client-credentials tokens directly.
- **Lifetimes are institutional policy.** The 30-minute idle and 10-hour maximum session lifetimes are system defaults; the institution must confirm them (service owner and information security). Students and staff can be given different lifetimes per client in Keycloak.

## Guard

- **Lint:** ESLint `no-restricted-globals` / `no-restricted-properties` bans `localStorage`, `sessionStorage` and `indexedDB` in `apps/admin/src`, `apps/portal/src` and `packages/ui/src`. The exception is one allow-listed `preferences.ts` per app, for non-secret UI preferences.
- **BFF integration tests:**
  - cookie attributes;
  - CSRF refusals (wrong `Origin`, missing header);
  - two BFF instances refreshing one session at once perform one refresh;
  - logout revokes the refresh token, and back-channel logout deletes sessions by `sid`;
  - `/bff/session` never returns a token;
  - the dev-session route is refused outside development and test.
- **Realm check (unit test over `srs-realm.json`):**
  - every client is confidential;
  - no redirect URI contains `*`;
  - `accessTokenLifespan` is at most 300;
  - `revokeRefreshToken` is true;
  - no default or optional client scope is `offline_access`.
- **Header check in CI against the built images:** `connect-src 'self'` with no scheme sources (readiness 1.9 "Done when").

## Implementation notes (2026-11-22)

All three stages are built (BL-030, BL-160 to BL-163). These differ from the decision, or add to it:

- **One public pass-through.** The sign-in page's demo banner reads `/api/v1/demo/status` before anyone signs in, and the CSP lets the browser reach only its own origin. So the BFF forwards that one exact path, GET only, without a session or a token. The allow-list is `PUBLIC_PATHS` in `apps/bff/src/app.ts`.
- **nginx looks up the BFF per request.** The SPA images use a shared main config (`infra/docker/spa/nginx.conf`) and an entrypoint that writes the pod's DNS resolver. nginx then starts even before the BFF's name resolves, and returns 502 rather than failing.
- **The SPA images were not deployable before this.** Kubernetes ran them as UID 101 with every capability dropped, a read-only root and port 8080. The image ran nginx as root on port 80. They now listen on 8080 and keep pid and temporary files in `/tmp`. `scripts/check-spa-headers.sh` runs each built image that way in CI, and checks `connect-src 'self'` and the blocked back-channel route.
- **Development.** `apps/bff` `dev` runs both BFFs in one process (admin on 3010, portal on 3011), and each Vite server proxies `/bff` to its BFF. The realm's back-channel logout URLs use `host.docker.internal`, because compose runs Keycloak in Docker and the BFFs on the host.
- **Mocked UI tests answer `/bff/session` instead of running a BFF.** Full-stack suites (the golden journey, the UAT personas) create real BFF development sessions.
- **The display name follows the SPAs' order:** `name`, then given and family names, then the username.
- **The refresh lock moved.** The tab-locked browser refresh from BL-159 is gone; refresh happens in the BFF under the row lock (item 6).
- **Verified live** against Keycloak 26.0.7 in Chromium:
  - sign-in through the BFF;
  - the session's roles and tenant;
  - cookie attributes, with no cookie visible to page scripts;
  - tokens encrypted at rest;
  - logout.

  Back-channel logout is covered by the integration tests with signed logout tokens, not yet against a live Keycloak.

