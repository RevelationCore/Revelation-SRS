# Phase 8 — Student Wellbeing & Disability: Acceptance Review

**Date:** 2026-06-15
**Reviewer:** Steve J White
**Module:** `@revelation-srs/wellbeing`
**Status:** PASSED — all 216 integration tests green

---

## 1. Scope

Phase 8 delivers the **Student Wellbeing & Disability** first-party module for Revelation SRS. The module handles:

- Disability support casework, DSA entitlements, and evidence management
- Adjustment case workflow with SRS distribution (F041 handoff)
- Exceptional circumstances claims with exam board visibility (F066 handoff)
- Mental health case management, session notes, and intervention plans
- Early warning alerts and triage
- Security hardening: RBAC, session note access control, SAR export, data retention

This acceptance review validates Phase 8's exit criteria through eight integration test stages covering golden-path scenarios and negative/boundary cases.

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  @revelation-srs/wellbeing (Fastify service)                      │
│                                                                    │
│  Routes: disability-cases · adjustment-cases · ec-claims          │
│          mental-health-cases · early-warning-alerts · sar          │
│          admin-retention                                           │
│                                                                    │
│  Repositories: disability · adjustment · ec · mental-health        │
│                projection · audit · sar                            │
│                                                                    │
│  SRS clients: SrsAdjustmentClient (F041) · SrsEcClient (F066)     │
│                                                                    │
│  DB: PostgreSQL (wellbeing schema, RLS-enforced per tenant)        │
│  Outbox: srs_handoff_outbox · ec_handoff_outbox (exactly-once)    │
└──────────────────────────────────────────────────────────────────┘
```

All sensitive fields (`content`, `notes`, `goals`, `presentingConcernCode`, `externalReferralDetails`) are redacted from Pino structured log output.

---

## 3. Exit Criteria

| # | Criterion | Result |
|---|-----------|--------|
| EC-01 | Disability casework end-to-end (open → evidence → DSA → adjustment → SRS) | PASS |
| EC-02 | EC claim end-to-end (submit → review → determine → SRS exam board) | PASS |
| EC-03 | MH early warning → triage → case → session notes → intervention plan | PASS |
| EC-04 | Adjustment handoff is exactly-once (outbox pattern, idempotency key) | PASS |
| EC-05 | Failed SRS handoff triggers compensation; retry succeeds | PASS |
| EC-06 | Duplicate handoff call is idempotent (already_sent short-circuit) | PASS |
| EC-07 | SRS boundary: only the SRS API client may deliver; no direct DB writes | PASS |
| EC-08 | Cross-tenant isolation: tenant A cannot read/modify tenant B records | PASS |
| EC-09 | RBAC: session notes require `wellbeing-mental-health-advisor`; panel decisions require `wellbeing-panel-chair`; SAR/retention require `wellbeing-auditor` | PASS |
| EC-10 | Unauthenticated and unauthorised requests return 401/403 | PASS |
| EC-11 | All workflow states and status transitions are covered | PASS |
| EC-12 | Audit log captures every read/write of special-category data | PASS |
| EC-13 | SAR export covers all wellbeing-owned tables and is logged | PASS |
| EC-14 | Retention policy: apply endpoint closes cases past due date, is idempotent | PASS |
| EC-15 | All 216 integration tests pass without skips or pending | PASS |

---

## 4. Test Stage Summary

### Stage 1 — Database Scaffold
Verified schema creation, RLS policies, and bitemporal constraints. 14 tests.

### Stage 2 — SRS Context Ingestion
Verified NATS event consumption, projection upserts, and idempotency of event replay. 12 tests.

### Stage 3 — Disability Case Management
Full disability case lifecycle: open, evidence attach/verify, DSA entitlement, status transitions, audit logging, tenant isolation. 28 tests.

### Stage 4 — Adjustment Workflow
Adjustment case creation, assessment recording, panel decision, approval with SRS F041 handoff, rejection, SRS boundary enforcement. Exactly-once delivery via outbox. 24 tests.

### Stage 5 — Exceptional Circumstances Workflow
EC claim submission, evidence review (auto-advances to `under_review` when sufficient), upheld determination with SRS F066 handoff, not_upheld (no SRS call), idempotent re-determine, withdrawal. 22 tests.

### Stage 6 — Mental Health and Early Intervention
MH case creation, consent recording, session notes (special-category access), risk level update, intervention plan lifecycle, early warning alert triage and linkage, wellbeing summary report (aggregate-only). Tenant isolation and audit. 35 tests.

### Stage 7 — Security, Privacy, Audit, and Retention Hardening
Authentication (401 for no JWT), RBAC enforcement per role, SAR export completeness and logging, retention scheduling and apply, data governance defaults (`lawful_basis_code`, `data_classification_code`), role separation cross-checks. 30 tests.

### Stage 8 — End-to-End Acceptance Review
Comprehensive golden-path and negative scenarios. 51 tests — see §5.

---

## 5. Stage 8 Scenarios

### Golden Path 1 — Disability casework to SRS adjustment distribution

| Step | Action | Outcome |
|------|--------|---------|
| 1.1 | Create disability support case | 201; wellbeing case opens automatically |
| 1.2 | Attach evidence reference (EDRMS document) | 201; `evidenceId` and `documentRef` returned |
| 1.3 | Transition evidence status to `received` | 204 |
| 1.4 | Add DSA entitlement | 201 |
| 1.5 | Fetch disability case detail | 200; `evidence` and `entitlements` arrays present |
| 1.6 | Transition case to `active_support` | 204 |
| 1.7 | Create adjustment case linked to disability case | 201 |
| 1.8 | Record formal assessment (outcome: `recommended`) | 201 |
| 1.9 | Panel chair records panel decision (`upheld`) | 201 |
| 1.10 | Panel chair approves → SRS API called | 202; `adjustmentId` returned; SRS client received exactly one submission |
| 1.11 | Adjustment case detail | `statusCode: approved`; `srsApplicationRef` set; `srsHandoffStatus: sent` |
| 1.12 | Outbox record | `status_code: sent`; `attempt_count: 0` (zero retries) |

### Golden Path 2 — EC claim to SRS exam board visibility

| Step | Action | Outcome |
|------|--------|---------|
| 2.1 | Submit EC claim | 201; wellbeing case opens automatically |
| 2.2 | Transition to `under_review` | 204 |
| 2.3 | Record evidence review (`sufficient`) | 201 |
| 2.4 | Determine as `upheld` → SRS EC client called | 202; `exceptionalCircumstancesId` returned |
| 2.5 | EC claim detail | `statusCode: upheld`; `determination.determinationCode: upheld`; `srsHandoffStatus: sent` |
| 2.6 | `not_upheld` determination | 204; SRS client **not** called |

### Golden Path 3 — Early warning alert to mental health intervention

| Step | Action | Outcome |
|------|--------|---------|
| 3.1 | Pending alert in triage queue | Appears in `GET ?triageStatus=pending` |
| 3.2 | MH advisor creates MH case | 201 |
| 3.3 | Triage alert: assign to MH case | 204; detail confirms `triageStatusCode: assigned` and `assignedCaseId` |
| 3.4 | Record informed consent | 204 |
| 3.5 | MH advisor posts session note | 201 |
| 3.6 | Session note list | Includes posted note |
| 3.7 | Create intervention plan | 201; `statusCode: draft` |
| 3.8 | Activate intervention plan | 204 |
| 3.9 | Active plans list via MH case detail | Plan appears; `statusCode: active` |

### Golden Path 4 — Projection replay

| Step | Action | Outcome |
|------|--------|---------|
| 4.1 | Upsert projection with initial state | Readable via GET |
| 4.2 | Re-upsert with updated enrolment/modules | Same `personId`; values updated |
| 4.3 | Replay: project a third time | Idempotent; latest state reflects third upsert |
| 4.4 | Adjustment approve uses updated projection for validation | 202; no 409 from stale module list |

### Negative Scenario N1 — Duplicate handoff idempotency

| Step | Action | Outcome |
|------|--------|---------|
| N1.1 | Approve adjustment (first call) | 202; SRS called once |
| N1.2 | Approve same adjustment again (second call) | 200; `status: already_sent`; SRS **not** called again |
| N1.3 | Outbox has exactly one row | `status_code: sent`; `attempt_count: 0` |

### Negative Scenario N2 — Failed handoff with compensation and retry

| Step | Action | Outcome |
|------|--------|---------|
| N2.1 | Set SRS stub to `shouldFail = true` | — |
| N2.2 | Approve adjustment → SRS fails | 502; outbox `status_code: failed`; `attempt_count: 1` |
| N2.3 | Set SRS stub to `shouldFail = false` | — |
| N2.4 | Retry approve (same endpoint, same body) | 202; SRS called; `status: submitted` |
| N2.5 | Outbox after retry | `status_code: sent` |

### Negative Scenario N3 — SRS boundary enforcement

| Step | Action | Outcome |
|------|--------|---------|
| N3.1 | List wellbeing DB tables | `wellbeing_case`, `disability_support_case`, `adjustment_case`, `ec_claim`, `mental_health_case` present — no SRS core tables |
| N3.2 | Confirm no direct writes to SRS tables | No `student`, `module`, `enrolment` tables in wellbeing schema |

### Negative Scenario N4 — Cross-tenant isolation

| Step | Action | Outcome |
|------|--------|---------|
| N4.1 | Create disability case in tenant A | 201 |
| N4.2 | Create separate app with tenant B JWT | — |
| N4.3 | Tenant B requests tenant A case ID | 404 |
| N4.4 | Tenant B creates own case | 201; own `caseId` returned |

### Negative Scenario N5 — Unauthorised access denial

| Step | Action | Outcome |
|------|--------|---------|
| N5.1 | POST session note with `wellbeing-advisor` JWT | 403 |
| N5.2 | POST panel decision with `wellbeing-advisor` JWT | 403 |
| N5.3 | GET SAR export with `wellbeing-advisor` JWT | 403 |
| N5.4 | POST approve with `wellbeing-advisor` JWT | 403 |
| N5.5 | Any route with no JWT | 401 |

---

## 6. Known Limitations and Future Work

| Item | Description | Priority |
|------|-------------|----------|
| Async retry worker | Current retry is synchronous (re-POST to same endpoint). A background worker polling `srs_handoff_outbox WHERE status_code='failed'` would provide true resilience. | Phase 9 |
| SAR deletion | GDPR Art.17 right to erasure is not yet implemented; currently only export (Art.15 SAR) is supported. | Phase 9 |
| Notification events | No NATS events are published from wellbeing on case transitions. Downstream modules (student portal, tutor dashboard) cannot subscribe without polling. | Phase 9 |
| Attachment storage | Evidence references point to EDRMS document refs (opaque strings). A real EDRMS integration or file-store adapter is not implemented. | Phase 10 |

---

## 7. Test Run Evidence

```
Test Files  8 passed (8)
     Tests  216 passed (216)
  Start at  2026-06-15
  Duration  ~35s (integration tests against real PostgreSQL)
```

Test files:
- `test/stage1-scaffold.int.test.ts` — 14 tests
- `test/stage2-context-ingestion.int.test.ts` — 12 tests
- `test/stage3-disability-management.int.test.ts` — 28 tests
- `test/stage4-adjustment-workflow.int.test.ts` — 24 tests
- `test/stage5-ec-workflow.int.test.ts` — 22 tests
- `test/stage6-mental-health-intervention.int.test.ts` — 35 tests
- `test/stage7-security-privacy-audit.int.test.ts` — 30 tests
- `test/stage8-acceptance.int.test.ts` — 51 tests

---

## 8. Sign-off

Phase 8 **PASSED** acceptance review. All 15 exit criteria met. The Student Wellbeing & Disability module is production-ready for deployment under the Phase 9 integration milestone.
