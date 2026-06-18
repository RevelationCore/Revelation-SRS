# Phase 11 Residual Register

> Published: 2026-06-18
> Last updated: 2026-06-18 (Stage 10 — all items closed)
> Source: Phase 10 acceptance review, Phase 10.5 residual register, Phase 11 Stage 0 CI baseline
> Owner: Steve J White

This register consolidates all known gaps and open items entering Phase 11. Every item has a severity, target stage, release-blocking status, and disposition.

**Status at Stage 10**: All 23 residuals are Closed or have an accepted exception. v1.0.0 approved.

---

## Severity definitions

| Severity | Meaning |
|---|---|
| Critical | Security: CRITICAL CVE or auth bypass. Must be fixed before any release candidate. |
| High | Security: HIGH CVE; or functional gap that prevents core SRS operations; or gate-blocking NFR failure. Must be fixed before v1.0.0. |
| Medium | Functional gap that degrades a significant feature; or a security finding that is mitigated by other controls. Fix before v1.0.0 unless formally accepted. |
| Low | Minor functional gap, cosmetic issue, or non-blocking enhancement. May be deferred to post-release with release note. |

---

## Section 1 — Phase 10 Residuals (carried forward)

### R-NOTIFY-001 — Notification centre is scaffold only

**Severity**: High
**Stage**: 5 (Track A)
**Blocking**: Yes
**Status**: **Closed**

Notification centre (`NotificationsPage`) renders a static empty state. No NATS JetStream consumer delivers real-time notifications to the portal. Delivery mechanism decided in Stage 0: Server-Sent Events (SSE).

**Disposition**: Implement in Stage 5 Track A — NATS consumer + SSE stream endpoint + portal notification centre.

---

### R-VLE-001 — Grade sync conflict resolution UI missing

**Severity**: Medium
**Stage**: 5 (Track B)
**Blocking**: No
**Status**: **Closed**

No UI to surface VLE-vs-SRS mark discrepancies for staff resolution in `ExamBoardDetailPage`.

**Disposition**: Implement in Stage 5 Track B.

---

### R-VLE-002 — Manual enrolment override audit trail UI missing

**Severity**: Low
**Stage**: 5 (Track B)
**Blocking**: No
**Status**: **Closed**

No audit trail view in `StudentDetailPage` corrections tab for VLE enrolment override events.

**Disposition**: Implement in Stage 5 Track B using the entity audit log API added in Stage 3.

---

### R-VLE-003 — Bulk reconciliation trigger UI missing

**Severity**: Low
**Stage**: 5 (Track B)
**Blocking**: No
**Status**: **Closed**

No trigger button in `IntegrationOpsPage` to initiate a bulk VLE reconciliation job.

**Disposition**: Implement in Stage 5 Track B.

---

### R-I18N-001 — Welsh locale not implemented

**Severity**: Low
**Stage**: 5 (Track C)
**Blocking**: No
**Status**: **Closed**

Only `en-GB` locale is delivered. Welsh (`cy`) locale files not yet created. Note: Welsh is a left-to-right language — RTL rendering is not required and is explicitly out of scope for this item.

**Disposition**: Add Welsh locale files and language switcher in Stage 5 Track C.

---

### R-I18N-002 — Value-set label interpolation incomplete

**Severity**: Low
**Stage**: 5 (Track C)
**Blocking**: No
**Status**: **Closed**

Value-set API labels not fully loaded into i18n namespace; UI falls back to raw domain codes in some edge cases.

**Disposition**: Fix in Stage 5 Track C.

---

### R-API-001 — No aggregate enrolment volumes endpoint

**Severity**: Medium
**Stage**: 2
**Blocking**: No (performance impact: N+1 client-side fetching)
**Status**: **Closed**

`EnrolmentReportPage` fetches first 50 students client-side for sampling. No server-side aggregate endpoint exists.

**Disposition**: Add `GET /api/v1/reporting/enrolment-volumes` in Stage 2 (performance hardening, closes R-PERF-002).

---

### R-API-002 — No entity-level audit log API

**Severity**: Medium
**Stage**: 3
**Blocking**: No
**Status**: **Closed**

`AuditPage` uses integration exchange proxy with a gap notice. No `GET /api/v1/audit-log` endpoint with entity type/ID filters.

**Disposition**: Implement in Stage 3 (security hardening).

---

### R-API-003 — Student EC submission uses staff-facing endpoint

**Severity**: Medium
**Stage**: 5 (Track C)
**Blocking**: No
**Status**: **Closed**

`POST /api/v1/exceptional-circumstances` requires staff-only fields (`outcomeCode`, `determinationDate`). Portal submission deferred. A student-facing variant endpoint (`POST /api/v1/exceptional-circumstances/submissions`) is required.

**Disposition**: Design and implement student-facing variant in Stage 5 Track C.

---

### R-A11Y-001 — Admin mobile navigation overflow

**Severity**: Low
**Stage**: 4
**Blocking**: No
**Status**: **Accepted exception** (2026-06-18)

Admin nav is a flat horizontal `<nav>` with no responsive breakpoints. At 375×667 (mobile), links overflow. Admin is a desktop-first tool; Stage 4 manual audit confirmed no mobile use case for admin users.

**Disposition**: Formally accepted. Documented in `release-checklist.md` and admin accessibility statement (`/accessibility`). Post-release: may be revisited if a mobile admin use case emerges.

---

### R-A11Y-002 — Dialog/modal focus trap not implemented

**Severity**: High
**Stage**: 4
**Blocking**: Yes
**Status**: **Closed**

Custom inline confirm patterns have no focus trap and focus does not return to the trigger element after confirm/cancel. This fails WCAG 2.1 AA 2.4.3 Focus Order and 2.1.2 No Keyboard Trap.

**Disposition**: Migrate confirm patterns to a shared accessible `<Dialog>` primitive (Radix UI) in Stage 4. Not eligible for exception acceptance.

---

### R-PERF-001 — Lighthouse CI not wired

**Severity**: Medium
**Stage**: 1
**Blocking**: Yes (NFR-PERF-005)
**Status**: **Closed**

Bundle-size check is CI-enforced but runtime performance (LCP, FCP, TTI) is unverified. Lighthouse CI has not been configured.

**Disposition**: Add `@lhci/cli` to CI in Stage 1. LCP ≤ 2.5s, FCP ≤ 1.5s, TTI ≤ 3.5s on key pages.

---

### R-PERF-002 — EnrolmentReportPage N+1 client-side fetching

**Severity**: Medium
**Stage**: 2
**Blocking**: No (resolved by R-API-001)
**Status**: **Closed**

`EnrolmentReportPage` performs N+1 student→enrolment fetches client-side.

**Disposition**: Resolved when `GET /api/v1/reporting/enrolment-volumes` is implemented in Stage 2.

---

## Section 2 — Phase 10.5 Residuals (carried forward)

### RR-001 — Story-marker presence not validated at DB level

**Severity**: Low
**Stage**: 5 (Track D)
**Blocking**: No
**Status**: **Closed**

`validateScenario` does not verify that every marker declared in `manifest.storyMarkers` has a corresponding DB row.

**Disposition**: Add per-scenario story-marker resolution checks in Stage 5 Track D.

---

### RR-002 — RLS tenant-isolation not checked at SQL policy level

**Severity**: Medium
**Stage**: 3
**Blocking**: Yes
**Status**: **Closed**

Validate checks test `tenant_id` data values but do not verify PostgreSQL RLS policies using a restricted role.

**Disposition**: Add restricted-role RLS validation in Stage 3.

---

### RR-003 — No live external endpoint check

**Severity**: Medium
**Stage**: 3
**Blocking**: No
**Status**: **Closed**

`validateScenario` does not check that all `integration_contract` base URLs are demo/stub domains.

**Disposition**: Add domain-pattern check in Stage 3.

---

### RR-004 — Wellbeing role-gate validation not implemented

**Severity**: Medium
**Stage**: 3
**Blocking**: Yes
**Status**: **Closed**

Wellbeing schema access control not validated programmatically. Depends on restricted-role infrastructure from RR-002.

**Disposition**: Implement in Stage 3, after RR-002 infrastructure is in place.

---

### RR-005 — S6 load time not measured against budget in CI

**Severity**: Low
**Stage**: 2
**Blocking**: No
**Status**: **Closed**

S6 integration test measures load time but does not persist the measurement as a CI trend artefact.

**Disposition**: Add load-time metric publication in Stage 2.

---

### RR-006 — Playwright golden suite not wired to CI

**Severity**: High
**Stage**: 1
**Blocking**: Yes
**Status**: **Closed**

Golden Playwright suite skips automatically when API unreachable; it has not been verified to pass in a full-stack CI environment.

**Disposition**: Wire to a dedicated `golden-e2e` CI job in Stage 1.

---

### RR-007 — `clock.now()` callsite audit incomplete

**Severity**: Medium
**Stage**: 1
**Blocking**: Yes
**Status**: **Closed**

`new Date()` / `Date.now()` callsites in `apps/api/src/**` not audited. Risk: bitemporal records use wall time instead of the injectable clock.

**Disposition**: Add ESLint rule or grep-based CI check in Stage 1.

---

### RR-008 — Snapshot/restore strategy not documented

**Severity**: Low
**Stage**: 7
**Blocking**: No
**Status**: **Closed**

Demo rotation runbook lacks a `pg_dump`-based snapshot/restore procedure for fast rollback.

**Disposition**: Add runbook section and optional pre-rotation snapshot script in Stage 7.

---

### RR-009 — S1–S5 scenario validators are minimal

**Severity**: Low
**Stage**: 5 (Track D)
**Blocking**: No
**Status**: **Closed**

`SCENARIO_CHECKS` for early scenarios lack domain-specific record checks.

**Disposition**: Extend per-scenario validators in Stage 5 Track D.

---

### RR-010 — Golden Playwright spec tenant_id is hardcoded

**Severity**: Low
**Stage**: 3
**Blocking**: No
**Status**: **Closed**

`injectStaffAuth` falls back to `'test-golden'` because `GET /api/v1/demo/status` does not return `tenantId`.

**Disposition**: Extend demo status response in Stage 3.

---

## Section 3 — Phase 11 Baseline Findings (new)

### P11-CI-001 — ESLint `tsconfig.eslint.json` excludes adapters/ and modules/

**Severity**: High
**Stage**: 1
**Blocking**: Yes (CI gate is failing)
**Status**: **Closed**

`tsconfig.eslint.json` includes only `apps/**` and `packages/**`. Files in `adapters/` and `modules/` cannot be type-checked by ESLint parser, causing a parsing error on every file in those paths. Root-level `playwright.config.ts` and `playwright.golden.config.ts` are also excluded.

**Disposition**: Add `adapters/**/*.ts`, `modules/**/*.ts`, and root playwright configs to `tsconfig.eslint.json` in Stage 1. Then address rule violations that surface.

---

### P11-CI-002 — ~488 ESLint rule violations in in-scope packages

**Severity**: Medium
**Stage**: 1
**Blocking**: Yes (CI gate is failing)
**Status**: **Closed**

533 errors (55 warnings) in currently in-scope packages. Dominant violations: `no-unsafe-assignment` (82), `no-unsafe-member-access` (68), `no-unsafe-call` (66), `import-x/order` (59), `no-unused-vars` (29). The `no-unsafe-*` rules fire on Drizzle ORM result types and untyped demo generator patterns.

**Disposition**: Remediate in Stage 1. `import-x/order` and `no-unused-vars` are auto-fixable. `no-unsafe-*` violations require adding explicit type annotations or using `// eslint-disable-next-line` with justification where the pattern is intentional.

---

### P11-CI-003 — vitest exits code 1 for packages with no unit test files

**Severity**: Low
**Stage**: 1
**Blocking**: Yes (breaks `pnpm test`)
**Status**: **Closed**

`adapters/vle` and `modules/wellbeing` have integration tests only. Their `vitest.config.ts` files do not set `passWithNoTests: true`, so `pnpm test` fails on an empty include match.

**Disposition**: Add `passWithNoTests: true` to both vitest configs in Stage 1.

---

### P11-DEP-001 — `fast-jwt` CRITICAL — JWT auth bypass (via `@fastify/jwt`)

**Severity**: Critical
**Stage**: 3
**Blocking**: Yes
**Status**: **Closed**

`fast-jwt` (used internally by `@fastify/jwt@^9`) has multiple critical vulnerabilities: incomplete fix for CVE-2023-48223, JWT auth bypass via empty HMAC secret, cache confusion via `cacheKeyBuilder`.

**Disposition**: Upgrade `@fastify/jwt` to the latest patched version in Stage 3. Verify the JWT authentication middleware in `apps/api` is not affected by the cache confusion vulnerability pattern.

---

### P11-DEP-002 — `drizzle-orm@^0.36` HIGH — SQL injection

**Severity**: High
**Stage**: 3
**Blocking**: Yes
**Status**: **Closed**

`drizzle-orm` versions `< 0.45.2` have a SQL injection vulnerability via improperly escaped SQL identifiers. Current pinned range `^0.36.0`.

**Disposition**: Upgrade `drizzle-orm` to `>=0.45.2` in Stage 3. Assess for breaking changes (major version jump from 0.36 → 0.45); update affected ORM callsites if required.

---

### P11-DEP-003 — `axios` HIGH — SSRF, DoS, prototype pollution

**Severity**: High
**Stage**: 3
**Blocking**: Yes
**Status**: **Closed**

Multiple high-severity advisories: SSRF (incomplete fix for CVE-2025-62718, NO_PROXY bypass), DoS via `__proto__`, prototype pollution gadgets in response/headers handling.

**Disposition**: Upgrade `axios` to latest patched version in Stage 3.

---

### P11-DEP-004 — `protobufjs` HIGH — via Temporal SDK

**Severity**: High
**Stage**: 3
**Blocking**: Yes unless upstream fixes available
**Status**: **Closed**

`protobufjs` (transitively required by `@temporalio/*`) has code injection, code generation gadget, and DoS vulnerabilities. No direct upgrade path without waiting for Temporal SDK to update.

**Disposition**: In Stage 3, check whether Temporal SDK updates ship a patched `protobufjs`. If a fix is available, upgrade. If not, document as an accepted upstream dependency risk with mitigation note (protobufjs is only used for Temporal gRPC proto encoding; it is not exposed to untrusted user input in the SRS data path).

---

### P11-DEP-005 — `undici` HIGH — WebSocket memory/exception

**Severity**: High
**Stage**: 3
**Blocking**: Review in Stage 3
**Status**: **Closed**

`undici` (Node.js built-in fetch internals) has two high-severity issues in its WebSocket client implementation. The SRS does not use WebSocket directly; this is a transitive/platform-level dependency.

**Disposition**: In Stage 3, verify whether SRS code paths trigger the vulnerable WebSocket client paths. If not, document as accepted risk with mitigation note. Monitor Node.js LTS patch.

---

## Section 4 — Disposition Summary

| ID | Severity | Blocking | Stage | Status |
|---|---|---|---|---|
| R-NOTIFY-001 | High | Yes | 5A | Open |
| R-VLE-001 | Medium | No | 5B | Open |
| R-VLE-002 | Low | No | 5B | Open |
| R-VLE-003 | Low | No | 5B | Open |
| R-I18N-001 | Low | No | 5C | Open |
| R-I18N-002 | Low | No | 5C | Open |
| R-API-001 | Medium | No | 2 | Open |
| R-API-002 | Medium | No | 3 | Open |
| R-API-003 | Medium | No | 5C | Open |
| R-A11Y-001 | Low | TBD Stage 4 | 4 | Open |
| R-A11Y-002 | High | Yes | 4 | Open |
| R-PERF-001 | Medium | Yes | 1 | Open |
| R-PERF-002 | Medium | No | 2 | Open |
| RR-001 | Low | No | 5D | Open |
| RR-002 | Medium | Yes | 3 | Open |
| RR-003 | Medium | No | 3 | Open |
| RR-004 | Medium | Yes | 3 | Open |
| RR-005 | Low | No | 2 | Open |
| RR-006 | High | Yes | 1 | Open |
| RR-007 | Medium | Yes | 1 | Open |
| RR-008 | Low | No | 7 | Open |
| RR-009 | Low | No | 5D | Open |
| RR-010 | Low | No | 3 | Open |
| P11-CI-001 | High | Yes | 1 | Open |
| P11-CI-002 | Medium | Yes | 1 | Open |
| P11-CI-003 | Low | Yes | 1 | Open |
| P11-DEP-001 | Critical | Yes | 3 | Open |
| P11-DEP-002 | High | Yes | 3 | Open |
| P11-DEP-003 | High | Yes | 3 | Open |
| P11-DEP-004 | High | Yes (unless upstream) | 3 | Open |
| P11-DEP-005 | High | Review Stage 3 | 3 | Open |
