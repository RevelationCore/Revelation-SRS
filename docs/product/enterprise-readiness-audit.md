# Enterprise readiness audit and remediation plan

> Status: Findings and proposed plan — not yet scheduled
>
> Audit date: 2026-11-18 · Commit: `f6ef7bb`
>
> Scope: `apps/api`, `apps/admin`, `apps/portal`, `modules/wellbeing`, `modules/attendance`, `adapters/vle`, `packages/*`, `infra/k8s`, `infra/docker`, CI

[Product documentation](README.md) · [Current capabilities](current-capabilities.md) · [Architecture](../architecture/README.md)

This audit reviews the codebase end to end against six qualities: secure, available, performant, scalable, maintainable and extensible. Each finding cites the code it rests on, and the plan at the end turns every finding into work with acceptance criteria.

**Method and limits.** This was a static review of the code, schema and deployment manifests, with targeted probes:

- migrations applied to a scratch database and its catalogue queried;
- searches for patterns across every service;
- reading the security-critical paths in full.

There was no load test, no penetration test and no review of a running cluster. Findings marked *verify* need one of those to confirm their size.

## Summary

The foundations are strong: strict typing, a consistent API style, broad automated testing and a real release pipeline. The serious gaps sit where the system meets production conditions:

- **Tenant isolation is not enforced by the database at run time.** Row-level security is written for almost every table, but the API and its whole test suite connect as a database superuser, which bypasses it. The production role it is designed for (`srs_app`) is granted by OpenBao but never created or given privileges by any migration. Several write paths would fail if that role were used.
- **The production token check does not pin the issuer or audience.** Any token signed by the same Keycloak is accepted. All three services also fall back to a well-known default secret when they are misconfigured.
- **Domain events can be lost.** They are published after the database commit, and only if NATS happens to be connected, so an outage silently drops them. The modules that build their state from those events then drift from the core.
- **Several features assume a single pod**, although the API runs at least two. Notifications, the caches and the workflow reconciler are all held per process.
- **Most list endpoints return everything:** 70 of the 74 tenant-wide lists have no page or limit.
- **The wellbeing service validates no input**, although it holds special-category health data.

None of these are hard to fix, and most fixes are local. The plan sequences them into four phases. Phase 1 (security and tenant isolation) should finish before any real institution's data is loaded.

## Scorecard

| Quality | Rating | Why |
|---|---|---|
| Secure | **Needs work** | Strong building blocks: RLS policies, authorisation on every API route (value-set reads are open to any signed-in user by design), audit hash chain, signed images, dependency audit. But RLS is not enforced at run time (SEC-1), token validation is loose (SEC-2, SEC-3), and the wellbeing service validates no input (SEC-4) |
| Available | **Needs work** | Probes, PodDisruptionBudgets, autoscaling, graceful shutdown and backups exist. But readiness depends on NATS (AVL-1), events are lost when NATS is down (AVL-2), outbound calls lack timeouts (AVL-3), and replicas are not spread across nodes (AVL-4) |
| Performant | **Adequate for pilot scale** | Bitemporal queries are well indexed where it matters, and CI enforces bundle size and Lighthouse budgets. But lists are unbounded (PERF-1), 135 foreign keys are unindexed (PERF-2), and there are N+1 patterns on both server and client (PERF-3, PERF-4) |
| Scalable | **Needs work** | The API is stateless apart from four in-process features that break with more than one pod (SCL-1 to SCL-4). The rate limit is per pod (SEC-6) |
| Maintainable | **Good** | `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`; 6 `any` uses in 59k lines; coverage ratchet (85% lines); 196 test files; consistent route schemas. But some files exceed 1,500 lines (MNT-1), migration 0009 holds 1,361 lines over 12 features (MNT-2), and error shapes differ between services (MNT-3) |
| Extensible | **Good** | Modules are separate services; there are event schemas with a registry, integration contracts, a delivery ledger, value sets and feature flags. Cross-domain coupling is moderate: 114 edges between 37 domains, 4 of them two-way (EXT-1). But the composition root wires about 80 services by hand (EXT-2) |

## Findings

Severity: **Critical** — exploitable or loses data, fix before production data · **High** — fix before go-live · **Medium** — fix in the first release cycle · **Low** — improvement.

### Security

| ID | Severity | Finding | Evidence | Impact |
|---|---|---|---|---|
| SEC-1 | **Critical** | Row-level security is not enforced at run time, and has never been tested against the API. The API connects as the database owner, who is a superuser in Docker; Testcontainers' default user is a superuser too. The production role `srs_app` is assumed by OpenBao but never created or granted by any migration. Six tenant tables have no RLS at all: `audit_record`, `notification`, `communication_dispatch_log`, `communication_template`, `demo_status`, `demo_load_checkpoint`. 52 queries run outside `withTenantContext` (for example `NotificationService.deliver`), and inserts into RLS tables there would fail under a non-superuser role | `apps/api/test/helpers/test-app.ts` (default container user); `infra/compose/docker-compose.yml:18`; `infra/k8s/base/openbao.yaml:143` (`GRANT srs_app` with no matching `CREATE ROLE`); catalogue query of `pg_class.relrowsecurity` | One missed `tenant_id` filter in application code exposes another institution's data, with no database backstop. Switching production to the intended role would break writes that have never run under it |
| SEC-2 | **High** | The RS256 path checks the signature only: no `issuer`, `audience` or `algorithms` | `packages/auth/src/plugins/jwt.ts:82` (`jwtVerify(token, jwks)`) | A token minted for another client or realm on the same Keycloak is accepted, including by the wellbeing and attendance services |
| SEC-3 | **High** | When `KEYCLOAK_JWKS_URL` and `JWT_SECRET` are both unset, the API, wellbeing and attendance services accept HS256 tokens signed with `dev-secret-replace-in-production`. Nothing refuses to start in production | `apps/api/src/config.ts:79`, `modules/*/src/config.ts:32` | A misconfigured deployment accepts forged tokens for any tenant and role |
| SEC-4 | **High** | The wellbeing service's 53 routes declare no request schema, so bodies, parameters and queries are unvalidated. Types are asserted (`as 'dsa' \| …`), not checked | `modules/wellbeing/src/routes/*.ts` (0 `schema:`); compare `apps/api` (544 schemas for 543 routes) | Malformed or hostile input reaches special-category storage; bad UUIDs surface as 500s; there is no OpenAPI for integrators |
| SEC-5 | Medium | The engagement proxy skips authentication and relies on the attendance module to authenticate. It forwards every incoming header (including `x-forwarded-*`), has no timeout and no size limit, and re-serialises bodies as JSON, which breaks multipart | `apps/api/src/routes/engagement-proxy.ts` | Header spoofing towards an internal service; a slow module ties up API connections; uploads through the proxy cannot work |
| SEC-6 | Medium | The rate limiter runs before authentication, so `req.tenantId` is always unset and it keys by IP. Counts are held in memory per pod, at 1,000 a minute | `apps/api/src/app.ts:651` | The limit is unpredictable and multiplied by the pod count. Users behind one campus NAT share a single budget, and an abusive user can't be throttled on their own |
| SEC-7 | Medium | The admin app and portal keep access tokens in `localStorage`, and neither has a Content-Security-Policy. Security headers rely on ingress `configuration-snippet` annotations, which ingress-nginx disables by default from v1.9 | `apps/*/src/auth/AuthContext.tsx`; `infra/docker/*/nginx.conf`; `infra/k8s/base/ingress.yaml:39` | Any XSS can take the token; the headers may silently not apply |
| SEC-8 | Medium | Special-category content (mental-health session notes, disability notes) is stored in plain text and relies on volume encryption | `modules/wellbeing/src/db/schema/mental-health.ts` (`content text`) | A database dump, backup or replica exposes clinical notes in full |
| SEC-9 | Low | `/api/v1/demo/status` and `/api/v1/openapi.json` are unauthenticated in every environment | `apps/api/src/routes/demo.ts:17`, `apps/api/src/app.ts:950` | Information disclosure; minor |

### Availability and resilience

| ID | Severity | Finding | Evidence | Impact |
|---|---|---|---|---|
| AVL-1 | **High** | `/ready` returns 503 when NATS is disconnected | `apps/api/src/routes/health.ts` (`nats` check, required) | A NATS outage marks every API pod unready, and the whole service goes down although most requests don't need NATS |
| AVL-2 | **High** | Domain events are dual-written: published after the commit, and only `if (eventBus.isConnected())`. Only workflow events use an outbox | `apps/api/src/platform/enrolment/service.ts:306` (one of 55 publish sites); `integration-bus/publisher.ts` | Events are lost during a NATS outage or a pod crash. The wellbeing, attendance and VLE projections diverge from core with no automatic repair |
| AVL-3 | Medium | Most of the 18 outbound `fetch` calls have no timeout (only 6 pass a signal) (the engagement proxy, module clients and others). The database pool has no connect or statement timeout | `grep "await fetch("`; `packages/db/src/pool.ts` (`max: 10, idle_timeout: 30`) | A slow dependency or query holds connections until the pool runs out |
| AVL-4 | Medium | No `topologySpreadConstraints` or anti-affinity anywhere; NATS and Temporal have 1 replica in the base manifests | `infra/k8s/base/*.yaml` | Both API replicas can land on one node, so a single node failure takes the service down. Single-replica NATS (*verify* the production overlay) is a single point of failure for events |
| AVL-5 | Low | The app creates the JetStream stream at start-up with default settings (one replica, unlimited retention, no discard policy) | `integration-bus/publisher.ts` (`ensureStream`) | Durability and retention are left to chance; stream configuration should be infrastructure |

### Performance

| ID | Severity | Finding | Evidence | Impact |
|---|---|---|---|---|
| PERF-1 | **High** | 70 of 74 tenant-wide list endpoints take no `limit`, page or cursor. Some return whole populations: registration-period confirmations, workflow tasks, status cases, CAS cases, UCAS applications, non-registration cases | `apps/api/src/routes/*.ts`; for example `registration-periods/service.ts` `listConfirmations` | At institution scale (`institution-year`: 50k students) single requests return tens of megabytes, with slow responses, memory spikes and timeouts |
| PERF-2 | Medium | 135 single-column foreign keys have no index; 28 tenant tables have no index starting with `tenant_id` | Catalogue query on a fresh migration | Joins and cascades are slow; RLS predicates scan sequentially on those tables |
| PERF-3 | Medium | 64 loops await a query per item | `grep "for (const … of …)"` followed by `await` in `apps/api/src/platform` | Latency grows linearly with batch size (allocation, returns, distribution) |
| PERF-4 | Low | Client N+1: the wellbeing and email screens fetch each student's name with a separate request | `apps/admin/src/pages/WellbeingShared.tsx` `usePersonNames` | Slow caseloads, and load on the API |

### Scalability (multiple pods)

| ID | Severity | Finding | Evidence | Impact |
|---|---|---|---|---|
| SCL-1 | **High** | The notification stream (SSE) pushes only to connections held by the pod that created the notification | `notification-service.ts` (`connections` map) | With 2 or more pods, students miss live notifications until they reload |
| SCL-2 | Medium | The value-set (10 min) and rules-engine (5 min) caches are held per pod and are only invalidated on the pod that made the change | `value-sets/service.ts`, `rules-engine/engine.ts:177` | After a relabel or a rule change, pods disagree for up to 10 minutes. For academic rules, two requests can be decided differently |
| SCL-3 | Medium | The worker's reconciler runs on a timer in every replica (2 by default), and nothing makes the replicas take turns | `apps/api/src/worker.ts:89`; `infra/k8s/base/workers.yaml` (`replicas: 2`) | Duplicate reconciliation work, and races (*verify* idempotency under concurrency) |
| SCL-4 | Low | The overdue-notice job is designed for external scheduling, but the manifests define no CronJob for it | `workflow-escalation-service.ts` | Notices may never run, or run per pod if scheduled in process |

### Maintainability

| ID | Severity | Finding | Evidence | Impact |
|---|---|---|---|---|
| MNT-1 | Medium | Some files exceed 1,000 lines: `StudentDetailPage.tsx` (1,902), `module-selection/service.ts` (1,848), `routes/platform-controls.ts` (1,403), `routes/students.ts` (1,340), `app.ts` (1,080) | `wc -l` | Hard to review and test; frequent merge conflicts |
| MNT-2 | Medium | Migration 0009 has grown to 1,361 lines over 12 features, and the core set sits at the 10-file limit | `packages/db/migrations/0009_audiences_and_evidence.sql` | Databases that already ran 0009 never get later additions; the history no longer tells the story |
| MNT-3 | Low | Error bodies are inconsistent: the API uses problem+json, while the wellbeing and attendance services return `{ error }` in 17 places | `modules/*/src/routes` | Clients need two error parsers; operators see different shapes |
| MNT-4 | Low | 87 lint warnings, mostly `no-console` in scripts | `pnpm lint` | Noise that hides new warnings |

### Extensibility

| ID | Severity | Finding | Evidence | Impact |
|---|---|---|---|---|
| EXT-1 | Low | Four pairs of domains depend on each other both ways: adjustments ↔ delivery, module-selection ↔ registration, admissions ↔ regulatory, enrolment ↔ workflow | Import graph of `apps/api/src/platform` | These pairs can't be extracted or replaced on their own |
| EXT-2 | Low | The composition root constructs about 80 services by hand in `buildApp`. There's no module registration contract, so adding a capability means editing the root | `apps/api/src/app.ts` | Principle 6 (pluggable architecture) is met for separate services, but not inside the core |

### What is already good — keep it

- Route-level permission checks on every API route, from one permission map in `packages/domain`.
- Problem+json errors and TypeBox schemas across the API, with OpenAPI generated and checked for drift in CI.
- Bitemporal storage with guards, an append-only audit log with a hash chain and partition seals.
- A real release pipeline: Trivy image scan, cosign signing, dependency audit, Lighthouse and bundle budgets, mocked UI, a real full-stack journey, and contract tests.
- Separate deployable services for wellbeing and attendance, keeping special-category data out of core.
- Secrets through OpenBao with dynamic database credentials; network policies; production PodDisruptionBudgets; backups with an age alert and a restore script.

## Remediation plan

Four phases. Each item has an owner area, a size (S under 1 day, M 1 to 3 days, L 3 to 8 days), acceptance criteria and the test or check that proves it. Phase 1 should complete before real institutional data is loaded; phases 2 and 3 before go-live; phase 4 continues alongside feature work.

### Phase 1 — Security and tenant isolation (about 2 weeks)

| Item | Fixes | Size | What to do | Done when |
|---|---|---|---|---|
| 1.1 Application database role | SEC-1 | M | Migration creates `srs_app` (NOSUPERUSER, NOBYPASSRLS) with DML grants on all tables and default privileges for future ones; migrations keep running as the owner. The compose stack and test helper connect the API as a login role that inherits `srs_app` | `\du` shows `srs_app` without bypass; the API in compose runs as it |
| 1.2 Run the API suite under RLS | SEC-1 | M | `startTestApp` migrates as superuser and builds the app with a second connection as `srs_app`. Fix every query that fails: move it into `withTenantContext`, or a named, audited system context for genuine cross-tenant jobs (retention, tenant listing) | The full API suite passes connected as `srs_app` |
| 1.3 RLS on the remaining tenant tables | SEC-1 | S | Enable and force RLS on `notification`, `communication_dispatch_log`, `audit_record` (tenant rows, plus a policy for platform rows), `communication_template` (null-tenant read) and the demo tables. Add a CI check that fails on any table with `tenant_id` but no RLS | Catalogue check in CI; isolation tests per table |
| 1.4 Cross-tenant isolation test | SEC-1 | M | A generated test signs in as tenant B and calls every GET route with tenant A's IDs (from the OpenAPI spec and fixtures); none may return A's data | Runs in CI and covers every route |
| 1.5 Strict token validation | SEC-2 | S | Pin `issuer`, `audience` and `algorithms: ['RS256']` (configurable per service), and add a clock tolerance. Apply to all services through `@revelation-srs/auth` | Tests: wrong issuer, audience or algorithm gets 401 |
| 1.6 Refuse insecure configuration | SEC-3 | S | Outside `development` and `test`, refuse to start without a JWKS URL, or with the default or a short HS256 secret. Same in the modules | Start-up test per service |
| 1.7 Validate wellbeing input | SEC-4 | M | TypeBox schemas for all 53 wellbeing routes (UUIDs, enums from the state machines, lengths); problem+json errors; generate its OpenAPI | 0 routes without a schema (a CI check like `check:coded-values`); a bad UUID returns 400, not 500 |
| 1.8 Fix the engagement proxy | SEC-5 | S | Authenticate in core before forwarding; forward an allow-list of headers only; stream the body unchanged; 15 s timeout; body limit | Proxy tests: unauthenticated gets 401; multipart passes through; timeout gets 504 |
| 1.9 Content-Security-Policy and tokens | SEC-7 | M | Set CSP, HSTS and frame headers in the SPA nginx config (not only the ingress); keep tokens in memory, with refresh handled by a short-lived refresh flow (or a backend-for-frontend cookie, *decide*) | Lighthouse and header checks in CI; no token in `localStorage` |

**Status (2026-11-19, updated 2026-11-22).** Items 1.1 to 1.9 are delivered. The rest of 1.9, moving tokens out of `localStorage`, was decided by ADR-026 and built on 2026-11-22 (BL-030): the SPAs hold no token, a backend-for-frontend per app holds them behind an HTTP-only cookie, and the CSP is `connect-src 'self'`. All of this is on branch `phase-1-security-isolation`, after squashing migrations 0000–0009 into `0000_baseline` (item 4.1, done first). Phase 1's database changes are one migration, `0001_security_and_tenant_isolation`. Where the delivery differs from the table:

- 1.2 needed no cross-tenant system context: the cross-tenant jobs already list tenants (`tenant` has no RLS) and work per tenant. Running under RLS found a real defect in every policy: a cleared tenant setting reads as `''`, which the `::uuid` cast rejected. All 208 policies now use `NULLIF`.
- 1.5 and 1.6: outside development and test, HS256 is refused whatever the secret, so "default or short secret" is covered by "no HS256". The Kubernetes manifests had no JWKS URL at all; they now set one.
- 1.7: status codes are checked by the domain's transition rules (409 with the allowed next statuses), not schema enums, and lengths are not capped. Response schemas are not declared yet.
- Found on the way and fixed: the wellbeing EC claim routes checked no permission (new `ec-claim:read` and `ec-claim:manage`, role mapping for sign-off); `getTemplate` returned another tenant's template by id; feature-flag impact listed other tenants.
- Found on the way, not fixed, now in the [backlog](backlog.md):
  - the rate limiter runs before authentication, so it keys every caller by IP, never by tenant (BL-020, item 3.7);
  - Kubernetes sets `ALLOWED_ORIGINS` but the API reads `CORS_ORIGINS` (BL-033);
  - the wellbeing and attendance suites still connect as the superuser, so RLS is not yet proven there the way item 1.2 proves it for the API (BL-034);
  - `wellbeing.srs_handoff_outbox` and `wellbeing.srs_ec_handoff_outbox` have a `tenant_id` but no RLS, and the coverage check covers the core schemas only (BL-035);
  - the EC claim role mapping needs sign-off (BL-036);
  - token storage, the rest of 1.9, is BL-030, waiting on decision 1 (BL-031).

Every item in this plan has a row in the [backlog](backlog.md) (Source ref `Readiness N.M`), where its status is tracked; `pnpm check:backlog` fails if one is missing.

### Phase 2 — Availability and consistency (about 2 weeks)

| Item | Fixes | Size | What to do | Done when |
|---|---|---|---|---|
| 2.1 Transactional outbox for domain events | AVL-2 | L | Each publish site writes an `event_outbox` row in the same transaction as the change (generalising the existing workflow outbox); a relay in the worker publishes and marks rows, with retries and an event ID for de-duplication; consumers de-duplicate on that ID | Test: NATS down during a change, NATS back, event delivered exactly once to a consumer |
| 2.2 Readiness without NATS | AVL-1 | S | `/ready` checks only the database (and Keycloak JWKS reachability, cached). NATS, the outbox lag and Temporal are reported on `/health/details` and in metrics with alerts | Pods stay ready with NATS stopped (compose test) |
| 2.3 Timeouts everywhere | AVL-3 | S | A shared `fetchWithTimeout` (default 10 s), used for every outbound call; a database connect timeout, a `statement_timeout` per pool (for example 30 s API, 5 min worker) and `idle_in_transaction_session_timeout` | A lint rule bans bare `fetch` in services; pool settings are tested |
| 2.4 Spread and replicate | AVL-4, AVL-5 | S | Topology spread constraints for the API, admin, portal, worker and modules; NATS at 3 replicas with the JetStream stream declared as infrastructure (replicas 3, retention and limits) rather than created by the app | Manifest review; kubeval and Kustomize build in CI |
| 2.5 Idempotent, leader-elected jobs | SCL-3, SCL-4 | M | The reconciler takes a Postgres advisory lock per run, or uses `FOR UPDATE SKIP LOCKED` on its work rows; overdue notices become a Kubernetes CronJob | Test: two reconcilers in parallel do the work once |

### Phase 3 — Scale and performance (about 2 weeks)

| Item | Fixes | Size | What to do | Done when |
|---|---|---|---|---|
| 3.1 Pagination contract | PERF-1 | L | One cursor-pagination convention (`limit`, default 50, maximum 200, with `cursor`) for every tenant-wide list; responses carry `nextCursor`; admin tables page or load more; a CI check fails on new unbounded list routes | All 70 routes paged; the check is in CI |
| 3.2 Index review | PERF-2 | M | Add indexes for the 135 unindexed foreign keys where the child table can grow, and `(tenant_id, …)` leading indexes on the 28 tables; a CI check reports unindexed foreign keys on growing tables | Catalogue check in CI; `EXPLAIN` on the top 20 queries uses indexes |
| 3.3 Load test baseline | PERF-1 to PERF-3 | M | Extend the k6 suites (`infra/k6`) to the `institution-year` scenario: p95 targets per route class (reads < 300 ms, writes < 800 ms), run nightly | A nightly report, with regressions flagged |
| 3.4 Remove N+1 loops | PERF-3, PERF-4 | M | Batch the 64 loops where they run per request (set-based queries, `inArray`); add a batch student-summary endpoint and use it in `usePersonNames` | Query counts asserted in tests for the main hot paths |
| 3.5 Shared cache invalidation | SCL-2 | M | Publish an invalidation message on change (NATS core subject, or Postgres `LISTEN/NOTIFY`) to which every pod listens; academic-rule lookups go uncached, or cached with immediate invalidation | Test: a change on pod A is visible on pod B at once |
| 3.6 Cross-pod notifications | SCL-1 | M | Deliver notification events to all pods (NATS subject, or `LISTEN/NOTIFY`); each pod pushes to its own connections | Test with two API instances |
| 3.7 Distributed rate limiting | SEC-6 | S | Rate-limit store in Redis or Valkey (or Postgres); key by user after authentication and by IP before it; separate budgets for writes and the public verification routes | Limits hold across pods |

### Phase 4 — Maintainability and extensibility (continuous)

| Item | Fixes | Size | What to do |
|---|---|---|---|
| 4.1 Squash and split migrations | MNT-2 | M | Before the next schema change, squash 0000–0009 into a new baseline (the procedure is in the data migration plan) and set a rule: one migration per feature, never edit an applied one |
| 4.2 Break up the largest files | MNT-1 | M | Split `StudentDetailPage` into a file per tab, `module-selection/service.ts` by concern (diets, windows, allocation), and the route files by resource; `app.ts` registers domain plugins (see 4.4) |
| 4.3 One error shape | MNT-3 | S | A shared problem+json error handler in `@revelation-srs/auth` (or a new `@revelation-srs/http` package), used by all services |
| 4.4 Domain plugins | EXT-2 | L | Each domain exports a Fastify plugin that constructs its services and registers its routes from declared dependencies; `buildApp` composes plugins. This makes adding or removing a capability a one-line change |
| 4.5 Remove two-way dependencies | EXT-1 | M | Break the four cycles with events or a small shared interface; add an import-boundary lint rule (`eslint-plugin-boundaries`, or depcruise) so new cycles fail CI |
| 4.6 Encrypt special-category content | SEC-8 | M | Envelope encryption (OpenBao Transit) for session notes and disability notes in the wellbeing service; keys rotated; reads are already audited |
| 4.7 Clear the lint warnings | MNT-4 | S | Fix or explicitly allow the 87 warnings, then make `--max-warnings 0` the CI rule |
| 4.8 Hide internal endpoints in production | SEC-9 | S | Serve the OpenAPI document and demo status only when docs or demo are enabled |

### Decisions needed

1. **Token storage (1.9):** keep tokens in memory with silent refresh, or put a backend-for-frontend in front of the SPAs with HTTP-only cookies. The second is stronger but adds a component. Recommendation: in memory now, backend-for-frontend if a penetration test asks for it. **Decided 2026-11-20 ([ADR-026](../decisions/ADR-026-browser-sessions-through-a-backend-for-frontend.md)): a backend-for-frontend now.** RFC 10017 (BCP 212) strongly recommends one for apps handling personal data, because tokens in memory do not stop injected script from running a fresh sign-in.
2. **Shared cache and rate-limit store (3.5, 3.7):** add Redis or Valkey, or use Postgres (`LISTEN/NOTIFY`, a counter table). Recommendation: Postgres first; it is already highly available and avoids a new component at this scale. **Decided 2026-11-20 ([ADR-027](../decisions/ADR-027-shared-runtime-state-in-postgresql.md)): PostgreSQL for all four uses**, with a measured threshold for moving rate limits to Valkey.
3. **Migration squash timing (4.1):** squash before phase 1's migrations (one clean baseline for the role and RLS changes), or after. Recommendation: before.

### Verification across the plan

New CI checks, so the gains cannot regress:

- every table with a `tenant_id` has RLS (1.3);
- the API suite runs as `srs_app` (1.2);
- the cross-tenant route test passes (1.4);
- no route lacks a schema (1.7);
- no bare `fetch` in services (2.3);
- no unbounded list route (3.1);
- unindexed foreign keys are reported (3.2);
- import boundaries hold (4.5);
- zero lint warnings (4.7).

The nightly k6 run (3.3) adds performance regression signals.
