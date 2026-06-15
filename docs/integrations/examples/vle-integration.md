# VLE Integration — Course Provisioning and Mark Submission

> Pattern: Events (inbound) + REST API (outbound writes)
> Audience: VLE platform teams (Moodle, Canvas, Blackboard, Brightspace, or custom)
> Classification: External integration (public surface only)

---

## Overview

A VLE integration with Revelation SRS has two main jobs:

1. **Course provisioning**: create and update VLE course shells when programmes and modules change in the SRS; enrol students when they register on modules.
2. **Mark submission**: push assessment results from the VLE back into the SRS after online assessments and portfolio submissions.

The VLE is an external integration — it uses only published event subjects and public REST endpoints. It does not have access to special-category or internal-only data.

---

## What the VLE Subscribes To

Subscribe to these NATS JetStream subjects using a durable consumer group named after your VLE instance:

```
Consumer group: vle.{institution-code}.main
Subjects:
  srs.catalogue.programme-updated
  srs.catalogue.module-updated
  srs.catalogue.learning-outcome-updated
  srs.student.enrolled
  srs.student.status-changed
  srs.enrolment.module-registered
  srs.enrolment.module-registration-withdrawn
  srs.enrolment.module-registration-completed
  srs.assessment.module-result-ratified
  srs.adjustment.distributed
```

See [`event-consumer-guide.md`](../event-consumer-guide.md) for connection details, envelope structure, and consumer group configuration.

### Event payloads for course provisioning

**`srs.catalogue.module-updated`** — create or update a VLE course shell:

```json
{
  "id": "evt-...",
  "subject": "srs.catalogue.module-updated",
  "version": "1.0.0",
  "tenantId": "inst-001",
  "occurredAt": "2026-09-01T09:00:00.000Z",
  "payload": {
    "moduleId": "mod-abc123",
    "moduleCode": "CS3010",
    "title": "Algorithms and Data Structures",
    "level": 6,
    "credits": 15,
    "academicYear": "2026/27",
    "deliveryMode": "campus",
    "changeType": "updated"
  }
}
```

Map `moduleCode` to your VLE course identifier. Use `changeType: created` to create a new course shell and `updated` to synchronise metadata.

**`srs.enrolment.module-registered`** — enrol a student in a VLE course:

```json
{
  "payload": {
    "moduleRegistrationId": "mreg-xyz789",
    "enrolmentId": "enr-def456",
    "studentId": "stu-001",
    "moduleId": "mod-abc123",
    "moduleCode": "CS3010",
    "academicYear": "2026/27",
    "attemptNumber": 1
  }
}
```

**`srs.enrolment.module-registration-withdrawn`** — remove the student from the VLE course:

```json
{
  "payload": {
    "moduleRegistrationId": "mreg-xyz789",
    "studentId": "stu-001",
    "moduleCode": "CS3010",
    "withdrawalReason": "student-requested"
  }
}
```

**`srs.student.status-changed`** — suspend or reactivate VLE access:

```json
{
  "payload": {
    "studentId": "stu-001",
    "previousStatus": "student",
    "newStatus": "interrupted",
    "effectiveDate": "2026-11-01"
  }
}
```

Map `newStatus` values: `student` → active, `interrupted` / `suspended` → suspended, `alumnus` / `withdrawn` → deactivate.

**`srs.adjustment.distributed`** — record an adjustment in your assessment configuration:

```json
{
  "payload": {
    "adjustmentId": "adj-001",
    "studentId": "stu-001",
    "adjustmentTypeCode": "extra-time",
    "adjustmentValue": "25%",
    "effectiveFrom": "2026-09-01",
    "effectiveTo": "2027-07-31"
  }
}
```

After processing an adjustment distribution, acknowledge it:

```http
POST /api/v1/adjustments/{adjustmentId}/distributions/{distributionId}/acknowledge
Authorization: Bearer <token>
Content-Type: application/json

{ "acknowledgedBy": "vle-adapter", "acknowledgedAt": "2026-09-15T10:00:00Z" }
```

---

## Mark Submission

After online assessments (quizzes, portfolio submissions, written assignments marked in the VLE), submit results to the SRS.

### Step 1 — Identify the module registration

You will have stored `moduleRegistrationId` from the `srs.enrolment.module-registered` event. Use this as the target for mark submission.

### Step 2 — Discover assessment components

```http
GET /api/v1/module-registrations/{moduleRegistrationId}
Authorization: Bearer <token>
```

The response includes `assessmentComponents` with their `componentId`, `componentCode`, `weighting`, and `maxMark`. Your VLE assignment must map to one of these component codes.

### Step 3 — Submit the mark

```http
POST /api/v1/module-registrations/{moduleRegistrationId}/marks
Authorization: Bearer <token>
Idempotency-Key: vle-{vleAssignmentId}-{studentId}-attempt{n}
Content-Type: application/json

{
  "assessmentComponentId": "comp-001",
  "rawMark": 72,
  "attemptNumber": 1,
  "submittedAt": "2026-11-20T14:30:00.000Z",
  "submittedBy": "student",
  "sourceSystemRef": "vle-assignment-9876"
}
```

**Idempotency key**: use a stable key combining VLE assignment ID, student ID, and attempt number. Re-submitting with the same key returns the original mark without duplication.

### Step 4 — Handle the response

```json
{
  "markId": "mark-abc123",
  "moduleRegistrationId": "mreg-xyz789",
  "assessmentComponentId": "comp-001",
  "rawMark": 72,
  "adjustedMark": 90,
  "status": "received",
  "latepenaltyApplied": false,
  "submittedAt": "2026-11-20T14:30:00.000Z"
}
```

Store `markId` for audit and reconciliation. The `adjustedMark` reflects any approved adjustments (extra time, deferrals) applied by the SRS automatically.

### Step 5 — Listen for ratification

When the exam board ratifies results, the SRS publishes `srs.assessment.module-result-ratified`:

```json
{
  "payload": {
    "moduleRegistrationId": "mreg-xyz789",
    "moduleCode": "CS3010",
    "studentId": "stu-001",
    "finalGrade": "first",
    "finalMark": 72,
    "ratifiedAt": "2027-02-01T15:00:00.000Z",
    "boardId": "board-2027-s1"
  }
}
```

Use this event to display ratified results in the VLE student portal.

---

## Plugin Registration

Register your VLE integration before going live:

```http
POST /api/v1/integration-registrations
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "contractId": "exam-scheduling.v1",
  "displayName": "Moodle — Acme University",
  "transportCode": "nats-push",
  "endpointSafetyClass": "external-test",
  "liveTrafficApproved": false,
  "replaySupported": true
}
```

VLE integrations primarily use event subscription (NATS JetStream) rather than a pushed endpoint, so `transportCode: nats-push` and no `endpointUrl` is appropriate for the event consumer side. The mark-submission side is a REST write — no separate registration is needed for inbound REST calls.

---

## Error Handling

| Scenario | Action |
|----------|--------|
| 401 on mark submission | Refresh OAuth token and retry |
| 404 on `moduleRegistrationId` | Student not enrolled in SRS; check provisioning event was processed |
| 422 on mark submission | Validate `assessmentComponentId` exists for this registration; check `attemptNumber` |
| 429 rate limit during bulk provisioning | Process events with exponential back-off; batch mark submissions |
| Event delivery failure | Check dead-letter subject `srs.dlq.vle.{institution-code}.main` |

---

## Reconciliation

Run a nightly reconciliation pass:

1. Query enrolled students via `GET /api/v1/enrolments?moduleCode=CS3010&academicYear=2026/27`.
2. Compare against VLE enrolment roster.
3. For any student in the SRS but not in the VLE, replay the `srs.enrolment.module-registered` event via:
   ```http
   POST /api/v1/integration-registrations/{registrationId}/replay
   { "fromDate": "2026-09-01T00:00:00Z" }
   ```
4. For any mark submitted but not confirmed in the SRS, re-submit with the same idempotency key.
