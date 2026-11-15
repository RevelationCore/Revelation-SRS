# Wellbeing Integration — First-Party Module Pattern

> Pattern: REST API (bidirectional, first-party) + Events (inbound)
> Audience: Wellbeing and Mental Health service platform teams
> Classification: First-party module (elevated internal permissions)
> Permission required: `wellbeing-advisor` + `registry:read`

---

## Overview

The Wellbeing module is a first-party platform extension. It sits within the same Keycloak realm as the SRS and holds a `wellbeing-advisor` service account, granting access to sensitive and special-category student data that external integrations cannot see.

The Wellbeing module's responsibilities in relation to the SRS are:

1. **Receive context events**: consume SRS events to maintain a current picture of student enrolment, status, and assessment outcomes.
2. **Post adjustments**: when a DSA or wellbeing panel approves an assessment adjustment, push it to the SRS so it can be applied to marks automatically.
3. **Post exceptional circumstances**: when a student's EC claim is assessed, post the outcome to the SRS so exam boards can consider it.
4. **Receive adjustment distributions**: when the SRS distributes an adjustment to a target system (e.g. the exam venue), acknowledge receipt.
5. **Post misconduct outcomes**: when a misconduct panel records an outcome, push it to the SRS.

---

## Keycloak Client Configuration

The Wellbeing service account requires these realm roles:

- `wellbeing-advisor` — grants read access to disability declarations, adjustments, EC records
- `registry:read` — grants read access to student identity, enrolment, and module data

Request these roles from the institution's Identity and Access Management team. Do not request `registry:write` — the Wellbeing module only writes through dedicated wellbeing endpoints.

---

## Events the Wellbeing Module Subscribes To

```
Consumer group: wellbeing.{institution-code}.main
Subjects:
  srs.student.enrolled
  srs.student.status-changed
  srs.student.disability-declaration-updated
  srs.enrolment.module-registered
  srs.enrolment.module-registration-withdrawn
  srs.assessment.mark-received
  srs.assessment.module-result-ratified
  srs.adjustment.approved
  srs.adjustment.distributed
  srs.adjustment.expired
  srs.circumstances.exceptional-circumstances-flagged
  srs.circumstances.exceptional-circumstances-updated
  srs.regulatory.ukvi-visa-status-updated
  srs.regulatory.ukvi-compliance-alert-raised
```

### Disability declaration update (special-category)

**`srs.student.disability-declaration-updated`** — update the student's wellbeing profile:

```json
{
  "subject": "srs.student.disability-declaration-updated",
  "payload": {
    "studentId": "stu-001",
    "declarationId": "decl-abc",
    "disabilityTypeCode": "specific-learning-difficulty",
    "evidenceStatus": "verified",
    "supportPlanRequired": true,
    "updatedAt": "2026-10-01T11:00:00Z"
  }
}
```

This event is classified **special-category** (Article 9 GDPR). The Wellbeing module must enforce appropriate access controls and not share the data outside the module without explicit consent.

### Module registration — context for adjustment scope

**`srs.enrolment.module-registered`** — update the student's active module list so adjustments can be scoped correctly:

```json
{
  "payload": {
    "moduleRegistrationId": "mreg-xyz789",
    "studentId": "stu-001",
    "moduleCode": "CS3010",
    "academicYear": "2026/27"
  }
}
```

Track `moduleRegistrationId` for each active module — you will need it when posting adjustments.

### Adjustment events (feedback loop)

After you post an adjustment (see below), the SRS publishes lifecycle events:

- `srs.adjustment.approved` — adjustment has been approved by the SRS workflow
- `srs.adjustment.distributed` — adjustment has been distributed to target systems (venue, VLE)
- `srs.adjustment.expired` — adjustment period has ended

Subscribe to `srs.adjustment.distributed` to track which systems have acknowledged the adjustment.

### UKVI compliance alerts

**`srs.regulatory.ukvi-compliance-alert-raised`** — a student's visa status has raised a compliance concern:

```json
{
  "payload": {
    "studentId": "stu-001",
    "casReference": "E4Y59X77P00049321",
    "alertType": "visa-expiring-soon",
    "visaExpiryDate": "2027-01-15",
    "daysUntilExpiry": 45,
    "raisedAt": "2026-12-01T09:00:00Z"
  }
}
```

Use this to trigger an immigration advice appointment workflow.

---

## Posting Adjustments

When a wellbeing panel approves an adjustment case, record the approved outcome in the SRS. The caller needs the `adjustment:write` permission.

```http
POST /api/v1/students/{personId}/adjustments
Authorization: Bearer <wellbeing-token>
X-Idempotency-Key: adj-handoff-{caseId}
Content-Type: application/json

{
  "enrolmentId": "6f1c2b9e-4d3a-4e8b-9c1f-2a7d5e8b3c41",
  "adjustmentTypeCode": "extra-time",
  "scopeCode": "exam",
  "validFrom": "2026-09-01T00:00:00.000Z",
  "validTo": "2027-07-31T00:00:00.000Z",
  "notes": "25% additional time on timed written examinations",
  "sourceCaseId": "0b8e4f2a-7c19-4d6e-a3b5-91f04c2d7e68"
}
```

| Field | Required | Meaning |
|---|---|---|
| `enrolmentId` | Yes | The enrolment the adjustment applies to. It must belong to `personId`, or the SRS returns `404`. |
| `adjustmentTypeCode` | Yes | A code from the tenant's `adjustment-type-code` value set. |
| `scopeCode` | Yes | A code from the `adjustment-scope-code` value set. It decides which target systems receive the adjustment (see below). |
| `validFrom` | Yes | ISO 8601 date-time when the adjustment starts. |
| `validTo` | No | ISO 8601 date-time when it ends; must be after `validFrom`. Omit it for an open-ended adjustment. |
| `notes` | No | Free text recorded on the SRS adjustment. It is not included in domain events, but anyone who can read the adjustment can read it, so keep it to the operational instruction and never put evidence or diagnosis here. |
| `sourceCaseId` | No | The wellbeing module's adjustment-case ID, kept as an opaque reference back to the originating case. |

The seeded `adjustment-type-code` values are `extra-time`, `separate-room`, `deadline-extension`, `reader`, `scribe` and `rest-breaks`; a tenant may configure others. The SRS has no structured field for the amount of an adjustment, such as the extra-time percentage. State it in `notes`, or attach an outcome document with `POST /api/v1/students/{personId}/adjustments/{adjustmentId}/outcome-document`.

The `scopeCode` value decides which target systems get a distribution record:

| `scopeCode` | Target systems |
|---|---|
| `exam` | `exams` |
| `coursework` | `vle` |
| `attendance` | `attendance` |
| `all` | `vle`, `attendance` and `exams` |

Responses:

| Status | Meaning |
|---|---|
| `201` | Recorded. Body: `{ "adjustmentId": "<uuid>" }`. The SRS creates one `pending` distribution per target system and publishes `srs.adjustment.approved`. |
| `200` | A retry of a request already recorded with this idempotency key and the same body. Body: the original `{ "adjustmentId" }`; nothing new is recorded or published. |
| `404` | The person or enrolment was not found, or the enrolment belongs to someone else. |
| `409` | The idempotency key was already used for a different body. |
| `422` | A code is not active in its value set, or `validTo` is not after `validFrom`. |

The SRS honours `X-Idempotency-Key` (or `Idempotency-Key`) on this route, so a handoff whose response was lost can be retried safely. Use one stable key per approved case, as the wellbeing module does with `adj-handoff-{caseId}`.

### Tracking distribution

The wellbeing module does not acknowledge distributions. Each target system's connector applies the adjustment and acknowledges its own distribution record, using the `integration:manage` permission and a body of `{ "targetSystem": "<vle|attendance|exams>" }`. A repeated acknowledgement is accepted without effect; acknowledging a distribution that was superseded by an expiry returns `409`.

To see how far an adjustment has reached, read its distribution records:

```http
GET /api/v1/adjustments/{adjustmentId}/distributions
Authorization: Bearer <wellbeing-token>
```

Each record has a `targetSystem` and a `statusCode` of `pending`, `distributed`, `failed` or `superseded`. `srs.adjustment.distributed` is published when a target acknowledges, and `srs.adjustment.expired` when the adjustment is expired; an expired adjustment stays on the student's record with its end date.

---

## Posting Exceptional Circumstances

When a student submits an EC claim and the wellbeing team makes an initial assessment:

```http
POST /api/v1/students/{studentId}/exceptional-circumstances
Authorization: Bearer <wellbeing-token>
Idempotency-Key: ec-{studentId}-{claimRef}
Content-Type: application/json

{
  "claimRef": "EC-2026-9834",
  "circumstanceTypeCode": "bereavement",
  "affectedPeriodFrom": "2026-10-20",
  "affectedPeriodTo": "2026-11-10",
  "affectedModuleCodes": ["CS3010"],
  "evidenceStatus": "submitted",
  "severityCode": "moderate",
  "selfReported": false,
  "submittedAt": "2026-11-01T09:00:00Z"
}
```

The SRS records the EC record and makes it available to the exam board when reviewing the affected module results. The SRS publishes `srs.circumstances.exceptional-circumstances-flagged`.

If the assessment changes after initial submission:

```http
PATCH /api/v1/exceptional-circumstances/{ecId}

{
  "evidenceStatus": "verified",
  "severityCode": "significant",
  "updatedAt": "2026-11-15T14:00:00Z"
}
```

The SRS publishes `srs.circumstances.exceptional-circumstances-updated`.

---

## Posting Misconduct Outcomes

After a misconduct panel records a finding:

```http
POST /api/v1/students/{studentId}/misconduct-outcomes
Authorization: Bearer <wellbeing-token>
Idempotency-Key: misconduct-{studentId}-{panelRef}
Content-Type: application/json

{
  "panelRef": "MISC-2026-112",
  "outcomeTypeCode": "mark-penalty",
  "affectedModuleCode": "CS3010",
  "penaltyDescription": "Mark capped at 40 for CS3010 attempt 1",
  "outcomeDate": "2026-12-05",
  "appealDeadline": "2026-12-19",
  "recordedBy": "wellbeing-misconduct-panel"
}
```

The SRS records the outcome and applies the penalty at the mark calculation stage. The SRS publishes `srs.circumstances.misconduct-outcome-recorded`.

---

## Reading Student Context

The Wellbeing module can read student and enrolment data to provide context to advisors:

```http
GET /api/v1/students/{studentId}
Authorization: Bearer <wellbeing-token>
```

```http
GET /api/v1/students/{studentId}/disability-declarations
Authorization: Bearer <wellbeing-token>
```

```http
GET /api/v1/students/{studentId}/adjustments
Authorization: Bearer <wellbeing-token>
```

```http
GET /api/v1/students/{studentId}/exceptional-circumstances
Authorization: Bearer <wellbeing-token>
```

These endpoints return sensitive data. Ensure your UI enforces role-based access and logs all reads through your own audit mechanism.

---

## Plugin Registration

The Wellbeing module is a first-party module; register it with `endpointSafetyClass: simulator`:

```http
POST /api/v1/integration-registrations
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "contractId": "exam-scheduling.v1",
  "displayName": "Wellbeing Module — Internal",
  "transportCode": "nats-push",
  "endpointSafetyClass": "simulator",
  "liveTrafficApproved": false,
  "replaySupported": true
}
```

For the adjustment distribution acknowledgement flow, no additional registration is needed — it is a write to an existing REST endpoint, not an outbound push.

---

## Error Handling

| Scenario | Action |
|----------|--------|
| 422 on adjustment POST | Check `adjustmentTypeCode` is in value set; check `effectiveFrom` is not in the past by more than one academic year |
| 404 on student ID | Student may not yet be enrolled; wait for `srs.student.enrolled` event before posting adjustments |
| 422 on EC POST | Check `circumstanceTypeCode` is valid; check `affectedPeriodFrom` is within the current academic year |
| `srs.adjustment.expired` received | Remove the adjustment from your active-adjustments list; do not attempt to re-acknowledge |

---

## Data Retention and GDPR

Adjustments, EC records, disability declarations, and misconduct outcomes are special-category or sensitive personal data. The Wellbeing module must:

- not store this data outside the module without a lawful basis
- honour SRS soft-delete operations (a `delete` audit record does not mean physical deletion — it means the record is retired)
- support subject access requests (SAR) by providing all locally held wellbeing data
- retain records for the duration mandated by the institution's records retention schedule (typically 6 years post-graduation)
