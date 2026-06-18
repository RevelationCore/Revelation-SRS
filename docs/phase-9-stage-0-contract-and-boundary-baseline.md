# Phase 9 Stage 0 — Contract and Boundary Baseline

> Date: 2026-06-15
> Status: Complete
> Prerequisite: Phase 7 (integration contract platform); Phase 8 (adjustment distribution proven end-to-end)

---

## 1. Purpose

This document establishes the Phase 9 integration boundary before implementation begins. It verifies that every Phase 9 flow maps to a published contract, confirms all required event schemas and REST endpoints exist and are complete, records gaps found during baseline reconciliation and how they were resolved, and defines the connector-owned persistence model and stub VLE API shape.

---

## 2. Contract Mapping

| Flow | Contract ID | Direction | Transport | Status |
|------|------------|-----------|-----------|--------|
| F015 Course provisioning | `vle-course-provisioning.v1` | Outbound | NATS JetStream | Published — complete |
| F016 Mark submission | `vle-assessment-results.v1` | Inbound | REST POST | Published — complete |
| F059 Adjustment distribution | `vle-adjustments.v1` | Outbound | NATS JetStream | Published — complete |

All three contracts are registered in `docs/architecture/integration-contract-catalogue.md` and verified against the Phase 7 published contract index.

---

## 3. Event Subscriptions

All subjects are present in `schemas/events/registry.json` with published JSON Schema files.

### 3.1 F015 — Course provisioning events

| Subject | Schema | Required fields confirmed |
|---------|--------|--------------------------|
| `srs.catalogue.programme-updated` | `schemas/events/catalogue/programme-updated/v1.json` | ✓ |
| `srs.catalogue.module-updated` | `schemas/events/catalogue/module-updated/v1.json` | `moduleId`, `code`, `title`, `creditValue`, `effectiveDate` |
| `srs.catalogue.learning-outcome-updated` | `schemas/events/catalogue/learning-outcome-updated/v1.json` | ✓ |
| `srs.student.enrolled` | `schemas/events/student/enrolled/v1.json` | `personId`, `enrolmentId`, `academicYear`, `modeOfStudy` |
| `srs.student.status-changed` | `schemas/events/student/status-changed/v1.json` | `personId`, `enrolmentId`, `previousStatus`, `newStatus`, `effectiveDate` |
| `srs.enrolment.module-registered` | `schemas/events/enrolment/module-registered/v1.json` | `enrolmentId`, `moduleRegistrationId`, `moduleOfferingId`, `moduleId`, `academicPeriodId`, `registrationDate` |
| `srs.enrolment.module-registration-withdrawn` | `schemas/events/enrolment/module-registration-withdrawn/v1.json` | `enrolmentId`, `moduleRegistrationId`, `moduleOfferingId`, `withdrawnAt` |
| `srs.enrolment.module-registration-completed` | `schemas/events/enrolment/module-registration-completed/v1.json` | `enrolmentId`, `moduleRegistrationId`, `moduleOfferingId`, `completedAt` |

**Note:** event schemas do not include `personId` in enrolment-level events (module-registered, module-registration-withdrawn, module-registration-completed). The connector must join via `enrolmentId` using `srs.student.enrolled` / the local roster. This is by design — enrolment events carry enrolment-level context, not personal identity.

### 3.2 F059 — Adjustment distribution

| Subject | Schema | Required fields confirmed |
|---------|--------|--------------------------|
| `srs.adjustment.distributed` | `schemas/events/adjustment/distributed/v1.json` | `adjustmentId`, `distributionId`, `targetSystem`, `distributedAt`, `personId`, `enrolmentId`, `adjustmentTypeCode`, `scopeCode`, `validFrom` |

The connector filters on `targetSystem === "vle"` and ignores all other target systems. It does not consume `srs.adjustment.approved` — only `distributed` events drive VLE adjustment state.

### 3.3 F016 — Ratification notification

| Subject | Schema | Required fields confirmed |
|---------|--------|--------------------------|
| `srs.assessment.module-result-ratified` | `schemas/events/assessment/module-result-ratified/v1.json` | `moduleResultId`, `moduleRegistrationId`, `aggregateMark`, `resultCode`, `examBoardId`, `ratifiedAt` |

---

## 4. REST Operations

All endpoints verified against the committed `apps/api/openapi/v1.json` snapshot.

### 4.1 F015 — Roster reconciliation

| Method | Path | Permission required | Verified |
|--------|------|---------------------|---------|
| `GET` | `/api/v1/module-registrations/{moduleRegistrationId}` | `module-registration:read:all` | ✓ |
| `GET` | `/api/v1/module-registrations?moduleOfferingId={id}` | `module-registration:read:all` | ✓ |
| `GET` | `/api/v1/module-offerings/{moduleOfferingId}/components` | `catalogue:read` | ✓ |

### 4.2 F016 — Mark submission

| Method | Path | Body (required) | Permission required | Verified |
|--------|------|-----------------|---------------------|---------|
| `POST` | `/api/v1/module-registrations/{moduleRegistrationId}/marks` | `assessmentComponentId`, `rawMark` | `mark:write` | ✓ |

`sourceReference` is the idempotency vehicle — the SRS deduplicates on `(moduleRegistrationId, assessmentComponentId, sourceReference)`. Connectors must include it for safe retry.

### 4.3 F059 — Adjustment acknowledgement

| Method | Path | Body (required) | Permission required | Verified |
|--------|------|-----------------|---------------------|---------|
| `POST` | `/api/v1/adjustments/{adjustmentId}/distributions/{distributionId}/acknowledge` | `targetSystem` | `integration:manage` | ✓ |
| `GET` | `/api/v1/adjustments/{adjustmentId}` | — | `adjustment:read:all` | ✓ |

### 4.4 Integration registry

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `/api/v1/integration-registrations` | Register contract per tenant |
| `GET` | `/api/v1/integration-registrations/{registrationId}` | Read config at runtime |
| `PATCH` | `/api/v1/integration-registrations/{registrationId}` | Update endpoint or safety class |
| `POST` | `/api/v1/integration-registrations/{registrationId}/enable` | Re-enable after disable |
| `POST` | `/api/v1/integration-registrations/{registrationId}/disable` | Disable without losing offset |
| `POST` | `/api/v1/integration-registrations/{registrationId}/health-check` | Publish connector health |
| `POST` | `/api/v1/integration-registrations/{registrationId}/replay` | Backfill from date |

---

## 5. Boundary Statement

The VLE connector must satisfy these constraints throughout implementation. Stage 8 contract tests will verify them mechanically.

| Constraint | Enforcement |
|-----------|-------------|
| No direct read or write to SRS PostgreSQL tables | Connector has no DB credentials for SRS core schema |
| No import of SRS internal service classes (`AdjustmentService`, `MarkService`, etc.) | Connector package has no dependency on `@revelation-srs/api` or `@revelation-srs/db` |
| No import of SRS domain types beyond published SDK types | If an SDK package is defined, only public exports are permitted |
| Adjustment data reaches the VLE only via `srs.adjustment.distributed` events | `srs.adjustment.approved` events are ignored; no Wellbeing module APIs are called |
| Marks are submitted only via the published REST endpoint | No other write path to the SRS mark table |
| Tenant isolation is enforced at the NATS consumer group level | Consumer group includes tenant ID; wrong-tenant events are rejected by envelope check |

---

## 6. Service Account Permissions

The VLE connector authenticates as role `integration-service`. The following permissions apply:

| Permission | Endpoints covered |
|-----------|-------------------|
| `catalogue:read` | `GET /module-offerings/:id/components`, catalogue event subjects |
| `module-registration:read:all` | `GET /module-registrations/:id`, `GET /module-registrations?...` |
| `mark:write` | `POST /module-registrations/:id/marks` |
| `adjustment:read:all` | `GET /adjustments/:id` |
| `integration:manage` | `POST /adjustments/:id/distributions/:id/acknowledge`, integration-registrations management |

All four permissions (`mark:write`, `module-registration:read:all`, `adjustment:read:all`, `integration:manage`) were extended to include `integration-service` in `packages/domain/src/permissions.ts` during Stage 0 — they previously covered only human operator roles.

---

## 7. Gap Register

Gaps found during Stage 0 reconciliation and their resolution:

| # | Gap | Severity | Resolution | Status |
|---|-----|----------|------------|--------|
| G1 | `srs.adjustment.distributed` event schema contained only `adjustmentId`, `distributionId`, `targetSystem`, `distributedAt` — insufficient for a connector to apply the adjustment without an additional REST call | Critical | Schema enriched with `personId`, `enrolmentId`, `adjustmentTypeCode`, `scopeCode`, `validFrom`, `validTo`; `acknowledgeDistribution` service method updated to fetch and include the parent adjustment record | **Resolved** |
| G2 | No `GET /api/v1/adjustments/:adjustmentId` endpoint — connector could not verify adjustment state (e.g. has it been expired since the distributed event?) | Critical | Route added to `apps/api/src/routes/adjustments.ts`; `getAdjustment` method added to `AdjustmentService`; OpenAPI snapshot regenerated | **Resolved** |
| G3 | `integration-service` role lacked `mark:write`, `module-registration:read:all`, `adjustment:read:all`, `integration:manage` — connector service account could not call any of its required endpoints | Critical | All four permissions extended to include `integration-service` in `packages/domain/src/permissions.ts` | **Resolved** |
| G4 | `docs/integrations/examples/vle-integration.md` contained field names that did not match published schemas: `studentId` (should be `personId`), `moduleCode` (not in enrolment events), `acknowledgedBy`/`acknowledgedAt` (acknowledge body is `{ targetSystem }`), `submittedBy`/`sourceSystemRef` (mark body uses `sourceSystem`/`sourceReference`), result ratified payload showed wrong fields | Minor | VLE example guide rewritten to use actual schema field names throughout | **Resolved** |
| G5 | VLE example guide claimed `GET /module-registrations/:id` response includes `assessmentComponents` — it does not; components are on `GET /module-offerings/:id/components` | Minor | Guide corrected to use the offering components endpoint | **Resolved** |
| G6 | VLE example Plugin Registration used `contractId: "exam-scheduling.v1"` — wrong contract for a VLE integration | Minor | Guide corrected to `vle-course-provisioning.v1` with a note to register all three contracts | **Resolved** |
| G7 | `srs.enrolment.module-registered` and sibling events do not carry `personId` — the connector must derive person identity from `enrolmentId` using the local roster built from `srs.student.enrolled` events | Design decision | Documented in §3.1; connector design must maintain an `enrolmentId → personId` map from enrolled events | **Accepted** |
| G8 | Consumer group naming token `{institution-code}` in the Phase 9 plan is undefined — the platform uses `tenantId` (UUID) as the tenant identifier | Minor | Stage 0 baseline and VLE guide updated to use `{tenant-id}` | **Resolved** |

---

## 8. Stub VLE API Shape

The stub VLE (implemented in Stage 1) must support the following operations. All endpoints are local-only, unsecured, and designed for test inspection.

### 8.1 Course management

| Method | Path | Body | Notes |
|--------|------|------|-------|
| `POST` | `/stub/courses` | `{ moduleId, code, title, creditValue }` | Create or update a course shell (upsert on `moduleId`) |
| `GET` | `/stub/courses` | — | List all course shells |
| `GET` | `/stub/courses/{moduleId}` | — | Get a single course shell with its roster |

### 8.2 Enrolment roster

| Method | Path | Body | Notes |
|--------|------|------|-------|
| `POST` | `/stub/courses/{moduleId}/enrolments` | `{ moduleRegistrationId, personId, enrolmentId, statusCode }` | Enrol a student; `statusCode`: `active` \| `suspended` \| `withdrawn` \| `completed` |
| `PATCH` | `/stub/courses/{moduleId}/enrolments/{moduleRegistrationId}` | `{ statusCode }` | Update access state |
| `GET` | `/stub/courses/{moduleId}/enrolments` | — | List current roster |

### 8.3 Adjustments

| Method | Path | Body | Notes |
|--------|------|------|-------|
| `POST` | `/stub/adjustments` | `{ adjustmentId, distributionId, personId, adjustmentTypeCode, scopeCode, validFrom, validTo? }` | Record an applied adjustment |
| `GET` | `/stub/adjustments` | — | List all applied adjustments |
| `GET` | `/stub/adjustments/{adjustmentId}` | — | Get a specific applied adjustment |

### 8.4 Marks and results

| Method | Path | Body | Notes |
|--------|------|------|-------|
| `POST` | `/stub/marks` | `{ moduleRegistrationId, assessmentComponentId, rawMark, sourceReference }` | Record a submitted mark |
| `PATCH` | `/stub/courses/{moduleId}/enrolments/{moduleRegistrationId}/result` | `{ aggregateMark, resultCode, ratifiedAt }` | Update displayed ratified result |
| `GET` | `/stub/marks` | — | List all submitted marks |

### 8.5 Inspection

| Method | Path | Notes |
|--------|------|-------|
| `DELETE` | `/stub/reset` | Clear all state (used in test beforeAll/afterAll) |
| `GET` | `/stub/health` | Returns `{ status: "ok" }` |

---

## 9. Connector-Owned Persistence

The connector maintains its own PostgreSQL schema (`vle_connector`). No cross-schema joins to the SRS core schema are permitted.

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `vle_event_ledger` | Idempotency log for all consumed events | `event_id`, `subject`, `tenant_id`, `processed_at`, `status_code` (`processed` \| `failed` \| `skipped`) |
| `vle_course_map` | SRS `moduleId` → stub/live VLE course ID | `module_id`, `tenant_id`, `vle_course_id`, `synced_at` |
| `vle_enrolment_map` | SRS `moduleRegistrationId` → VLE enrolment record | `module_registration_id`, `tenant_id`, `vle_enrolment_id`, `person_id`, `status_code`, `synced_at` |
| `vle_adjustment_map` | Applied adjustments by `adjustmentId` | `adjustment_id`, `distribution_id`, `tenant_id`, `applied_at`, `acknowledged_at`, `status_code` (`pending` \| `applied` \| `acknowledged` \| `failed`) |
| `vle_mark_receipt` | SRS mark IDs for submitted marks | `source_reference`, `module_registration_id`, `tenant_id`, `mark_id`, `submitted_at` |
| `vle_reconciliation_run` | Reconciliation job history | `id`, `tenant_id`, `run_type` (`roster` \| `adjustments` \| `marks`), `started_at`, `completed_at`, `drift_count`, `repaired_count` |

---

## 10. Exit Criteria — Stage 0

- [x] Every Phase 9 flow maps to a published contract.
- [x] All required event subjects exist in the schema registry with confirmed field sets.
- [x] All required REST endpoints exist in the committed OpenAPI snapshot.
- [x] The connector boundary (no DB access, no internal imports) is stated and will be verified by Stage 8 tests.
- [x] All gaps found during reconciliation are resolved or formally accepted.
- [x] Stub VLE API shape is defined.
- [x] Connector persistence tables are defined.
- [x] Service account permissions are confirmed and the `integration-service` role has been granted necessary access.
