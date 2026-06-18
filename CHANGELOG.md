# Changelog

All notable changes to Revelation SRS are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This project uses [semantic versioning](https://semver.org/).

---

## [1.0.0] — 2026-06-18

First open-source release of Revelation SRS. All 11 phases complete.

### Highlights

- Full UK Higher Education student records platform: admissions, enrolment, module registration, assessment, progression, awards, regulatory returns (HESA, UCAS, SLC, UKVI, OfS).
- Bitemporal data model — every entity stores valid-time and transaction-time history.
- Durable workflow engine (Temporal) for admissions, board ratification, appeals, and reasonable adjustments.
- Multi-tenant with PostgreSQL Row-Level Security isolation.
- Pluggable integration layer: NATS JetStream event bus, versioned REST API, file exchange framework.
- Student Wellbeing & Disability first-party module.
- VLE Connector external integration adapter.
- React admin UI (26 routes) and student portal (14 routes), fully accessible to WCAG 2.1 AA.
- AGPL v3 — modifications served over a network must be published under the same licence.

### Added (Phase 11 — Hardening and Open Source Release)

**CI and quality gates**
- ESLint zero-error gate with custom `no-new-date` clock-use check.
- Istanbul coverage reporting with 90% threshold on platform domain logic.
- Portal and admin multi-stage Docker images with Trivy HIGH/CRITICAL scanning.
- Lighthouse CI performance budget (LCP ≤ 2500ms, FCP ≤ 1500ms, TTI ≤ 3500ms).
- Golden full-stack E2E CI job (S0 `ci-golden` via Docker Compose + Playwright).
- CodeQL SAST (weekly, security-extended query suite).
- OWASP ZAP DAST (weekly, Compose-based structural pass + K8s final pass).
- syft SPDX 2.3 SBOM generation for all production images.
- cosign keyless image signing via GitHub Actions OIDC.

**Performance**
- `GET /api/v1/reporting/enrolment-volumes` aggregate endpoint (removes client-side N+1).
- 9 composite database indexes (enrolment year/programme, person name prefix, mark/registration, audit entity, fee liability, EC).
- k6 load suite: normal, peak-load (5× start-of-year enrolment, 10× Clearing spike), horizontal scaling.

**Security and privacy**
- `GET /api/v1/audit-log?entityType=&entityId=` entity audit endpoint.
- `POST /api/v1/admin/retention/enforce` retention enforcement sweep with dry-run mode.
- Automated retention anonymisation (persons with all enrolments ended > 6 years).
- `GET /api/v1/demo/status` returns `tenantId` for Playwright test isolation.
- Cross-tenant RLS isolation integration tests (tenantA data not visible to tenantB).
- Error sanitisation tests (no stack/SQL details in RFC 7807 responses).

**Accessibility**
- `<Dialog>` shared primitive using Radix UI (focus trap, Escape, focus-return on close).
- Badge contrast fixes (`merged`/`skipped` states: 5.9:1 PASS).
- Accessibility statements for portal and admin apps (`/accessibility`).
- axe scans extended to cover all dialog patterns.

**Notification centre**
- `GET /api/v1/notifications/stream` — SSE endpoint (text/event-stream, Bearer token via fetch).
- `GET /api/v1/notifications` — paginated list with read/unread state.
- `PATCH /api/v1/notifications/:id/read` — mark as read.
- Portal `NotificationsPage` consumes SSE stream in real time.
- NATS JetStream consumer fans out to active SSE connections per student identity.

**VLE operational UI**
- Exam board grade sync conflict resolution panel (`ExamBoardDetailPage`).
- VLE enrolment override audit trail sub-view (`StudentDetailPage`).
- Bulk reconciliation trigger with 24-hour replay on `IntegrationOpsPage`.

**Internationalisation**
- Welsh (`cy`) locale files covering all string namespaces.
- `resolveValueSetLabel()` helper for value-set code display.

**Student exceptional circumstances**
- `POST /api/v1/exceptional-circumstances/submissions` student-facing endpoint (separate from staff endpoint).
- Portal `ExceptionalCircumstancesPage` submission form.

**Migration tooling**
- `@revelation-srs/migration-tools` package with canonical import contracts.
- Synthetic SITS-style and Banner-style mapping templates (IP constraint notice included).
- Six-phase staged importer: identity → catalogue → enrolments → registrations → assessment → adjustments.
- Dry-run validation gate, bitemporal window checks, referential integrity, value-set mapping validation.
- 29 integration tests (Testcontainers).
- `docs/migration-runbook.md`.

**Production deployment**
- Kustomize manifests: base + development/staging/production overlays.
- OpenBao Agent Injector for dynamic PostgreSQL credentials, Keycloak, NATS, and per-tenant secrets.
- Default-deny network policies with 7 targeted allow rules.
- TLS ingress with HTTP→HTTPS redirect, HSTS, cert-manager Certificate.
- Non-root containers throughout (`runAsNonRoot`, `readOnlyRootFilesystem`, `allowPrivilegeEscalation: false`).
- Backup script: pg_dump + gzip + GPG encryption + SHA-256 checksum + optional S3 + Prometheus pushgateway.
- Restore script: checksum verify + GPG decrypt + psql restore + Drizzle migrate + demo:validate.

**Observability**
- OpenTelemetry SDK in API, wellbeing module, and VLE adapter.
- W3C TraceContext injected into NATS JetStream message headers.
- Pino log–trace correlation (`traceId`/`spanId` in request child logger).
- OTLP traces exported to Grafana Tempo with exemplar links.
- 16 Prometheus alert rules across 5 groups.
- 9 operational runbooks + index.

**Open-source governance**
- `DCO` — Developer Certificate of Origin v1.1.
- `CONTRIBUTING.md` — setup, branching, sign-off, test requirements.
- `CODE_OF_CONDUCT.md` — adapted from Contributor Covenant v2.1.
- `SECURITY.md` — responsible disclosure policy.
- `.github/ISSUE_TEMPLATE/bug_report.yml` and `feature_request.yml`.
- `.github/PULL_REQUEST_TEMPLATE.md`.
- `docs/developer-setup.md` — full setup walkthrough.
- `docs/architecture/README.md` — architecture document index.

---

## [0.11.0-alpha] — 2026-06-17 (Phase 10 + Phase 10.5)

### Added (Phase 10 — User Interfaces)

- `apps/admin` — React 18 + Vite admin UI, 26 routes covering all SRS staff journeys.
- `apps/portal` — React 18 + Vite student portal, 14 routes.
- Shared `packages/ui` component library (Radix UI primitives, Tailwind CSS).
- OpenID Connect auth flows (Keycloak) in both apps.
- Playwright E2E test suite (8 files, all golden-path and accessibility journeys).
- axe-core WCAG 2.1 AA automated scans on all release-critical pages.

### Added (Phase 10.5 — Demo Data Platform)

- `packages/demo-data` — scenario-based demo data platform.
- 6 narrative scenarios (S0–S5) + rotation + S6 institution-year (50,000 students).
- `pnpm demo:reset`, `pnpm demo:validate`, `pnpm demo:rotate` commands.
- Demo banner in portal and admin for all demo tenants.
- 465 tests passing across all packages.

---

## [0.9.0-alpha] — 2026-06-15 (Phase 9 — VLE Connector)

### Added

- `adapters/vle` — VLE integration adapter (separate Fastify service).
- Bidirectional sync: SRS pushes enrolment outcomes; VLE returns assessment grades.
- NATS JetStream event subscriptions and grade ingestion workflow.
- Integration contract for F015/F016/F059 reference model flows.
- 204 tests passing.

---

## [0.8.0-alpha] — 2026-06-14 (Phase 8 — Student Wellbeing Module)

### Added

- `modules/wellbeing` — Student Wellbeing and Disability first-party module.
- Disclosure and support plans, reasonable adjustment distribution.
- Wellbeing-to-SRS integration via domain events and adjustment workflow.
- Special-category data isolation (role-gated access, separate schema).
- 170 tests passing.

---

## [0.7.0-alpha] — 2026-06-12 (Phase 7 — Integration Layer)

### Added

- NATS JetStream event bus with 95-event domain taxonomy.
- REST API gateway with versioning, rate limiting, and OpenAPI documentation.
- File exchange framework for HESA, UCAS, and SLC returns.
- Plugin registry for first-party modules and external adapters.
- 69 named integration contracts from the reference model.
- Contract test suite (stages 1–3 and stage 6).

---

## [0.6.0-alpha] — 2026-06-10 (Phase 6 — Regulatory Compliance)

### Added

- HESA Student Record return generation.
- UCAS admissions data exchange.
- SLC fee liability reporting.
- UKVI CAS management.
- OfS access and participation plan tracking.
- Regulatory return workflow with validation and submission audit trail.

---

## [0.5.0-alpha] — 2026-06-07 (Phase 5 — Assessment, Progression, Awards)

### Added

- Mark submission, moderation, and ratification workflows.
- Module result calculations (progression rules, compensation, condonement).
- Exam board governance: data packs, ratification sign-off, award conferral.
- Award records with bitemporal history.
- Exceptional circumstances (EC) claims and outcomes.
- Reasonable adjustments applied to exam entries.

---

## [0.4.0-alpha] — 2026-06-03 (Phase 4 — Student Identity and Enrolment)

### Added

- Student identity management (person, identifiers, contact, addresses).
- Enrolment lifecycle: application, offer, acceptance, induction, active, intermission, withdrawal.
- Module registration and credit accumulation.
- Fee liability and SLC correspondence.
- RBAC permission model with role hierarchy.
- Full audit trail on all state-changing operations.

---

## [0.3.0-alpha] — 2026-05-28 (Phase 3 — Platform Foundation)

### Added

- Fastify API with PostgreSQL + Drizzle ORM.
- NATS JetStream message broker integration.
- Temporal workflow engine integration (activities, human tasks, retry policies).
- Keycloak OIDC authentication with multi-realm support.
- PostgreSQL Row-Level Security for multi-tenancy.
- Bitemporal schema pattern (valid-time + transaction-time columns).
- Drizzle migration toolchain.
- Vitest unit and Testcontainers integration test infrastructure.
- Docker Compose local development environment.

---

## [0.2.0-alpha] — 2026-05-15 (Phase 2 — Architecture and Design)

### Added

- System architecture documentation (component diagram, service boundaries).
- Data model design (logical and physical, bitemporal patterns, RLS).
- Integration layer architecture (NATS topology, REST API gateway, file exchange).
- Security architecture (Keycloak multi-realm, RBAC, audit, OpenBao).
- Workflow engine integration design (Temporal patterns, human tasks, audit bridge).
- Deployment architecture (Docker Compose, Kubernetes with Kustomize).
- 14 Architecture Decision Records (ADR-001 through ADR-014).

---

## [0.1.0-alpha] — 2026-05-01 (Phase 1 — Requirements and Domain Definition)

### Added

- Functional requirements (140+ testable requirements traced to reference model flows).
- Non-functional requirements (performance, security, accessibility, privacy, compliance).
- Domain glossary (authoritative UK HE term definitions).
- Actor catalogue (human and system actors, RBAC role hierarchy).
- Data subject register (personal data categories, lawful basis, retention).
- Workflow catalogue (12 business process workflows with state machines).

---

## [0.0.1-alpha] — 2026-04-15 (Phase 0 — Principles and Planning)

### Added

- 21 core principles governing design, development, and operation.
- Project roadmap (11 phases from requirements to open-source release).
- Technology stack decisions (ADR-001 through ADR-011 initial set).
- Revelation Student Records Enterprise Reference Model v2.1 (33 systems, 70 flows).
