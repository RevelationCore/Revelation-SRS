# Phase 7 Implementation Plan — Published Integration Interfaces

> Date: 2026-06-15
> Status: **Complete** — all stages 0–7 done
> Prerequisite: Phases 4, 5, 6, 6.4, 6.5, and 6.6 complete on the clean architecture
> Readiness review: `docs/phase-7-readiness-review.md`

---

## Overview

Phase 7 turns the implemented SRS integration layer into a publishable contract surface for third-party systems, first-party modules, and institutional adapters.

Earlier phases created the runtime foundations:

- REST APIs with Fastify route schemas and runtime OpenAPI generation.
- Domain event payload types and canonical `EVENT_TYPES`.
- Regulatory exchange ledgers and pinned representative contract fixtures.
- Integration contract, registration, and exchange tables.
- Workflow, feature flag, environment, globalisation, and communications controls.

The Phase 7 readiness review concluded that the clean surface is stable enough to start contract work, but not yet ready for third-party publication. The main Phase 7 job is therefore to consolidate the live implementation into durable external contracts, then add the runtime administration and developer documentation needed for institutions and vendors to integrate safely.

---

## Target Outcomes

By the end of Phase 7:

- every published REST operation has a committed OpenAPI 3.1 contract;
- every published event has a schema, version, subject, payload definition, and consumer guidance;
- every supported file exchange has a formal specification and representative validation fixtures;
- integration contracts and registrations are manageable at runtime;
- endpoint safety, environment promotion, feature flags, and plugin registration work together;
- a third party can build a conformant REST, event, or file integration without reading internal implementation code.

---

## Stage Dependency Graph

```text
Stage 0  Contract inventory and classification
    │
Stage 1  OpenAPI publication
    │
Stage 2  Event schema registry
    │
Stage 3  File contract specifications
    │
Stage 4  Plugin registry runtime APIs
    │
Stage 5  Integration developer guide
    │
Stage 6  Contract tests and compatibility gates
    │
Stage 7  Phase 7 acceptance review
```

Stages 1, 2, and 3 can proceed in parallel once Stage 0 has classified the surface. Stage 4 depends on Stage 0 and should align with the file/event/API contract metadata from Stages 1-3. Stage 5 depends on the contract artefacts being stable. Stage 6 and Stage 7 depend on all preceding stages.

---

## Stage 0 — Contract Inventory and Classification

**Status**: Complete — `docs/phase-7-stage-0-contract-inventory.md`

**Goal**: establish the source-of-truth inventory for every REST, event, and file contract before generating publication artefacts.

### Scope

- Generate a live route inventory from the Fastify app.
- Generate an event inventory from `packages/domain/src/events/index.ts` and payload files.
- Generate a file-contract inventory from regulatory fixtures, file-producing routes, and integration catalogue entries.
- Classify every surface as:
  - public core API;
  - integration API;
  - internal service API;
  - workflow command API;
  - tenant/admin API;
  - reporting/export API;
  - operational/non-published API.
- Reconcile drift against:
  - `docs/architecture/api-resource-catalogue.md`;
  - `docs/architecture/domain-events.md`;
  - `docs/architecture/integration-contract-catalogue.md`.
- Identify contract surfaces that should not be published externally.

### Deliverables

- `docs/phase-7-stage-0-contract-inventory.md`
- Updated API resource catalogue or a generated replacement catalogue.
- Updated event taxonomy gap matrix.
- Updated file-contract gap matrix.

### Exit Criteria

- Every implemented route, event, and file fixture is accounted for.
- Every surface has an explicit publication classification.
- Missing, stale, renamed, internal-only, and obsolete contracts are listed.

---

## Stage 1 — OpenAPI Publication

**Status**: Complete — `apps/api/openapi/v1.json`, `docs/integrations/rest-api-guide.md`

**Goal**: make the REST API contract publishable, versioned, testable, and committed.

### Scope

- Generate and commit `apps/api/openapi/v1.json`.
- Add a repeatable OpenAPI generation command.
- Add CI drift detection so the committed spec must match the generated runtime spec.
- Ensure all published operations include:
  - tags;
  - operation IDs;
  - request and response schemas;
  - error schemas using RFC 7807 conventions;
  - authentication/security requirements;
  - pagination/filtering metadata where applicable;
  - representative examples for important create/update/action endpoints.
- Add OpenAPI changelog/deprecation metadata for future versions.
- Decide whether admin-only, internal-only, and operational endpoints appear in the public spec or a separate private/admin spec.

### Deliverables

- `apps/api/openapi/v1.json`
- OpenAPI generation script or package command.
- CI check for OpenAPI drift.
- `docs/integrations/rest-api-guide.md`
- Updated `docs/architecture/api-standards.md` if needed.

### Exit Criteria

- `GET /api/v1/openapi.json` and committed `apps/api/openapi/v1.json` are equivalent.
- Every published route has complete schema coverage and an operation classification.
- REST guide explains auth, tenant scoping, pagination, filtering, errors, idempotency, versioning, and deprecation.

---

## Stage 2 — Event Schema Registry

**Status**: Complete — `schemas/events/` (46 payload schemas + envelope + registry), `docs/integrations/event-consumer-guide.md`, `docs/architecture/domain-events.md` reconciled

**Goal**: turn TypeScript event payloads into a published event contract set with schemas and consumer guidance.

### Scope

- Reconcile `docs/architecture/domain-events.md` with `EVENT_TYPES`.
- Decide which planned-but-unimplemented events are:
  - required and should be implemented;
  - replaced by a clean renamed event;
  - internal-only;
  - obsolete.
- Generate JSON Schema or Avro artefacts for every published event payload.
- Publish schemas under stable local paths that match or can map to `schemaRef`.
- Add schema compatibility tests.
- Define event contract metadata:
  - subject;
  - version;
  - payload schema;
  - data classification;
  - partition/ordering key;
  - idempotency key;
  - replay/backfill mechanism;
  - retention expectation;
  - primary consumers.
- Document consumer group naming, dead-letter handling, replay, schema compatibility, and version deprecation.

### Deliverables

- `schemas/events/...` or equivalent committed event schema registry.
- Updated `docs/architecture/domain-events.md`.
- `docs/integrations/event-consumer-guide.md`
- Event schema compatibility tests.

### Exit Criteria

- Every published event in `EVENT_TYPES` has a schema and documented consumer contract.
- Event taxonomy and implementation no longer disagree.
- Consumers can resolve `schemaRef` to a committed artefact.

---

## Stage 3 — File Contract Specifications

**Status**: Complete — `schemas/file-contracts/` (10 JSON schemas + registry), `docs/integrations/file-contracts/` (5 spec docs + README), `docs/architecture/integration-contract-catalogue.md` updated

**Goal**: formalise every supported inbound and outbound file exchange.

### Scope

- Convert existing regulatory fixtures into formal file specifications:
  - UCAS application and confirmation exchange;
  - HESA student return XML and validation report;
  - SLC confirmation and notification;
  - UKVI CAS request, visa status, attendance, and compliance exchange;
  - exam scheduling timetable.
- Add future Phase 7/9 file specs where the contract catalogue already declares `file` or `mixed` patterns:
  - VLE;
  - attendance;
  - finance;
  - BI/DW;
  - EDRMS;
  - curriculum;
  - exam scheduling.
- Define field-level descriptions, required/optional fields, code sets, validation rules, encoding, ordering, date/time formats, monetary formats, locale/currency assumptions, and data classification.
- Add machine-readable schemas where feasible.
- Define transport profiles:
  - manual file;
  - SFTP;
  - HTTPS/API upload/download;
  - secure drop.
- Define retry, reconciliation, hash/idempotency, and audit expectations.

### Deliverables

- `docs/integrations/file-contracts/`
- Machine-readable schemas where suitable.
- Validation tests for representative fixtures.
- Updated `docs/architecture/integration-contract-catalogue.md`.

### Exit Criteria

- Every supported file exchange has a formal specification.
- Existing fixtures are validated against those specifications.
- File transport profiles are explicit and environment-safe.

---

## Stage 4 — Plugin Registry Runtime APIs

**Status**: Complete — `apps/api/src/platform/integration/registry-service.ts`, `apps/api/src/routes/integration-registry.ts`, `packages/db/migrations/0019_phase7_integration_registry.sql`, `packages/db/migrations/0020_phase7_contract_deprecation.sql`, `apps/api/test/stage4-integration-registry.int.test.ts`

**Goal**: make integration contracts and registrations manageable through stable runtime APIs.

### Scope

- Add services and routes for:
  - listing supported integration contracts;
  - reading contract metadata;
  - creating/updating tenant integration registrations;
  - enabling/disabling registrations;
  - configuring endpoint URL, transport, subject filters, consumer groups, file schedules, retry policy, and secret reference;
  - viewing integration exchanges and health;
  - recording health checks;
  - triggering replay/backfill where supported.
- Integrate endpoint safety class, live-traffic approval, environment, and promotion metadata into registration configuration.
- Enforce permissions and audit every configuration change.
- Ensure integration registrations are tenant-scoped and compatible with RLS.
- Add validation for contract version compatibility and deprecation state.

### Deliverables

- Integration registry service layer.
- `/api/v1/integration-contracts`, `/api/v1/integration-registrations`, and `/api/v1/integration-exchanges` APIs or equivalent.
- OpenAPI coverage for plugin registry APIs.
- Tests for tenant isolation, enable/disable, safety classes, health updates, and replay/backfill validation.

### Exit Criteria

- Tenant administrators can manage integration registrations through API.
- Runtime exchange health is visible without direct database access.
- Non-production environments cannot enable live production endpoints accidentally.

---

## Stage 5 — Integration Developer Guide

**Status**: Complete — `docs/integrations/developer-guide.md`, `docs/integrations/contract-index.md`, `docs/integrations/examples/` (4 walkthroughs)

**Goal**: provide the documentation a third party needs to build a conformant integration.

### Scope

- Create a top-level integration developer guide covering:
  - authentication and tenant context;
  - REST API usage;
  - event subscription;
  - file exchange;
  - plugin registration;
  - contract versioning and deprecation;
  - local development and test fixtures;
  - environment promotion and endpoint safety;
  - first-party module integration pattern;
  - external integration pattern;
  - error handling, retries, idempotency, and reconciliation.
- Add examples for common integrations:
  - VLE course provisioning and grade submission;
  - Finance fee liability and payment/hold updates;
  - UCAS/HESA/SLC/UKVI statutory exchanges;
  - Wellbeing first-party module context/outcome exchange.

### Deliverables

- `docs/integrations/developer-guide.md`
- Example integration walkthroughs.
- Contract index linking OpenAPI, event schemas, file specs, and registry configuration.

### Exit Criteria

- A developer can identify the correct contract, authenticate, validate payloads, handle errors, and register an integration without reading internal service code.

---

## Stage 6 — Contract Tests and Compatibility Gates

**Status**: Complete — `apps/api/test/stage6-contract-tests.int.test.ts` (53 tests), `apps/api/scripts/generate-compat-report.ts`, `.github/workflows/ci.yml` (contract-tests job + openapi-validation fix).

**Goal**: make contract publication enforceable in CI.

### Scope

- Add OpenAPI validation and drift checks.
- Add event schema generation and compatibility checks.
- Add file fixture validation against formal specs.
- Add contract tests for high-priority external systems:
  - VLE;
  - Finance;
  - UCAS;
  - HESA;
  - SLC;
  - UKVI;
  - Wellbeing first-party module.
- Add deprecation policy tests where metadata exists.
- Add checks that public contracts do not expose internal-only fields or admin-only operations.

### Deliverables

- CI contract-test workflow.
- Contract fixture validation tests.
- Compatibility report generated during CI.

### Exit Criteria

- Contract artefacts cannot drift silently from implementation.
- Breaking contract changes are detected before merge.
- Published schemas and examples validate.

---

## Stage 7 — Phase 7 Acceptance Review

**Status**: Complete — `docs/phase-7-acceptance-review.md`

**Goal**: confirm Phase 7 exit criteria and readiness for Phase 8/9 integration consumers.

### Scope

- Review all REST, event, file, and plugin registry deliverables.
- Confirm third-party developer path end-to-end:
  - discover contract;
  - register integration;
  - authenticate;
  - validate payloads;
  - consume/publish events;
  - exchange files;
  - observe health and errors;
  - replay/backfill where supported.
- Confirm security, privacy, audit, tenant isolation, environment safety, and data classification.
- Update roadmap and architecture documents to mark Phase 7 complete.

### Deliverables

- `docs/phase-7-acceptance-review.md`
- Updated roadmap status.
- Any residual gap register for Phase 8/9.

### Exit Criteria

- Published OpenAPI specifications exist for all REST API versions.
- Event schema registry exists and is compatible with emitted events.
- File exchange specification documents exist for all supported file contracts.
- Plugin registry runtime APIs are operational.
- Integration developer guide is complete enough for a third party to build a conformant integration without internal code access.

---

## Testing Strategy

Required coverage:

- OpenAPI generation and committed-spec drift test.
- Route classification/publication test.
- Event schema generation test.
- Event schema compatibility test.
- Event taxonomy versus `EVENT_TYPES` drift test.
- File fixture validation tests.
- Plugin registry RLS and tenant isolation tests.
- Plugin registry permission and audit tests.
- Endpoint safety tests for non-production environments.
- Contract examples validation.
- Developer-guide smoke check for links and referenced artefacts.

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Publishing stale Phase 2 contract names | Stage 0 makes implementation the source of truth and explicitly reconciles drift |
| Exposing internal/admin APIs as public contracts | Route classification is required before OpenAPI publication |
| Event schemas diverge from TypeScript payloads | Generate schemas from source types and add CI drift checks |
| File fixtures become mistaken for specifications | Stage 3 converts fixtures into formal specs and validation tests |
| Plugin registry becomes a passive table only | Stage 4 adds runtime services, APIs, health, enable/disable, and replay/backfill controls |
| Non-production accidentally targets live endpoints | Reuse endpoint safety classes and environment promotion hardening in integration registration validation |
| Contract tests become too slow | Split fast schema/drift checks from slower adapter/integration conformance suites |

---

## Exit Summary

Phase 7 is complete only when the integration layer is publishable, testable, and operable:

- REST contracts are committed and validated.
- Event contracts are schema-backed and consumer-ready.
- File contracts are specified and fixture-validated.
- Plugin registrations are runtime-managed and environment-safe.
- Developers have enough guidance to build integrations without reading internal SRS code.
