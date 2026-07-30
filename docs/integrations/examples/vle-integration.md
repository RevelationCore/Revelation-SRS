# VLE Integration — Course Provisioning and Mark Submission

> Pattern: Events (inbound) + REST API (outbound writes)
> Audience: VLE platform teams (Moodle, Canvas, Blackboard, Brightspace, or custom)
> Classification: External integration (public surface only)

---

## Overview

A VLE integration with Revelation SRS has two main jobs:

1. **Course provisioning** (F-SIS-VLE-01): create and update VLE course shells when programmes and modules change in the SRS; enrol students when they register on modules; apply access suspensions and withdrawals from status-change events.
2. **Adjustment distribution** (F-SIS-VLE-02): receive approved adjustment outcomes (extra time, extended deadlines, alternative formats) via distribution events and apply them in the VLE; acknowledge receipt to SRS.
3. **Mark submission** (F-VLE-SIS-01): push assessment results from the VLE back into the SRS after online assessments and portfolio submissions.

The VLE is an external integration — it uses only published event subjects and public REST endpoints. It does not have access to special-category or internal-only data beyond what is explicitly included in published events.

---

## What the VLE Subscribes To

Subscribe to these NATS JetStream subjects using a durable consumer group named after your VLE instance:

```
Consumer group: vle.{tenant-id}.main
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

### Event payloads for course provisioning (F-SIS-VLE-01)

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
    "code": "CS3010",
    "title": "Algorithms and Data Structures",
    "creditValue": 15,
    "effectiveDate": "2026-09-01"
  }
}
```

Map `code` to your VLE course identifier. Store `moduleId` as the stable internal key — `code` may change across academic years.

**`srs.student.enrolled`** — a student has started an enrolment:

```json
{
  "payload": {
    "personId": "stu-001",
    "enrolmentId": "enr-def456",
    "academicYear": "2026/27",
    "modeOfStudy": "full-time"
  }
}
```

**`srs.enrolment.module-registered`** — enrol a student in a VLE course:

```json
{
  "payload": {
    "enrolmentId": "enr-def456",
    "moduleRegistrationId": "mreg-xyz789",
    "moduleOfferingId": "mo-001",
    "moduleId": "mod-abc123",
    "academicPeriodId": "ap-2026-s1",
    "registrationDate": "2026-09-15"
  }
}
```

Store `moduleRegistrationId` — it is the key for mark submission and reconciliation.

**`srs.enrolment.module-registration-withdrawn`** — remove the student from the VLE course:

```json
{
  "payload": {
    "enrolmentId": "enr-def456",
    "moduleRegistrationId": "mreg-xyz789",
    "moduleOfferingId": "mo-001",
    "withdrawnAt": "2026-10-20T12:00:00.000Z"
  }
}
```

**`srs.enrolment.module-registration-completed`** — the registration period is over; mark the course as read-only in the VLE:

```json
{
  "payload": {
    "enrolmentId": "enr-def456",
    "moduleRegistrationId": "mreg-xyz789",
    "moduleOfferingId": "mo-001",
    "completedAt": "2027-01-20T00:00:00.000Z"
  }
}
```

**`srs.student.status-changed`** — suspend or reactivate VLE access:

```json
{
  "payload": {
    "personId": "stu-001",
    "enrolmentId": "enr-def456",
    "previousStatus": "student",
    "newStatus": "interrupted",
    "effectiveDate": "2026-11-01"
  }
}
```

Map `newStatus` values: `student` → active, `interrupted` / `suspended` → suspended, `alumnus` / `withdrawn` → deactivate.

### Event payloads for adjustment distribution (F-SIS-VLE-02)

**`srs.adjustment.distributed`** — apply an approved adjustment in the VLE:

```json
{
  "payload": {
    "adjustmentId": "adj-001",
    "distributionId": "dist-001",
    "targetSystem": "vle",
    "distributedAt": "2026-10-01T09:00:00.000Z",
    "personId": "stu-001",
    "enrolmentId": "enr-def456",
    "adjustmentTypeCode": "extra-time",
    "scopeCode": "all",
    "validFrom": "2026-09-01T00:00:00.000Z",
    "validTo": "2027-07-31T00:00:00.000Z"
  }
}
```

Only process events where `targetSystem === "vle"`. After applying the adjustment in the VLE, acknowledge it to SRS (see Adjustment Acknowledgement below). Ignore `srs.adjustment.approved` — the connector acts only on `srs.adjustment.distributed`.

---

## Adjustment Acknowledgement

After processing an adjustment distribution event, acknowledge it to SRS:

```http
POST /api/v1/adjustments/{adjustmentId}/distributions/{distributionId}/acknowledge
Authorization: Bearer <integration-service-token>
Content-Type: application/json

{ "targetSystem": "vle" }
```

Response: `204 No Content`. If the VLE call fails before you can acknowledge, retry until the VLE call succeeds, then acknowledge. Do not acknowledge before the VLE has accepted the adjustment — SRS tracks pending distributions and will not report the adjustment as distributed until acknowledgement is received.

---

## Mark Submission (F-VLE-SIS-01)

After online assessments (quizzes, portfolio submissions, written assignments marked in the VLE), submit results to the SRS.

### Step 1 — Retrieve assessment components

```http
GET /api/v1/module-offerings/{moduleOfferingId}/components
Authorization: Bearer <integration-service-token>
```

The response lists `assessmentComponentId`, `componentCode`, `weighting`, and `maxMark`. Map your VLE assignment identifiers to `assessmentComponentId` values using `componentCode` as the human-readable key. Cache this mapping per module offering.

### Step 2 — Submit the mark

```http
POST /api/v1/module-registrations/{moduleRegistrationId}/marks
Authorization: Bearer <integration-service-token>
Content-Type: application/json

{
  "assessmentComponentId": "comp-001",
  "rawMark": 72,
  "attemptNumber": 1,
  "sourceSystem": "vle",
  "sourceReference": "vle-assignment-9876-stu-001-attempt1",
  "submittedAt": "2026-11-20T14:30:00.000Z"
}
```

**`sourceReference`** is the idempotency key. Use a stable value combining VLE assignment ID, student ID, and attempt number. Re-submitting with the same `sourceReference` for the same registration and component returns the original mark without creating a duplicate.

### Step 3 — Handle the response

A successful submission returns `201 Created`:

```json
{ "markId": "mark-abc123" }
```

Store `markId` for audit and reconciliation.

### Step 4 — Listen for ratification

When the exam board ratifies results, the SRS publishes `srs.assessment.module-result-ratified`:

```json
{
  "payload": {
    "moduleResultId": "mr-001",
    "moduleRegistrationId": "mreg-xyz789",
    "aggregateMark": 72,
    "resultCode": "pass",
    "examBoardId": "board-2027-s1",
    "ratifiedAt": "2027-02-01T15:00:00.000Z"
  }
}
```

Use `moduleRegistrationId` to update the result display in the VLE student portal.

---

## Plugin Registration

Register your VLE integration before going live:

```http
POST /api/v1/integration-registrations
Authorization: Bearer <tenant-admin-token>
Content-Type: application/json

{
  "contractId": "vle-course-provisioning.v1",
  "displayName": "Moodle — Acme University",
  "transportCode": "nats-jetstream",
  "endpointSafetyClass": "external-test",
  "liveTrafficApproved": false,
  "replaySupported": true,
  "consumerGroup": "vle.{tenant-id}.main"
}
```

Register a separate entry for each contract (`vle-course-provisioning.v1`, `vle-assessment-results.v1`, `vle-adjustments.v1`). The mark-submission side (F-VLE-SIS-01) is an inbound REST write — no separate registration is required for that direction.

---

## Service Account Permissions

The VLE connector service account requires the `integration-service` role. This role grants:

| Permission | Used for |
|---|---|
| `catalogue:read` | Read module and programme data |
| `module-registration:read:all` | Read registration details for reconciliation |
| `mark:write` | Submit assessment marks |
| `adjustment:read:all` | Verify adjustment details before applying |
| `integration:manage` | Acknowledge adjustment distributions |

---

## Error Handling

| Scenario | Action |
|----------|--------|
| 401 on mark submission | Refresh OAuth token and retry |
| 404 on `moduleRegistrationId` | Student not enrolled in SRS; check provisioning event was processed |
| 422 on mark submission | Validate `assessmentComponentId` exists for this module offering; check `attemptNumber` |
| 429 rate limit during bulk provisioning | Process events with exponential back-off; batch mark submissions |
| Event delivery failure | Check dead-letter subject `srs.dlq.vle.{tenant-id}.main` |

---

## Reconciliation

Run a nightly reconciliation pass:

1. Query `GET /api/v1/module-registrations?moduleOfferingId={id}` for each active module offering to get the authoritative SRS enrolment list.
2. Compare against VLE course roster.
3. For any registration in the SRS but absent from the VLE, re-process the `srs.enrolment.module-registered` event or trigger a replay:
   ```http
   POST /api/v1/integration-registrations/{registrationId}/replay
   Content-Type: application/json
   { "fromDate": "2026-09-01T00:00:00Z" }
   ```
4. For any mark submitted but not confirmed, re-submit with the same `sourceReference` — the SRS will deduplicate.
5. For any `srs.adjustment.distributed` event that is unacknowledged in SRS distributions (`GET /api/v1/adjustments/{adjustmentId}/distributions`), re-apply and acknowledge.
