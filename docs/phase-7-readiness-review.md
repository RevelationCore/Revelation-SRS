# Phase 7 Readiness Review

> Date: 2026-06-14
> Status: Review complete
> Scope: Confirm whether the clean API, event, resource, and file-contract surface is stable enough to begin Phase 7 — Integration Layer: Published Interfaces.

---

## Readiness Judgement

Phase 7 can begin, but the system is **not yet ready to publish third-party integration contracts**.

The clean SRS architecture and runtime route surface are now broad enough to support Phase 7 work. The API can emit an OpenAPI 3.1 document at runtime, the event package contains typed event payloads, regulatory contract fixtures exist, and the integration ledger/registration schema is present.

However, the publishable contract layer is still incomplete. The main risk is documentation and artefact drift: Phase 2 catalogues describe the intended surface, while the implemented clean architecture has added, renamed, or reorganised APIs and events. Phase 7 should therefore start with a contract consolidation stage before opening the surface to third-party implementers.

---

## Findings

### 1. REST API Surface Exists But Is Not Yet Publication-Ready

Evidence:

- Runtime OpenAPI exists at `GET /api/v1/openapi.json`.
- Swagger UI is served at `/api/v1/docs`.
- Route schemas are present across current route files.
- Phase 6 and clean-architecture tests assert that OpenAPI renders.

Gaps:

- No committed generated OpenAPI artefact was found at `apps/api/openapi/v1.json`, despite `docs/architecture/api-standards.md` saying the generated spec should be committed there.
- The API resource catalogue is still a Phase 2 draft and does not reflect the clean architecture additions such as:
  - platform workflow controls;
  - feature flag governance and impact preview;
  - environment runtime and promotion records;
  - globalisation locale/currency endpoints;
  - communications templates/dispatch/logs;
  - clean Admissions routes;
  - clean workflow-backed correction, board, assessment, and progression surfaces.
- Some catalogue names are stale compared with implementation. For example, the catalogue references `student_application`, while the clean direction uses source-neutral Admissions concepts.
- OpenAPI currently proves rendering and selected path presence, but not full contract quality: examples, authentication flows, pagination conventions, error catalogue, changelog, and deprecation metadata are not yet published as a developer-facing package.

Readiness: **Partially ready**. Good runtime foundation, missing publication artefact and resource reconciliation.

### 2. Event Surface Is Implemented But Catalogue And Schema Registry Are Not Stable

Evidence:

- Event payload types exist under `packages/domain/src/events/`.
- `EVENT_TYPES` defines canonical subjects in `packages/domain/src/events/index.ts`.
- The publisher emits envelopes with `schemaRef`.
- Workflow-control events now exist for task assignment, completion, escalation, decision recording, and workflow completion.

Gaps:

- No generated JSON Schema or Avro schema registry artefacts were found.
- `schemaRef` points to a future public URI pattern, but there is no local published schema registry path or resolver.
- The Phase 2 event taxonomy has drifted from implementation:
  - docs use `srs.module-registration.*`, implementation uses `srs.enrolment.module-*`;
  - docs use `srs.exam-board.*` for board events, implementation uses `srs.governance.*`;
  - docs use `srs.regulatory.ucas-enrolment-confirmed`, implementation uses `srs.regulatory.ucas-confirmation-sent`;
  - docs use `srs.workflow.deadline-breached`, implementation uses `srs.workflow.task-escalated`;
  - docs include several events not currently exported, such as HESA acceptance/amendment/validation-report events and some Admissions offer/application lifecycle events;
  - implementation includes events not cleanly reflected in the taxonomy, such as `srs.enrolment.downstream-trigger-created`, `srs.regulatory.ofs-extract-generated`, and governance exam scheduling events.
- No consumer guidance was found for ordering guarantees, partition keys, replay/backfill strategy, consumer group naming, schema compatibility policy, or dead-letter handling beyond architecture prose.

Readiness: **Not ready for publication** until taxonomy is reconciled with code and schema artefacts are generated.

### 3. File Contracts Are Represented By Fixtures, Not Formal Specifications

Evidence:

- Regulatory contract fixtures exist under `packages/testing/regulatory-contracts/`.
- HESA submission XML generation exists and can be downloaded as `application/xml`.
- Phase 6 explicitly scoped automated SFTP/API transmission to Phase 7.

Gaps:

- Fixtures are samples, not formal file-contract specifications.
- No per-contract file spec documents were found for:
  - HESA student return XML;
  - HESA validation report;
  - UCAS application and confirmation exchange;
  - SLC confirmation and notification exchange;
  - UKVI CAS, visa, attendance, and compliance exchange;
  - exam scheduling timetable file;
  - future VLE, attendance, finance, BI/DW, EDRMS, and curriculum file extracts.
- No machine-readable schemas were found for file formats, except implicit test fixtures.
- Automated file transport, SFTP configuration, polling, retry, dead-letter, and reconciliation remain architecture/design concepts rather than runtime contract docs.

Readiness: **Not ready for publication**. Phase 7 should define formal file specs before implementing automated transfer.

### 4. Plugin Registry Schema Exists But Runtime Administration Is Incomplete

Evidence:

- `integration_contract`, `integration_registration`, and `integration_exchange` schema exists.
- Regulatory exchange service can ensure registrations and write exchange ledger rows.
- Endpoint safety classes and environment promotion hardening are present.

Gaps:

- No dedicated admin API routes were found for:
  - listing integration contracts;
  - creating/updating/enabling/disabling integration registrations;
  - configuring endpoint URLs, subject filters, consumer groups, file schedules, retry policies, or secrets references;
  - viewing integration health;
  - replaying or backfilling exchanges.
- No runtime health polling implementation was identified for plugin registrations.
- No developer-facing plugin/integration registration guide exists.

Readiness: **Partially ready at schema level, not ready at runtime/admin level**.

### 5. Clean Architecture Surface Is Stable Enough To Start Contract Work

Evidence:

- Clean convergence work has added workflow, feature flag, environment, globalisation, communications, and clean architecture acceptance artefacts.
- OpenAPI renders after the clean route expansion.
- Core process variation now has a platform model rather than being only service-private.

Remaining stability risks:

- The contract catalogue still needs to be regenerated from the clean route/event/file surface.
- Some clean capabilities may be admin-only/internal and should not be published as external contracts.
- Public, internal, workflow, reporting/export, and admin surfaces need explicit classification before publishing.

Readiness: **Ready to begin Phase 7 Stage 0 contract consolidation**.

---

## Missing Or Outdated Contract Artefacts

| Artefact | Current state | Required before Phase 7 exit |
|---|---|---|
| `apps/api/openapi/v1.json` | Runtime endpoint exists; committed generated spec not found | Commit generated OpenAPI 3.1 spec and verify in CI |
| API resource catalogue | Phase 2 draft; stale against clean implementation | Regenerate from implemented routes and classify public/internal/workflow/admin/reporting surfaces |
| API examples | Not present as a contract pack | Add representative request/response examples for every published operation |
| API authentication guide | Architecture prose only | Add client credentials, JWT, tenant context, scopes, and error examples |
| API pagination/filtering/changelog | Standards exist; not applied as a published guide | Publish API conventions and per-version changelog |
| Event taxonomy | Stale against `EVENT_TYPES` | Reconcile docs and code; make code the source of truth |
| Event schemas | TypeScript payload types exist; JSON Schema/Avro artefacts not found | Generate and publish schemas with stable `schemaRef` paths |
| Event consumer guide | Not present as a developer-ready document | Add ordering, partitioning, replay, idempotency, DLQ, compatibility, and subscription guidance |
| File specs | Fixtures exist; formal specs missing | Add one specification per inbound/outbound file contract |
| File transport specs | Architecture design only | Add SFTP/API/manual-file protocol configuration and retry/reconciliation semantics |
| Plugin registry admin API | Schema exists; admin routes not found | Add runtime APIs and UI-ready endpoints for integration contracts/registrations/health |
| Integration developer guide | Not found | Add guide for REST, events, files, plugin registration, and first-party modules |

---

## Contract Surface To Reconcile First

### REST API

Start from the implemented route set, not the Phase 2 catalogue. The reconciliation should produce:

- public core API resources;
- internal service APIs;
- workflow command APIs;
- admin/configuration APIs;
- reporting/export APIs;
- non-public operational APIs.

Current implemented areas include:

- students;
- enrolments;
- programmes, modules, learning outcomes, academic periods, module offerings;
- module registrations;
- marks, module results, assessment components;
- adjustments, exceptional circumstances, misconduct;
- progression, awards, HEAR;
- exam boards, data packs, candidate profiles, signoff, ratification, exam scheduling;
- correction cases;
- regulatory UCAS, HESA, SLC, UKVI, OfS, FOI;
- tenant admin, value sets, academic rules;
- workflow definitions/instances/tasks, assignment rules;
- feature flags, governance, impact, assignments, evaluation;
- environments, environment runtime, promotions;
- globalisation locales/currencies/exchange rates/value-set labels;
- communications templates, dispatch, logs.

### Events

Make `packages/domain/src/events/index.ts` the starting point for the canonical event list. Reconcile the architecture taxonomy to it, then decide whether missing planned events are:

- still required and should be implemented;
- replaced by a renamed clean event;
- internal-only and not published;
- obsolete after clean convergence.

### Files

Start with the regulatory fixtures and HESA XML route, then expand into formal contracts:

- UCAS 2027 application and confirmation;
- HESA 2027-28 student return and validation report;
- SLC confirmation and notification;
- UKVI CAS request and visa status;
- exam scheduling timetable.

Then add future Phase 7/9 file contracts for VLE, attendance, finance, BI/DW, EDRMS, and curriculum where the integration catalogue says `file` or `mixed`.

---

## Recommended Phase 7 Entry Plan

### Stage 0 — Contract Inventory And Classification

- Generate a route inventory from the live Fastify app.
- Generate an event inventory from `EVENT_TYPES` and `packages/domain/src/events`.
- Generate a file-contract inventory from regulatory fixtures and implementation.
- Classify every surface as public, internal, workflow, admin, reporting/export, or non-published.
- Produce a gap matrix against `docs/architecture/api-resource-catalogue.md`, `docs/architecture/domain-events.md`, and `docs/architecture/integration-contract-catalogue.md`.

### Stage 1 — OpenAPI Publication

- Commit `apps/api/openapi/v1.json`.
- Add CI drift detection: generated OpenAPI must match committed spec.
- Add examples, auth guidance, pagination/filtering guidance, error catalogue, and changelog.

### Stage 2 — Event Schema Registry

- Generate JSON Schema or Avro for all published event payloads.
- Publish schemas under stable local paths matching `schemaRef`.
- Add schema compatibility tests.
- Add consumer guidance for ordering, replay, idempotency, and DLQ.

### Stage 3 — File Contract Specifications

- Convert regulatory fixtures into formal file specs.
- Add machine-readable schemas where feasible.
- Add validation tests for every file contract.
- Define manual-file, SFTP, and API transport profiles.

### Stage 4 — Plugin Registry Runtime APIs

- Add admin APIs for contracts, registrations, health, enable/disable, replay/backfill, and endpoint configuration.
- Connect endpoint safety classes and environment promotion rules to plugin registration configuration.

### Stage 5 — Integration Developer Guide

- Publish a developer guide covering REST, events, files, plugin registration, local test fixtures, versioning, deprecation, and first-party modules.

---

## Conclusion

The clean API/event/resource surface is **stable enough to start Phase 7**, but the publishable contract layer is **not yet complete**.

The first Phase 7 implementation step should be contract inventory and classification, followed by OpenAPI publication, event schema generation, file-spec formalisation, plugin registry runtime APIs, and developer documentation.
