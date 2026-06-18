# Phase 9 Acceptance Review — VLE Connector

> Date: 2026-06-16
> Status: **Complete**
> Reviewer: automated (Stage 8 contract and acceptance tests)
> Prerequisite: Stages 1–7 complete; all tests passing

---

## 1. Overview

This document records the Phase 9 exit review for the VLE Connector (`adapters/vle`). It confirms that the connector meets all Phase 9 exit criteria, that all three flows (F015, F016, F059) are verified end-to-end, and that the external integration pattern is reusable for later adapters.

All exit criteria are satisfied. Phase 10 UI work may begin.

---

## 2. Exit Criteria Status

| Criterion | Status | Evidence |
|-----------|--------|----------|
| VLE Connector is operational and configurable per tenant | **Pass** | Stage 2 tests: `RegistrationLoader.canWrite`, endpoint re-pointing, health reporting |
| F015 Course Provisioning verified end-to-end with stub VLE | **Pass** | Stage 4 tests + Stage 8 golden-path 3.1, 3.5 |
| F059 Adjustment Distribution verified with SRS acknowledgement | **Pass** | Stage 5 tests + Stage 8 golden-path 3.2 |
| F016 Mark Submission verified with retry/idempotency | **Pass** | Stage 6 tests + Stage 8 golden-path 3.3 |
| Combined three-flow scenario verified | **Pass** | Stage 8 test 3.4: enrol → adjust → mark → ratify |
| Contract tests pass against published event schemas | **Pass** | Stage 8 suite 2: `VLE_SUBSCRIBED_SUBJECTS` matches Stage 0 baseline exactly |
| Contract tests pass against published REST endpoint paths | **Pass** | Stage 0 gap analysis: all endpoints verified; `HttpSrsMarkClient` and `HttpSrsAcknowledgementClient` use published paths |
| No VLE connector code reads SRS database | **Pass** | Stage 8 test 1.4: grep confirms no `@revelation-srs/api` or `@revelation-srs/db` imports |
| No VLE connector code imports SRS internal services | **Pass** | Stage 8 tests 1.1–1.3: `package.json` and `tsconfig.json` reference only `packages/domain` |
| Connector can be reconfigured to a different endpoint without code changes | **Pass** | Stage 2 test 4.9: `endpointUrl` change in registry propagates on next `load()` |
| Replay and reconciliation prevent silent integration drift | **Pass** | Stage 7 reconciliation tests; Stage 8 resilience test 5.3 |
| All connector tests pass | **Pass** | 204 tests passing across Stages 1–8 |

---

## 3. Boundary Verification

The VLE connector boundary was mechanically verified by Stage 8 Suite 1 tests:

| Check | Result |
|-------|--------|
| `package.json` has no `@revelation-srs/api` dependency | **Pass** |
| `package.json` has no `@revelation-srs/db` dependency | **Pass** |
| `tsconfig.json` references only `packages/domain` | **Pass** |
| No `.ts` source file imports from `@revelation-srs/api` or `@revelation-srs/db` | **Pass** |

The connector imports only:
- `@revelation-srs/domain` — published SDK types (via TypeScript project reference)
- Standard runtime packages: `fastify`, `drizzle-orm`, `nats`, `pino`, `postgres`

---

## 4. Contract Verification

### 4.1 Event subjects

All 10 subjects specified in the Stage 0 contract baseline are present in `VLE_SUBSCRIBED_SUBJECTS`:

| Subject | Contract | Status |
|---------|----------|--------|
| `srs.catalogue.programme-updated` | F015 | **Subscribed** |
| `srs.catalogue.module-updated` | F015 | **Subscribed** |
| `srs.catalogue.learning-outcome-updated` | F015 | **Subscribed** |
| `srs.student.enrolled` | F015 | **Subscribed** |
| `srs.student.status-changed` | F015 | **Subscribed** |
| `srs.enrolment.module-registered` | F015 | **Subscribed** |
| `srs.enrolment.module-registration-withdrawn` | F015 | **Subscribed** |
| `srs.enrolment.module-registration-completed` | F015 | **Subscribed** |
| `srs.assessment.module-result-ratified` | F016 | **Subscribed** |
| `srs.adjustment.distributed` | F059 | **Subscribed** |

`srs.adjustment.approved` is **not subscribed** by design. Adjustment data reaches the VLE only via `srs.adjustment.distributed` from SRS distribution, never directly from the Wellbeing module. Stage 8 test 2.3 verifies that dispatching `srs.adjustment.approved` records `skipped` in the ledger with no VLE side-effect.

### 4.2 REST endpoints used

| Endpoint | Direction | Used for | Status |
|----------|-----------|----------|--------|
| `POST /api/v1/module-registrations/:id/marks` | Outbound | F016 mark submission | **Verified** |
| `POST /api/v1/adjustments/:id/distributions/:id/acknowledge` | Outbound | F059 acknowledgement | **Verified** |
| `GET /api/v1/integration-registrations/:id` | Inbound | Registration config load | **Verified** |
| `POST /api/v1/integration-registrations/:id/health-check` | Outbound | Health reporting | **Verified** |

### 4.3 Non-VLE targetSystem filtering

Stage 8 test 2.4 confirms that `srs.adjustment.distributed` events with `targetSystem !== 'vle'` produce no `adjustment_map` row and no VLE write. Only VLE-targeted distributions reach the VLE.

---

## 5. Golden-Path Scenarios

All scenarios were executed in integration tests against the in-process stub VLE and stub SRS servers.

### 5.1 F015 — Course Provisioning

**Scenario**: `module-updated` → `student-enrolled` → `module-registered`

| Step | Expected | Result |
|------|----------|--------|
| `module-updated` dispatched | VLE course shell created; `course_map` populated | **Pass** |
| `student-enrolled` dispatched | `student_enrolment_map` seeded with `(enrolmentId, personId)` | **Pass** |
| `module-registered` dispatched | VLE enrolment created; `enrolment_map` row with `vleEnrolmentId` | **Pass** |
| `module-registration-withdrawn` dispatched | VLE enrolment status set to `withdrawn` | **Pass** |
| All events | `event_ledger` records `processed` for each | **Pass** |

### 5.2 F059 — Adjustment Distribution

**Scenario**: `adjustment-distributed` (targetSystem=vle)

| Step | Expected | Result |
|------|----------|--------|
| `srs.adjustment.distributed` dispatched | VLE receives adjustment data | **Pass** |
| SRS acknowledgement sent | `POST /api/v1/adjustments/:id/distributions/:id/acknowledge` with `targetSystem: 'vle'` | **Pass** |
| `adjustment_map` updated | `statusCode = 'acknowledged'`, `acknowledgedAt` set | **Pass** |

### 5.3 F016 — Mark Submission and Ratification

**Scenario**: `MarkSubmissionService.submitMark()` + `srs.assessment.module-result-ratified`

| Step | Expected | Result |
|------|----------|--------|
| `submitMark()` called | `POST /api/v1/module-registrations/:id/marks` with `sourceSystem: 'vle'` | **Pass** |
| SRS returns `markId` | `mark_receipt` stored with `markId` | **Pass** |
| Duplicate `sourceReference` | SRS not called again; same `markId` returned | **Pass** |
| `module-result-ratified` dispatched | Stub VLE `results` map updated with `aggregateMark` and `resultCode` | **Pass** |

### 5.4 Combined Scenario (Stage 8 test 3.4)

A single test sequence exercises all three flows:

1. `srs.catalogue.module-updated` → VLE course created ✓
2. `srs.student.enrolled` → student-enrolment-map seeded ✓
3. `srs.enrolment.module-registered` → VLE enrolment created ✓
4. `srs.adjustment.distributed` → VLE adjustment applied + SRS acknowledged ✓
5. `MarkSubmissionService.submitMark()` → SRS mark created ✓
6. `srs.assessment.module-result-ratified` → VLE display state updated ✓
7. 5 event-ledger rows — all `processed` ✓

---

## 6. Negative Scenarios

| Scenario | Expected behaviour | Status |
|----------|--------------------|--------|
| Wrong-tenant event dispatched | Silently dropped; no ledger row | **Pass** (Stage 3) |
| Duplicate eventId dispatched | Second call is a no-op; single ledger row | **Pass** (Stage 3 + Stage 8 5.1) |
| Duplicate mark `sourceReference` | SRS called once; same `markId` returned | **Pass** (Stage 6 + Stage 8 5.2) |
| Disabled registration | `canWrite = false`; no external writes | **Pass** (Stage 2) |
| Simulator connector → external-test endpoint | `EndpointSafetyError`; blocked | **Pass** (Stage 2) |
| VLE HTTP failure | Ledger records `failed`; transaction rolled back; error propagated | **Pass** (Stage 5 + Stage 8 4.2) |
| `srs.adjustment.approved` event received | Records `skipped`; no VLE write | **Pass** (Stage 8 2.3) |

---

## 7. Reliability and Observability

### 7.1 Retry policy

`withRetry<T>(fn, opts)` provides configurable exponential backoff. Five tests verify correct retry count, backoff exhaustion, and correct error rethrow.

### 7.2 Reconciliation

Three reconciliation jobs are implemented in `ReconciliationService`:

| Job | Detects | Repairs |
|-----|---------|---------|
| `reconcileRoster()` | `enrolment_map` rows where `vleEnrolmentId IS NULL` | Calls `vleClient.upsertEnrolment()`; updates row |
| `reconcileAdjustments()` | `adjustment_map` rows where `statusCode = 'applied'` | Calls `srsAckClient.acknowledgeDistribution()`; updates row |
| `reconcileMarks()` | `mark_receipt` rows where `markId IS NULL` | Calls `srsMarkClient.submitMark()`; updates row |

All three jobs record their runs in `vle_reconciliation_run` with drift and repaired counts.

Stage 8 test 5.3 verifies the end-to-end recovery scenario: events processed during VLE outage leave `null` `vleEnrolmentId`; reconciliation on recovery syncs the gap.

### 7.3 Health reporting

`HealthService.getReport(tenantId)` returns:
- `totalProcessed`, `totalFailed`, `recentFailed` (last 24h) from `event_ledger`
- `lastProcessedAt` — most recent successful event timestamp
- `lastReconciliation` — most recent reconciliation run summary

Stage 8 tests 4.1–4.4 verify that health counts reflect real event and reconciliation data.

---

## 8. Test Coverage Summary

| Stage | Scope | Tests |
|-------|-------|-------|
| Stage 1 | Scaffold, stub VLE, app startup | included |
| Stage 2 | Registry config, endpoint safety, health reporter | included |
| Stage 3 | Event consumer, ledger, idempotency, replay | included |
| Stage 4 | F015 course provisioning | included |
| Stage 5 | F059 adjustment distribution, SRS ack | included |
| Stage 6 | F016 mark submission, ratified result | included |
| Stage 7 | Retry, reconciliation, health service | 26 tests |
| Stage 8 | Boundary, contract, golden-path, observability, resilience | 20 tests |
| **Total** | | **204 tests — all passing** |

---

## 9. Residual Gap Register for Phase 10

The following items are out of scope for Phase 9 but should be addressed in future phases:

| # | Item | Severity | Suggested Phase |
|---|------|----------|-----------------|
| R1 | Reconciliation jobs are not yet wired into a scheduler (Temporal, cron, or NATS JetStream) — they must be triggered manually or by calling the service directly | Medium | Phase 10 or a dedicated Phase 9b operationalisation |
| R2 | Health service is not exposed via an HTTP route on the connector app — external monitoring cannot query it without code instrumentation | Medium | Phase 10 |
| R3 | No circuit breaker on VLE HTTP calls — repeated outage will exhaust retry budget on every event rather than failing fast | Low | Phase 10 |
| R4 | `MarkSubmissionService` does not yet write a pending receipt before the SRS call — if the process crashes between the SRS call returning and the DB write, the mark receipt is lost (no null-markId row to reconcile from) | Low | Phase 10 |
| R5 | Integration registration `consumerGroup` field is not yet used to partition NATS consumer groups — multi-tenant isolation relies on tenantId in event envelope checks only | Low | Phase 10 |

---

## 10. Conclusion

Phase 9 is **complete**. The VLE Connector:

- consumes only published SRS events and REST APIs — boundary confirmed mechanically;
- provisions course access from SRS events (F015);
- receives and applies adjustment distributions only through SRS (F059);
- submits VLE marks to SRS safely and idempotently (F016);
- reconciles drift after outages;
- reports health state to the integration registry;
- is configurable per tenant through integration registrations without code changes;
- passes 204 automated integration tests with no failures.

Phase 10 UI work and the residual items above may begin.
