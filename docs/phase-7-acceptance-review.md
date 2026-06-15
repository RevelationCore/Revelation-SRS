# Phase 7 Acceptance Review — Integration Layer: Published Interfaces

> Date: 2026-06-15
> Status: **Phase 7 complete**
> Reviewer: Phase 7 implementation team
> Prerequisite reviews: Phase 7 Readiness Review (`docs/phase-7-readiness-review.md`)

---

## Verdict

Phase 7 is **complete**. All six stages have been implemented and their exit criteria are met. The integration layer is now publishable, testable, and operable. A third party can discover contracts, register an integration, authenticate, validate payloads, consume events, exchange files, and observe health without reading internal SRS source code.

Phase 8 (Wellbeing & Disability first-party module) may proceed.

---

## Exit Criteria Assessment

### 1. Published OpenAPI specification exists for all REST API versions

**Status: Met**

`apps/api/openapi/v1.json` is committed and CI-validated. The spec was generated from the live Fastify route registration and covers the complete v1 surface.

| Metric | Value |
|--------|-------|
| Total operations | 202 |
| Total path patterns | 158 |
| public-class operations | 78 |
| workflow-class operations | 31 |
| admin-class operations | 31 |
| system-class operations | 32 |
| reporting-class operations | 21 |
| integration-class operations | 7 |
| private-class operations | 2 |

Every operation has an `operationId`, at least one tag, and an `x-publication-class`. No duplicated `operationId` exists. The CI `openapi-validation` job regenerates and compares the spec on every push; any drift fails the build.

Supporting artefacts:
- `docs/integrations/rest-api-guide.md` — authentication, tenant context, pagination, filtering, errors, idempotency, versioning, deprecation
- `GET /api/v1/openapi.json` — live spec served by the runtime
- `GET /api/v1/docs` — Swagger UI

---

### 2. Event schema registry exists and is compatible with emitted events

**Status: Met**

`schemas/events/registry.json` is the machine-readable index. JSON Schema artefacts cover all 46 published events, generated from the TypeScript payload types in `packages/domain/src/events/`.

| Metric | Value |
|--------|-------|
| Published events | 46 |
| Internal events | 6 |
| Total events in registry | 52 |
| Event schema files on disk | 47 (46 payloads + envelope) |
| Declared consumer systems | 17 |

Data classification breakdown:

| Class | Count |
|-------|-------|
| standard | 19 |
| regulatory | 12 |
| sensitive | 6 |
| personal | 8 |
| special-category | 1 |

Stage 6 contract tests assert that every `schemaPath` in the registry resolves to a committed file, every published event has a `version`, `dataClass`, and at least one declared consumer, and no internal event appears in the published set.

Supporting artefacts:
- `docs/integrations/event-consumer-guide.md` — NATS JetStream connection, durable consumers, envelope structure, idempotency, replay, dead-letter, schema compatibility, consumer group naming
- `schemas/events/envelope.v1.json` — envelope schema

---

### 3. File exchange specification documents exist for all supported file contracts

**Status: Met**

Five file contract families are formally specified and machine-readable schemas are committed for all 10 inbound/outbound file types.

| Family | Spec document | Schemas |
|--------|--------------|---------|
| UCAS admissions exchange | `docs/integrations/file-contracts/ucas-admissions-exchange.md` | `ucas/application-inbound.v1.json`, `ucas/confirmation-outbound.v1.json` |
| HESA student return | `docs/integrations/file-contracts/hesa-student-return.md` | `hesa/validation-report-inbound.v1.json` |
| SLC enrolment exchange | `docs/integrations/file-contracts/slc-enrolment-exchange.md` | `slc/confirmation-outbound.v1.json`, `slc/notification-inbound.v1.json` |
| UKVI sponsor compliance | `docs/integrations/file-contracts/ukvi-sponsor-compliance.md` | `ukvi/cas-request-outbound.v1.json`, `ukvi/attendance-report-outbound.v1.json`, `ukvi/visa-update-inbound.v1.json` |
| Exam scheduling | `docs/integrations/file-contracts/exam-scheduling.md` | `exam/schedule-inbound.v1.json`, `exam/entry-outbound.v1.json` |

`schemas/file-contracts/registry.json` is the machine-readable file contract index. `docs/integrations/file-contracts/README.md` documents the transport, encoding, retry, reconciliation, and data classification conventions that apply across all file exchanges.

Stage 3 fixture validation tests (`apps/api/test/stage3-file-contract-specs.int.test.ts`) validate representative payloads against each schema.

---

### 4. Plugin registry runtime APIs are operational

**Status: Met**

The integration registry service (`apps/api/src/platform/integration/registry-service.ts`) and 12 admin-class REST routes (`apps/api/src/routes/integration-registry.ts`) are operational.

Runtime capabilities:

| Capability | Route |
|------------|-------|
| List all integration contracts | `GET /api/v1/integration-contracts` |
| Read contract metadata | `GET /api/v1/integration-contracts/{contractId}` |
| List all tenant registrations | `GET /api/v1/integration-registrations` |
| Create a registration | `POST /api/v1/integration-registrations` |
| Update registration config | `PATCH /api/v1/integration-registrations/{registrationId}` |
| Enable a registration | `POST /api/v1/integration-registrations/{registrationId}/enable` |
| Disable a registration | `POST /api/v1/integration-registrations/{registrationId}/disable` |
| Record a health check | `POST /api/v1/integration-registrations/{registrationId}/health-check` |
| Trigger replay/backfill | `POST /api/v1/integration-registrations/{registrationId}/replay` |
| List exchange ledger | `GET /api/v1/integration-exchanges` |
| Read exchange record | `GET /api/v1/integration-exchanges/{exchangeId}` |

Enforcement rules:

- Enable-time `endpointSafetyClass` check: production endpoints (`external-live`, `internal-live`) cannot be enabled in non-production environments.
- Contract deprecation enforcement: `POST /api/v1/integration-registrations` rejects registrations for deprecated contracts (HTTP 422).
- Replay guard: `initiateReplay` rejects the request if `replaySupported` is `false` on the registration (HTTP 422).
- Audit trail: all mutating operations call `AuditService.record()`.
- RLS: all registry queries run under `withTenantContext` — registrations are tenant-scoped.
- Multiple registrations per contract: the incorrect `UNIQUE(tenant_id, integration_code)` constraint was removed in migration `0020_phase7_contract_deprecation.sql`. Tenants legitimately hold multiple registrations for the same contract type.

Seeded contracts (migration `0006_phase6_regulatory_schema.sql` + `0019_phase7_integration_registry.sql`):

| Contract ID | Pattern | Data class |
|-------------|---------|------------|
| `ucas-admissions-exchange.{cycle}` | file-and-api | personal |
| `hesa-student-return.{year}` | file | regulatory |
| `slc-enrolment-exchange.v1` | file-and-api | sensitive |
| `ukvi-sponsor-compliance.v1` | api-and-file | sensitive |
| `exam-scheduling.v1` | api-and-file | standard |
| `ofs-regulatory-extracts.v1` | api-and-file | regulatory |

Stage 4 integration registry tests (`apps/api/test/stage4-integration-registry.int.test.ts`) cover all 10 routes with 31 integration tests.

---

### 5. Integration developer guide is complete enough for a third party to build a conformant integration without internal code access

**Status: Met**

The following developer documentation is committed:

| Document | Purpose |
|----------|---------|
| `docs/integrations/developer-guide.md` | Top-level guide: auth, tenant context, integration surface decision tree, plugin registration 4-step workflow, REST/event/file integration, contract versioning, deprecation, environment promotion, error handling, idempotency, retry, reconciliation, local development, first-party vs external patterns |
| `docs/integrations/contract-index.md` | Single-page reference: all integration-class REST endpoints, all 46 event subjects with schema path and consumer list, all 11 file exchange flows, all 6 integration registry contracts |
| `docs/integrations/rest-api-guide.md` | REST API conventions: authentication, tenant scoping, pagination, filtering, errors (RFC 7807), idempotency, versioning, deprecation |
| `docs/integrations/event-consumer-guide.md` | Event subscription: NATS JetStream setup, durable consumers, envelope structure, ordering, replay, dead-letter, schema compatibility |
| `docs/integrations/examples/vle-integration.md` | VLE walkthrough: event subscription, mark submission, adjustment distribution acknowledgement, reconciliation |
| `docs/integrations/examples/finance-integration.md` | Finance walkthrough: fee liability events, SLC notifications, reconciliation |
| `docs/integrations/examples/statutory-exchanges.md` | UCAS, HESA, SLC, UKVI step-by-step with payload examples and idempotency key design |
| `docs/integrations/examples/wellbeing-integration.md` | Wellbeing first-party module: adjustments, EC, misconduct, disability events, GDPR obligations |
| `docs/integrations/file-contracts/` | 5 formal file exchange specifications with field-level definitions, validation rules, and transport profiles |

A developer following these documents can:

- Identify the correct integration surface for their use case (decision tree in developer guide)
- Authenticate using Keycloak client credentials and obtain a tenant-scoped JWT
- Register an integration via the plugin registry API
- Subscribe to the relevant NATS JetStream subjects with a durable consumer group
- Validate payloads against committed JSON Schema artefacts before submission
- Handle errors using the RFC 7807 error catalogue
- Apply idempotency keys for all mutating operations
- Request replay/backfill for missed events
- Observe exchange health via the integration registry exchange ledger

---

## Third-Party Developer Path — End-to-End Verification

The following table confirms each step in the developer integration path:

| Step | Mechanism | Artefact |
|------|-----------|---------|
| Discover contract | `GET /api/v1/integration-contracts` | Stage 4 routes |
| Read contract metadata | `GET /api/v1/integration-contracts/{contractId}` | Stage 4 routes |
| Register integration | `POST /api/v1/integration-registrations` | Stage 4 routes + audit |
| Enable for production | `POST …/enable` with safety class check | Stage 4 service |
| Authenticate | Keycloak client credentials → JWT | Documented in REST guide |
| Validate payloads | JSON Schema artefacts in `schemas/` | Stages 2, 3 |
| Consume events | NATS JetStream durable consumer | Event consumer guide |
| Exchange files | REST file routes + file schemas | Stage 3 |
| Handle errors | RFC 7807 errors, retry/idempotency guide | REST guide + examples |
| Observe health | `GET /api/v1/integration-exchanges` | Stage 4 routes |
| Replay/backfill | `POST …/replay` with `fromDate` | Stage 4 routes |
| Reconcile | Reconciliation sections in example walkthroughs | Stage 5 |

---

## Security, Privacy, and Isolation Verification

| Concern | Verification |
|---------|-------------|
| Tenant isolation | All registry queries use `withTenantContext` (RLS enforced) |
| Audit trail | `AuditService.record()` called for all 6 mutating registry operations |
| Special-category data | `srs.student.disability-declaration-updated` is `dataClass: special-category`; adjustment endpoints are `integration`-class (not public) |
| Environment safety | Non-production environments cannot enable `external-live` or `internal-live` endpoints |
| Internal operations not exposed | Private-class routes (e.g. downstream-triggers) verified by Stage 6 public surface isolation tests |
| Sensitive consumers | `special-category` and `sensitive` events are not assigned to public-only consumers (Stage 6 test) |
| Contract deprecation | Deprecated contracts cannot receive new registrations (HTTP 422) |
| Admin-only routes | All 12 integration registry management routes are `admin`-class |

---

## Contract Test Coverage

Stage 6 contract tests (`apps/api/test/stage6-contract-tests.int.test.ts`) provide 53 static, no-DB tests:

| Describe block | Tests |
|----------------|-------|
| VLE consumer contract | 5 |
| Finance consumer contract | 6 |
| UCAS/admissions consumer contract | 5 |
| HESA consumer contract | 6 |
| SLC regulatory exchange contract | 5 |
| UKVI consumer contract | 7 |
| Wellbeing first-party consumer contract | 8 |
| Public surface isolation | 6 |
| Deprecation policy artefacts | 5 |
| **Total** | **53** |

These run in the CI `contract-tests` job (no database, no NATS required, under 1 second).

The `apps/api/scripts/generate-compat-report.ts` script produces `apps/api/openapi/compat-report.json` during the `openapi-validation` CI job; the report is uploaded as a workflow artefact on every push to `main`.

---

## Residual Gaps — Phase 8/9 Scope

The following items are explicitly out of Phase 7 scope and are recorded as input to Phase 8 and Phase 9:

| Gap | Phase | Notes |
|-----|-------|-------|
| Automated SFTP file transport | Phase 9 | File specs and schemas are complete; automated polling, retry, and dead-letter over SFTP are Phase 9 infrastructure |
| Finance payment push endpoint (`POST /integrations/finance/payments`) | Phase 8 | Noted as Phase 8 in `docs/integrations/examples/finance-integration.md`; SLC notification endpoint covers Phase 7 scope |
| VLE integration as a running connector | Phase 8/9 | The event and REST contract is fully specified; the VLE connector itself is not an SRS deliverable |
| Wellbeing & Disability first-party module implementation | Phase 8 | Module pattern is fully documented; the module is Phase 8's primary deliverable |
| Adjustment distribution automation end-to-end | Phase 8 | `srs.adjustment.distributed` event and acknowledge endpoint are both published; automation is Phase 8 |
| Developer portal (hosted, searchable) | Post-Phase 9 | Committed Markdown artefacts are complete; a published web portal is a future operational concern |
| Schema evolution tooling (breaking change detection) | Post-Phase 9 | Schema compatibility tests exist; automated Avro/JSON Schema breaking-change detection at the registry level is future |
| Consumer group provisioning scripts | Phase 9 | Consumer group naming conventions are documented; automated provisioning tooling is Phase 9 infrastructure |

---

## Deliverables Summary

| Stage | Deliverable | Status |
|-------|-------------|--------|
| Stage 0 | `docs/phase-7-stage-0-contract-inventory.md` | Complete |
| Stage 1 | `apps/api/openapi/v1.json` (202 operations) | Complete |
| Stage 1 | `docs/integrations/rest-api-guide.md` | Complete |
| Stage 1 | CI drift detection (`stage1-openapi-contract.int.test.ts`, 20 tests) | Complete |
| Stage 2 | `schemas/events/` (46 schemas + envelope + registry) | Complete |
| Stage 2 | `docs/integrations/event-consumer-guide.md` | Complete |
| Stage 2 | Event schema tests (`stage2-event-schema-registry.int.test.ts`, 42 tests) | Complete |
| Stage 3 | `schemas/file-contracts/` (10 schemas, 5 families) | Complete |
| Stage 3 | `docs/integrations/file-contracts/` (5 spec docs + README) | Complete |
| Stage 3 | File contract tests (`stage3-file-contract-specs.int.test.ts`, 56 tests) | Complete |
| Stage 4 | Integration registry service + 12 admin-class routes | Complete |
| Stage 4 | `packages/db/migrations/0019_phase7_integration_registry.sql` | Complete |
| Stage 4 | `packages/db/migrations/0020_phase7_contract_deprecation.sql` | Complete |
| Stage 4 | Integration registry tests (`stage4-integration-registry.int.test.ts`, 31 tests) | Complete |
| Stage 5 | `docs/integrations/developer-guide.md` | Complete |
| Stage 5 | `docs/integrations/contract-index.md` | Complete |
| Stage 5 | 4 integration example walkthroughs | Complete |
| Stage 6 | `apps/api/test/stage6-contract-tests.int.test.ts` (53 tests) | Complete |
| Stage 6 | `apps/api/scripts/generate-compat-report.ts` | Complete |
| Stage 6 | CI `contract-tests` job + `openapi-validation` fixes | Complete |
| Stage 7 | This document | Complete |

---

## Conclusion

Phase 7 is complete. The integration layer is publishable, testable, and operable. All five exit criteria are met by committed artefacts with automated test coverage. The residual gaps above are clearly bounded Phase 8/9 items and do not block third-party integration against the published Phase 7 contracts.
