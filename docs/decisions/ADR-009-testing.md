# ADR-009: Testing Stack

**Status**: Accepted
**Date**: 2026-06-04

## Context

Principle §21 requires automated tests at unit, integration, contract, performance, security, and accessibility levels, all running in CI. The testing stack must be TypeScript-native, open source, and support testing against real infrastructure (PostgreSQL, NATS, Temporal) rather than mocks where integration correctness matters.

## Decision

| Concern | Tool |
|---|---|
| Unit and integration test runner | **Vitest** |
| Real infrastructure in tests | **Testcontainers** (`testcontainers-node`) |
| HTTP API testing | **Supertest** |
| Contract testing (OpenAPI) | **Dredd** |
| End-to-end browser testing | **Playwright** |
| Accessibility testing | **axe-core** via `@axe-core/playwright` |
| Performance / load testing | **k6** |
| Security — SAST | **ESLint security plugins** + **Semgrep** |
| Security — dependency scanning | **npm audit** + **Trivy** (container images) |

## Rationale

**Vitest**: TypeScript-native test runner; compatible with Vite's transform pipeline; fast parallel execution; drop-in Jest-compatible API; `vi.mock()` for unit isolation. Free and open source (MIT).

**Testcontainers**: Spins up real Docker containers for integration tests; Phase 3 uses PostgreSQL containers for migration, RLS, and bitemporal verification. NATS and Temporal container coverage is added when consumer and workflow behaviours are implemented. Tests run against actual infrastructure, not mocks. Free and open source (Apache 2.0).

**Supertest**: HTTP assertion library for Fastify route testing at the integration level without a running server. MIT.

**Dredd**: Validates running API responses against OpenAPI specifications; ensures the implementation matches the published contract. Apache 2.0.

**Playwright**: Headless browser automation for end-to-end UI testing; first-class TypeScript support; cross-browser. Apache 2.0.

**axe-core**: Industry-standard WCAG automated accessibility testing engine; `@axe-core/playwright` runs accessibility checks against live rendered pages in CI. MPL 2.0.

**k6**: Load testing tool with a TypeScript-like scripting API; generates realistic user load patterns for performance benchmark verification. AGPL v3.

**Semgrep**: Static analysis for security patterns; language-agnostic rules including TypeScript; LGPL 2.1 for the OSS engine.

**Trivy**: Container image vulnerability scanning; runs in CI on every image build. Apache 2.0.

## Consequences

- Unit tests (`*.test.ts`) use Vitest with in-process mocks for external dependencies.
- Integration tests (`*.int.test.ts` where a separate integration suite is needed, or package-level Testcontainers suites) use real infrastructure. Phase 3 covers PostgreSQL with Testcontainers; API integration tests are introduced with the first domain endpoints.
- Bitemporal query correctness is verified by integration tests that insert known data and assert on time-travel queries.
- Contract tests run Dredd against a locally started application instance and the published OpenAPI spec.
- Playwright E2E tests run against the full application stack in Docker Compose; axe-core accessibility checks are embedded in every page-level Playwright test.
- k6 performance tests run as a separate CI stage (not on every PR); they run nightly against a staging environment.
- No code is merged with failing Vitest, Dredd, or Playwright/axe-core tests.
