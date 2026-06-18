# Phase 11 Stage 0 — Baseline, Residual Triage, and Release Gates

> Date: 2026-06-18
> Status: Complete
> Author: Steve J White

---

## 1. Purpose

This document records the Phase 11 CI baseline, all Phase 10/10.5 residual dispositions, key architectural decisions locked for Phase 11, and the benchmark dataset confirmation. It is the entry gate for all subsequent Phase 11 stages.

---

## 2. CI Baseline (2026-06-18)

The following checks were run locally against the `main` branch at the start of Phase 11.

### 2.1 TypeScript

| Check | Result | Notes |
|---|---|---|
| `pnpm typecheck` (all packages) | ✅ **Pass** | Zero errors across all 11 workspace packages |

### 2.2 Lint

| Check | Result | Notes |
|---|---|---|
| `pnpm lint` | ❌ **Fail** | 533 errors, 55 warnings — registered as P11-CI-001 and P11-CI-002 |

Root causes:
1. **P11-CI-001** — `tsconfig.eslint.json` includes only `apps/**` and `packages/**`; it excludes `adapters/`, `modules/`, and root-level `.ts` files (`playwright.config.ts`, `playwright.golden.config.ts`). ESLint parser cannot type-check these files, causing a parsing error on every file in those paths.
2. **P11-CI-002** — Once the tsconfig include is fixed, the real violations in `adapters/vle` and `modules/wellbeing` will surface. Pre-measured violation categories from in-scope packages:

| Rule | Count | Notes |
|---|---|---|
| `@typescript-eslint/no-unsafe-assignment` | 82 | Predominantly demo-data and wellbeing generators |
| `@typescript-eslint/no-unsafe-member-access` | 68 | |
| `@typescript-eslint/no-unsafe-call` | 66 | |
| `import-x/order` | 59 | Import group ordering violations |
| `no-console` | 55 | All warnings (not errors) — CLI scripts |
| `@typescript-eslint/no-unnecessary-type-assertion` | 32 | |
| `@typescript-eslint/no-unused-vars` | 29 | |
| `@typescript-eslint/require-await` | 7 | |
| Other | ~12 | `restrict-template-expressions`, `no-redundant-type-constituents`, etc. |

Both issues are assigned to Stage 1 for remediation (CI quality gate hardening).

### 2.3 Unit Tests

| Package | Result | Test count | Notes |
|---|---|---|---|
| `apps/api` | ✅ Pass | 28 | |
| `packages/demo-data` | ✅ Pass | 277 | |
| `packages/domain` | ✅ Pass | — | (no unit test script; covered by integration) |
| `adapters/vle` | ❌ Fail | 0 | No unit test files exist; vitest exits code 1 on empty suite — registered as P11-CI-003 |
| `modules/wellbeing` | ❌ Fail | 0 | Same as above — registered as P11-CI-003 |

**P11-CI-003** — `vitest.config.ts` for `adapters/vle` and `modules/wellbeing` does not set `passWithNoTests: true`. The root `pnpm test` command fails due to these packages. Fix: add `passWithNoTests: true` to both vitest configs, or add unit tests. Assigned to Stage 1.

All other packages: unit tests pass.

### 2.4 Dependency Audit

`pnpm audit` result: **4 critical, 27 high, 34 moderate, 2 low** (67 total vulnerabilities).

| ID | Severity | Package | Issue | Patched version | Stage |
|---|---|---|---|---|---|
| P11-DEP-001 | **Critical** | `fast-jwt` (via `@fastify/jwt@^9`) | Incomplete fix for CVE-2023-48223; JWT auth bypass; cache confusion | `@fastify/jwt` upgrade needed | Stage 3 (blocking) |
| P11-DEP-002 | **Critical** | `fast-jwt` (via `@fastify/jwt@^9`) | JWT auth bypass via empty HMAC secret | Same | Stage 3 (blocking) |
| P11-DEP-003 | **Critical** | `fast-jwt` | Cache confusion via `cacheKeyBuilder` | Same | Stage 3 (blocking) |
| P11-DEP-004 | **Critical** | `vitest` (UI server mode only) | Arbitrary file read when UI server is listening | Only triggered with `--ui` flag; production unaffected | Stage 1 (low risk in CI context; note in baseline) |
| P11-DEP-005 | High | `drizzle-orm@^0.36` | SQL injection via improperly escaped SQL identifiers | `>=0.45.2` | Stage 3 (blocking) |
| P11-DEP-006 | High | `axios` (multiple paths) | SSRF, DoS, prototype pollution, header injection | Latest `axios` patch | Stage 3 (blocking) |
| P11-DEP-007 | High | `undici` (via Node.js internals) | Unbounded memory / unhandled exception in WebSocket | Node.js upgrade | Stage 3 (monitor) |
| P11-DEP-008 | High | `protobufjs` (via Temporal SDK chain) | Code injection, DoS via code generation gadget | Upstream Temporal SDK update | Stage 3 (upstream, track) |

**Gate impact**: P11-DEP-001 through P11-DEP-006 are gate-blocking for v1.0.0 release. P11-DEP-007 and P11-DEP-008 require upstream fixes; their gate status will be determined in Stage 3 based on whether fixes are available by release candidate date.

### 2.5 Container Scanning

Not run as part of this baseline (no API container image built locally). Trivy container scan is an existing CI job and will be reported in Stage 1.

### 2.6 Bundle Size

Not run as part of this baseline (requires full frontend build). Bundle size check (`pnpm check:bundle-size`) is an existing CI job.

### 2.7 OpenAPI Types Drift

Not run as part of this baseline (requires build). `pnpm check:types-drift` is an existing CI job.

### 2.8 Playwright E2E Smoke Tests

Not run locally. The existing smoke tests in `e2e/` run in the `frontend-smoke` CI job against mock data. No live stack is available for the golden suite at baseline.

---

## 3. Key Decisions

The following decisions are locked for Phase 11 and must not be re-opened in any later stage. Each decision is recorded here as the authoritative reference.

| Decision | Resolution | Rationale |
|---|---|---|
| **Notification transport (portal push)** | Server-Sent Events (SSE) over HTTP/2 | Unidirectional (server → client) is sufficient for "you have a notification" delivery. SSE is browser-native (`EventSource`), works over standard HTTP, requires no extra infrastructure, and is simpler to implement and debug than WebSocket. |
| **Release versioning scheme** | Semantic versioning (semver). Release candidate: `v1.0.0-rc.1`. Final release: `v1.0.0`. | Package.json already uses semver (`"version": "0.0.1"`). Semver is the standard for npm ecosystem packages. |
| **Deployment templating** | Kustomize overlays (`infra/k8s/base/` + environment overlays) | Architecture doc (`docs/architecture/deployment-architecture.md`) already specifies Kustomize. Helm adds unnecessary complexity for a single-project deployment. |
| **Contributor governance** | Developer Certificate of Origin (DCO) — no CLA required | DCO is standard for AGPL projects and widely understood by contributors. CLA administration overhead is not warranted for an open-source community project at v1.0.0. |
| **Source file headers** | No per-file copyright headers required | AGPL notice in root `LICENSE`. `SPDX-License-Identifier: AGPL-3.0-or-later` in each `package.json`. AGPL does not mandate per-file headers. |
| **SAST tool** | CodeQL (GitHub Actions `github/codeql-action`) | Free for open-source repositories, TypeScript support, security-extended query suite covers OWASP Top 10. Already supported in GitHub Actions. |
| **DAST scope split** | Stage 3: Compose-based DAST (structural sweep pre-production). Stage 10: K8s-based DAST (final production-shaped pass). | K8s deployment assets don't exist until Stage 7. Stage 3 catches structural application-layer issues early. Stage 10 validates the production deployment. |
| **SBOM format** | SPDX 2.3, generated by syft, filename `sbom.spdx.json` per image | SPDX is the most widely supported SBOM standard. syft is actively maintained and outputs SPDX natively. |
| **Container image signing** | Sigstore/cosign, keyless signing via GitHub Actions OIDC | No key management required. Transparency log (Rekor) provides auditability. Cosign is the standard for OCI image signing in open-source projects. |
| **Frontend Dockerfiles** | Created in Stage 1: `infra/docker/portal/Dockerfile`, `infra/docker/admin/Dockerfile` | Required as prerequisites for Stage 7 K8s manifests. Deferred to Stage 1 rather than Stage 0 to avoid blocking Stage 0 completion on a build task. |
| **Exception acceptance process** | Written description + severity + mitigation rationale + named approver, recorded in `docs/release/phase-11/release-checklist.md`. CRITICAL or HIGH unmitigated security findings cannot be accepted as exceptions. | Ensures no exception is accepted informally. Provides an auditable record for the acceptance review. |

---

## 4. Benchmark Datasets

| Dataset | Scenario | Status | Use |
|---|---|---|---|
| S0 `ci-golden` | Deterministic CI golden dataset (Phase 10.5) | ✅ Available — `pnpm demo:reset --scenario ci-golden` | Fast full-stack checks, golden E2E, Playwright |
| S6 `institution-year` | 50,000-student full-institution scenario (Phase 10.5) | ✅ Available — `pnpm demo:reset --scenario institution-year` | Performance profiling, security isolation, backup/restore rehearsal, S6 load-time trending |

Both datasets confirmed available before Stage 2 begins.

---

## 5. Release Evidence Structure

The following folder and file structure will be populated through Stages 1–10:

```
docs/release/phase-11/
├── nfr-gate-classification.md    ← Stage 0 (this document's companion)
├── performance-report.md         ← Stage 2
├── security-review.md            ← Stage 3
├── accessibility-audit.md        ← Stage 4
├── migration-validation-report.md ← Stage 6
├── deployment-rehearsal.md       ← Stage 7
├── backup-restore-rehearsal.md   ← Stage 7
├── operational-game-day-report.md ← Stage 8
├── licence-compliance-report.md  ← Stage 9
└── release-checklist.md          ← Stage 10
```

---

## 6. Stage 0 Exit Criteria Assessment

| Criterion | Status |
|---|---|
| Every known Phase 10 and Phase 10.5 residual has a Phase 11 disposition | ✅ See `docs/phase-11-residual-register.md` |
| New baseline findings are registered | ✅ P11-CI-001 through P11-DEP-008 registered |
| Release-blocking gate classification is agreed | ✅ See `docs/release/phase-11/nfr-gate-classification.md` |
| All key decisions are recorded and locked | ✅ See §3 above |
| S0 and S6 confirmed available | ✅ See §4 above |
| Release evidence folder structure created | ✅ See §5 above |

**Stage 0 is complete.**
