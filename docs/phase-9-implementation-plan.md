# Phase 9 Implementation Plan - VLE Connector

> Date: 2026-06-15
> Status: Complete - all stages 0-8 done
> Prerequisite: Phase 7 complete; Phase 8 complete
> Roadmap: `docs/project-roadmap.md` Phase 9

---

## Overview

Phase 9 builds the VLE Connector as the reference external integration. It validates that an external system can integrate with Revelation SRS exclusively through the published integration layer, without direct database access or internal service imports.

The connector proves three flows:

- F015: SRS enrolment and module registration data provisions VLE course access.
- F016: VLE assessment grades are submitted back to SRS through REST.
- F059: approved adjustment outcomes flow from Wellbeing to SRS to the VLE, with SRS remaining the sole distribution point.

---

## Target Outcomes

By the end of Phase 9:

- `adapters/vle` is scaffolded, buildable, testable, and deployable;
- the connector is configurable per tenant through integration registrations;
- a local stub VLE can receive course, enrolment, status, result, and adjustment operations;
- the connector consumes published SRS events using durable subscriptions and idempotent handlers;
- VLE marks are submitted to SRS using published REST endpoints and stable idempotency keys;
- adjustment distribution to VLE is verified from Phase 8 Wellbeing approval through SRS distribution and VLE acknowledgement;
- replay, reconciliation, health, disable/re-enable, and endpoint safety behaviours are covered by tests;
- the external integration pattern is documented and reusable for later adapters.

---

## Stage Dependency Graph

```text
Stage 0  Contract and boundary baseline
    |
Stage 1  Connector scaffold and stub VLE
    |
Stage 2  Plugin registry and tenant configuration
    |
Stage 3  Event consumer foundation
    |
Stage 4  Course provisioning flow (F015)
    |
Stage 5  Adjustment distribution flow (F059)
    |
Stage 6  Mark submission flow (F016)
    |
Stage 7  Reliability, replay, reconciliation, and observability
    |
Stage 8  Contract tests and acceptance review
```

Stages 4 and 5 can proceed in parallel after Stage 3 because both consume SRS events and write to the VLE-side adapter boundary. Stage 6 depends on Stage 1 and Stage 2, but its end-to-end tests should wait until Stage 4 has established the module registration/component mapping used by VLE mark submission.

---

## Stage 0 - Contract and Boundary Baseline

**Status**: Not started

**Goal**: confirm the external integration boundary and all Phase 9 contracts before implementation starts.

### Scope

- Reconcile Phase 9 against published Phase 7 contracts:
  - `vle-course-provisioning.v1` for F015;
  - `vle-assessment-results.v1` for F016;
  - `vle-adjustments.v1` for F059.
- Confirm the VLE connector uses only:
  - published event schemas in `schemas/events`;
  - published REST API endpoints;
  - integration registry APIs;
  - no SRS database access;
  - no imports from SRS internal service classes.
- Confirm event subscriptions:
  - `srs.catalogue.programme-updated`;
  - `srs.catalogue.module-updated`;
  - `srs.catalogue.learning-outcome-updated`;
  - `srs.student.enrolled`;
  - `srs.student.status-changed`;
  - `srs.enrolment.module-registered`;
  - `srs.enrolment.module-registration-withdrawn`;
  - `srs.enrolment.module-registration-completed`;
  - `srs.assessment.module-result-ratified`;
  - `srs.adjustment.distributed`.
- Confirm REST operations:
  - `GET /api/v1/module-registrations/:moduleRegistrationId`;
  - `GET /api/v1/module-registrations/:moduleRegistrationId/marks`;
  - `POST /api/v1/module-registrations/:moduleRegistrationId/marks`;
  - `POST /api/v1/adjustments/:adjustmentId/distributions/:distributionId/acknowledge`;
  - integration registration and health APIs.
- Decide the stub VLE API shape and state model.
- Define connector-owned persistence for event offsets, roster mapping, course mapping, adjustment application state, mark submission receipts, reconciliation runs, and health checks.

### Deliverables

- `docs/phase-9-stage-0-contract-and-boundary-baseline.md`
- Updated VLE example guide if contract drift is found.
- Gap register for missing event fields, REST fields, permissions, and registry metadata.

### Exit Criteria

- Every Phase 9 flow maps to a published contract.
- The connector boundary explicitly excludes database access and internal imports.
- Any contract drift is resolved or assigned to an implementation stage before code work begins.

---

## Stage 1 - Connector Scaffold and Stub VLE

**Status**: Not started

**Goal**: create a deployable adapter and a deterministic local VLE simulator.

### Scope

- Add `adapters/vle` package with TypeScript, Fastify, lint, typecheck, unit tests, and integration tests.
- Add connector runtime configuration:
  - SRS API base URL;
  - NATS URL;
  - tenant ID;
  - integration registration ID;
  - OAuth/client credential settings;
  - VLE endpoint URL;
  - retry/backoff settings.
- Add connector health and readiness endpoints.
- Add local persistence for:
  - received event ledger;
  - processed event offsets;
  - VLE course mapping;
  - VLE enrolment mapping;
  - adjustment mapping;
  - mark submission receipts;
  - reconciliation runs.
- Add a stub VLE service or in-process simulator with endpoints for:
  - create/update course shell;
  - enrol/suspend/withdraw student;
  - apply adjustment;
  - record ratified result display;
  - expose current roster/state for tests.
- Add Docker Compose/local development notes.

### Deliverables

- `adapters/vle/package.json`
- VLE connector app and entrypoint.
- Stub VLE app or simulator.
- Connector configuration docs.
- Scaffold tests.

### Exit Criteria

- The connector and stub VLE start locally.
- Health/readiness endpoints respond.
- Tests can inspect deterministic stub VLE state.

---

## Stage 2 - Plugin Registry and Tenant Configuration

**Status**: Not started

**Goal**: make the connector runtime-configurable per tenant without code changes.

### Scope

- Register `vle-course-provisioning.v1`, `vle-assessment-results.v1`, and `vle-adjustments.v1` for a tenant.
- Load connector configuration from integration registration metadata.
- Enforce endpoint safety:
  - simulator for local stub VLE;
  - external-test for non-production VLE;
  - live only when `liveTrafficApproved` is true.
- Support enable/disable and re-enable without losing event offsets.
- Publish connector health back to the integration registry where Phase 7 APIs support it.
- Add service-account permissions for VLE read and write operations.

### Deliverables

- Registration bootstrap script or fixture.
- Configuration loader.
- Registry health reporter.
- Tests for endpoint safety, tenant scoping, disable/re-enable, and permission failure.

### Exit Criteria

- A connector can be pointed at a different VLE endpoint by changing registration/configuration only.
- Disabled registrations stop external writes while preserving replay position.
- Non-production cannot accidentally target a live endpoint.

---

## Stage 3 - Event Consumer Foundation

**Status**: Not started

**Goal**: implement reliable event consumption for all VLE-bound subjects.

### Scope

- Connect to NATS JetStream using durable consumer group `vle.{institution-code}.main`.
- Validate inbound events against published schemas where practical.
- Add idempotent event handling based on event ID and tenant ID.
- Persist event offsets, processing status, error details, and payload hashes.
- Add retry and dead-letter behaviour consistent with Phase 7 guidance.
- Add replay support from registration replay/backfill requests.
- Filter or reject events for the wrong tenant.
- Add contract-safe redaction in logs.

### Deliverables

- Event consumer service.
- Event ledger/repository.
- Schema validation helper.
- Replay handler.
- Tests for idempotency, wrong-tenant rejection, retry, DLQ, and replay.

### Exit Criteria

- Replaying the same event set produces the same connector state.
- Failed event processing is visible and recoverable.
- The connector never processes another tenant's events.

---

## Stage 4 - Course Provisioning Flow (F015)

**Status**: Not started

**Goal**: keep the VLE course catalogue and student roster aligned with SRS events.

### Scope

- Handle catalogue events to create or update VLE course shells:
  - programme updates where needed for course grouping;
  - module updates;
  - learning outcome updates where useful for course metadata.
- Handle student and enrolment events:
  - `srs.student.enrolled`;
  - `srs.student.status-changed`;
  - `srs.enrolment.module-registered`;
  - `srs.enrolment.module-registration-withdrawn`;
  - `srs.enrolment.module-registration-completed`.
- Map SRS module IDs/codes and module registration IDs to VLE course/user enrolment identifiers.
- Apply access states:
  - active/enrolled -> enrolled in course;
  - interrupted/suspended -> suspended access;
  - withdrawn/completed -> removed or deactivated according to configuration.
- Add reconciliation between SRS registration lists and stub VLE roster state.

### Deliverables

- Course provisioning handlers.
- VLE client methods for course and roster operations.
- Mapping repository.
- F015 integration tests.

### Exit Criteria

- Module registration events produce the expected stub VLE roster state.
- Withdrawals and status changes update access correctly.
- Reconciliation can detect and repair a missing VLE enrolment.

---

## Stage 5 - Adjustment Distribution Flow (F059)

**Status**: Not started

**Goal**: apply approved adjustment distributions to the VLE and acknowledge them to SRS.

### Scope

- Handle `srs.adjustment.distributed` events for VLE-targeted distributions.
- Validate the distribution originated from SRS, not Wellbeing.
- Map adjustment types to stub VLE behaviours:
  - extended deadline;
  - extra time;
  - alternative format;
  - accessible content flag;
  - assessment accommodation note.
- Apply effective dates and expiry handling.
- Acknowledge successful distributions using the SRS acknowledgement endpoint.
- Record failed application attempts and retry without duplicate acknowledgements.
- Add end-to-end test from Phase 8-style Wellbeing approval through SRS distribution to VLE acknowledgement.

### Deliverables

- Adjustment event handler.
- VLE adjustment mapper.
- SRS distribution acknowledgement client.
- F059 end-to-end tests.

### Exit Criteria

- VLE receives adjustment data only via SRS distribution events.
- Successful application is acknowledged to SRS exactly once.
- Failed application is retried and visible in registry health/exchange status.

---

## Stage 6 - Mark Submission Flow (F016)

**Status**: Not started

**Goal**: submit VLE grades and completion status to SRS using published REST APIs.

### Scope

- Model VLE assessment submissions in the stub VLE.
- Map VLE assignment identifiers to SRS `assessmentComponentId` values.
- Submit marks to `POST /api/v1/module-registrations/:moduleRegistrationId/marks` using:
  - `assessmentComponentId`;
  - `rawMark`;
  - `attemptNumber`;
  - `sourceSystem: "vle"`;
  - `sourceReference`;
  - `submittedAt`;
  - optional raw payload metadata where permitted.
- Use stable idempotency keys derived from VLE assignment ID, student ID, and attempt number.
- Handle SRS validation errors for unknown registrations/components, invalid marks, locked records, and rate limits.
- Store SRS mark IDs/receipts for reconciliation.
- Handle `srs.assessment.module-result-ratified` to update displayed ratified result status in the stub VLE.

### Deliverables

- Mark submission service.
- SRS REST client.
- Assignment/component mapping service.
- Mark receipt repository.
- F016 integration tests.

### Exit Criteria

- VLE mark submissions create SRS marks without duplicates under retry.
- Validation failures are visible and recoverable.
- Ratified result events update stub VLE result display state.

---

## Stage 7 - Reliability, Replay, Reconciliation, and Observability

**Status**: Not started

**Goal**: harden the connector for realistic integration operation.

### Scope

- Add scheduled reconciliation jobs:
  - SRS active module registrations vs VLE roster;
  - SRS adjustment distributions vs VLE applied adjustments;
  - VLE submitted marks vs SRS mark receipts.
- Add replay/backfill controls per registration.
- Add rate limiting, exponential backoff, circuit breaking, and bounded retries for VLE and SRS calls.
- Add structured logs, metrics, and health summaries:
  - event lag;
  - processing errors;
  - failed VLE writes;
  - failed SRS mark submissions;
  - reconciliation drift;
  - registration status.
- Add operational commands for retrying failed items and pausing/resuming external writes.
- Ensure no special-category adjustment detail is logged beyond IDs and classification.

### Deliverables

- Reconciliation service.
- Operational retry/pause/resume commands.
- Metrics and health reporter.
- Reliability tests.

### Exit Criteria

- Event, REST, and VLE failures are retried or surfaced without silent loss.
- Reconciliation can detect and repair drift.
- Operational health is visible through logs, metrics, and integration registry status.

---

## Stage 8 - Contract Tests and Acceptance Review

**Status**: Not started

**Goal**: confirm Phase 9 exit criteria and readiness for Phase 10 UI work.

### Scope

- Run golden-path scenarios:
  - catalogue/module update creates a VLE course shell;
  - student enrolment and module registration creates VLE access;
  - withdrawal/status change removes or suspends access;
  - Wellbeing-approved adjustment reaches VLE through SRS and is acknowledged;
  - VLE mark submission creates an SRS mark and survives retry;
  - ratified result event updates VLE display state;
  - registration endpoint changes re-point the connector without code changes.
- Run negative scenarios:
  - disabled registration blocks external writes;
  - wrong-tenant event is rejected;
  - duplicate event is ignored;
  - duplicate mark submission uses the same idempotency key;
  - VLE outage retries and reports degraded health;
  - direct Wellbeing-to-VLE adjustment path is absent.
- Add contract tests against:
  - OpenAPI mark and acknowledgement operations;
  - published event schemas;
  - integration registry configuration metadata.
- Update external integration documentation and roadmap status.

### Deliverables

- `docs/phase-9-acceptance-review.md`
- VLE connector contract tests.
- Updated `docs/integrations/examples/vle-integration.md` if needed.
- Residual gap register for Phase 10.

### Exit Criteria

- VLE Connector is operational and configurable per tenant.
- F015, F016, and F059 are verified end-to-end in a local environment with a stub VLE.
- Contract tests pass.
- Connector can be reconfigured to a different endpoint without code changes.
- No VLE adapter code reads the SRS database or imports SRS internal services.

---

## Testing Strategy

Required coverage:

- Connector build, typecheck, lint, unit tests, and integration tests.
- Stub VLE state-machine tests.
- Plugin registry configuration, endpoint safety, tenant scoping, and disable/re-enable tests.
- Event schema validation and consumer idempotency tests.
- Course provisioning end-to-end tests for F015.
- Adjustment distribution end-to-end tests for F059, including SRS acknowledgement.
- Mark submission end-to-end tests for F016, including retry/idempotency.
- Reconciliation drift detection and repair tests.
- Wrong-tenant, unauthorized, rate-limit, outage, and DLQ tests.
- Boundary tests proving no SRS database access or internal service imports.

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Connector depends on SRS internals | Stage 0 boundary classification and Stage 8 import/database-access tests |
| Duplicate events create duplicate VLE operations | Stage 3 event ledger and idempotent handlers |
| Duplicate mark retries create duplicate SRS marks | Stage 6 stable idempotency keys and receipt tracking |
| Adjustment data bypasses SRS | Stage 5 tests assert only `srs.adjustment.distributed` drives VLE adjustment state |
| VLE outage causes silent data loss | Stage 7 retries, DLQ, health reporting, and reconciliation |
| Registration changes require code redeploy | Stage 2 configuration loader and endpoint re-pointing test |
| Special-category adjustment details leak to logs | Stage 7 redaction and data-classification tests |
| Reconciliation overloads SRS or VLE | Stage 7 rate limits, backoff, and bounded batch sizes |

---

## Exit Summary

Phase 9 is complete only when the VLE Connector proves the external integration pattern under bidirectional, event-heavy conditions:

- the connector consumes only published events and REST APIs;
- course access is provisioned from SRS events;
- adjustment outcomes reach VLE only through SRS distribution;
- VLE marks are submitted to SRS safely and idempotently;
- plugin registration controls configuration, health, and enablement;
- replay and reconciliation prevent silent integration drift.
