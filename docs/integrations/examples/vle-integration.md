# VLE Integration — Course Provisioning and Mark Submission

> Pattern: Events (inbound) + REST API (outbound writes)
> Audience: VLE platform teams (Moodle, Canvas, Blackboard, Brightspace, or custom)
> Classification: External integration (public surface only)

---

## Overview

A VLE integration with Revelation SRS has two main jobs:

1. **Course provisioning** (F-SIS-VLE-01): create and update VLE course shells when programmes and modules change in the SRS; enrol students when they register on modules; apply access suspensions and withdrawals from status-change events.
2. **Adjustment distribution** (F-SIS-VLE-02): receive the SRS's instructions to apply, and later withdraw, approved reasonable adjustments; turn them into the VLE's own mechanism (per-quiz extra time, group overrides); and report back to the SRS.
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
  srs.adjustment.distribution-requested.vle
  srs.adjustment.distribution-withdrawal-requested.vle
```

The two adjustment subjects end in your target system (`vle`): the SRS publishes one instruction per target, so a VLE connector receives, and can be authorised for, only its own. The envelope `type` omits the suffix (`srs.adjustment.distribution-requested`).

Do **not** wait for `srs.adjustment.distributed`. It is a confirmation the SRS publishes *after* a target acknowledges; a connector that waited for it would never apply anything.

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

**`srs.adjustment.distribution-requested.vle`** — apply an approved adjustment:

```json
{
  "id": "2b0d…",
  "type": "srs.adjustment.distribution-requested",
  "dataClassification": "sensitive",
  "payload": {
    "distributionId": "dist-001",
    "adjustmentId": "adj-001",
    "targetSystem": "vle",
    "personId": "stu-001",
    "enrolmentId": "enr-def456",
    "adjustmentTypeCode": "extra-time",
    "scopeCode": "all",
    "amount": { "value": 25, "unitCode": "percent-of-duration" },
    "validFrom": "2026-09-01T00:00:00.000Z",
    "validTo": "2027-07-31T00:00:00.000Z",
    "requestedAt": "2026-08-20T10:15:00.000Z"
  }
}
```

| Field | Notes |
|---|---|
| `distributionId` | Your idempotency key. The SRS republishes an instruction until it is recorded as published, always with the same envelope `id`, so expect duplicates. |
| `adjustmentTypeCode` | `extra-time`, `rest-breaks`, `deadline-extension`, `separate-room`, `reader`, `scribe`, or a tenant-added code. |
| `amount` | Structured amount; absent when the type has none or none was recorded. `unitCode` is `percent-of-duration` (25 = 25% of the assessment's duration), `minutes-per-hour` (15 = 15 minutes per hour), or `days`. |
| `validFrom`, `validTo` | The adjustment's valid period. Apply it only while it is in force. |
| Notes | Never included. Target systems, and the staff who use them, see only what they need to act. |

**`srs.adjustment.distribution-withdrawal-requested.vle`** — remove an adjustment you were told to apply, because it has ended:

```json
{
  "payload": {
    "distributionId": "dist-001",
    "adjustmentId": "adj-001",
    "targetSystem": "vle",
    "personId": "stu-001",
    "enrolmentId": "enr-def456",
    "endedAt": "2027-03-14T12:00:00.000Z",
    "reasonCode": "expired",
    "requestedAt": "2027-03-14T12:00:00.000Z"
  }
}
```

It is sent whenever the instruction was published, whether or not you acknowledged it, since you may have applied it without the acknowledgement arriving. VLE overrides do not lapse on their own, so this is the only removal signal.

### Applying adjustments in the VLE

A VLE stores extra time per assessment, not per student, so a connector should keep a *desired state* per student per course and make the VLE match it, rather than translate each event into one write:

1. **Combine.** Add a student's time adjustments (`extra-time`, `rest-breaks`) on the same enrolment into one percentage: 25% extra time plus 10 minutes per hour of rest breaks is 25 + 16.67 = 41.67%. A VLE holds one value per student per quiz, so applying only the latest adjustment would silently drop the other.
2. **Compute per assessment.** Extra minutes = limit × percentage, rounded up (25% of 45 minutes = 12), so the student is never short.
3. **Keep it current.** Re-apply when the student joins a course, when staff add timed assessments, and when an adjustment's valid period starts or ends. Each write states the full value (0 = none), so repeating it is harmless.

How each platform holds it (the reference connector in `adapters/vle/src/vle-platforms` implements these):

| Platform | Mechanism |
|---|---|
| Canvas | Per-quiz extra minutes for the student: Classic Quizzes `POST /api/v1/courses/:course_id/quizzes/:quiz_id/extensions` with `quiz_extensions[].extra_time`; New Quizzes `POST /api/quiz/v1/courses/:course_id/quizzes/:assignment_id/accommodations` with `extra_time`. Canvas's course-level New Quizzes accommodation takes one number of minutes for every quiz, so it cannot express a percentage. Canvas does not document how to clear an accommodation; the reference connector writes `extra_time: 0`. Verify both points on a test instance. |
| Moodle | An SRS-managed group per entitlement in each course ("Extra time +25% (SRS)", ID number `srs-extra-time-25`), maintained with `core_group_*` web services; the student is found by ID number (`core_user_get_users_by_field`). Course staff give that group an override (time limit × 1.25) on each timed quiz. Verified against Moodle 5.3.1 (`infra/compose/moodle.compose.yml`, `adapters/vle/test/moodle-live.int.test.ts`). Moodle 5.3.1 also has `mod_quiz_save_overrides`/`get_overrides`/`delete_overrides`, so a per-quiz user-override driver is possible; the reference connector does not write them. |

Types without a time amount (`separate-room`, `reader`, `scribe`) need no VLE write. A `deadline-extension` records that the student is *eligible*; whether a particular deadline moves is decided per assessment, so the reference connector does not move deadlines automatically.

---

## Replying to the SRS

Reply to each instruction with one of these calls, all with `Authorization: Bearer <integration-service-token>` and `integration:manage`:

| When | Call | Body |
|---|---|---|
| Applied (or nothing to apply in the VLE) | `POST /api/v1/adjustments/{adjustmentId}/distributions/{distributionId}/acknowledge` | `{ "targetSystem": "vle" }` |
| You cannot apply it (no amount for a time adjustment; student unknown to the VLE; you have stopped retrying) | `POST /api/v1/adjustments/{adjustmentId}/distributions/{distributionId}/failure` | `{ "targetSystem": "vle", "reason": "…" }` |
| Withdrawn | `POST /api/v1/adjustments/{adjustmentId}/distributions/{distributionId}/withdrawal/acknowledge` | `{ "targetSystem": "vle" }` |

All three return `204 No Content` and are safe to repeat. Do not acknowledge before the VLE has accepted the change. `409 Conflict` from `acknowledge` means the adjustment has ended and a withdrawal instruction is on its way. A failure report is shown to staff on the distribution record, and you can still acknowledge later once the cause is fixed (for example, after an amount is recorded).

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
| `integration:manage` | Acknowledge, report failure on, and confirm withdrawal of adjustment distributions |

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
5. Re-apply each student's adjustments in every active course (desired state, as above), so assessments created since are covered. Then, for any distribution that is still `pending` or `withdrawal-requested` in `GET /api/v1/adjustments/{adjustmentId}/distributions`, apply or remove it and reply.
