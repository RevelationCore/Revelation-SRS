# UCAS Admissions Exchange

> Contract ID: `ucas-admissions-exchange.v1`
> Flows: F045 (application ingestion), F046 (confirmation outbound)
> Direction: Bidirectional
> Pattern: REST API (JSON)
> Data classification: personal / regulatory
> Statutory body: UCAS

---

## Overview

The UCAS admissions exchange covers two directions:

1. **Inbound** — UCAS application records are ingested into SRS from a UCAS integration adapter (e.g. the UCAS web-link API or a file import). Each application record is stored and, if the applicant data matches or can be linked to an enrolment, triggers the admissions workflow.

2. **Outbound** — Once enrolment decisions are made (confirmation, withdrawal, deferral), SRS generates a confirmation batch that the UCAS adapter transmits back to UCAS to update applicant status in the UCAS system.

The exchange is versioned per UCAS application cycle (e.g. `2025`).

---

## Inbound: Application Ingestion

### Endpoint

`POST /api/v1/regulatory/ucas/applications`

### Permission

`regulatory:write`

### Payload schema

`schemas/file-contracts/ucas/application-inbound.v1.json`

### Key fields

| Field | Required | Description |
|---|---|---|
| `ucasPersonalId` | Yes | 10-digit UCAS Personal ID |
| `cycle` | Yes | UCAS cycle year, e.g. `'2025'` |
| `statusCode` | Yes | UCAS application status (see code table below) |
| `legalFirstName` | No | Applicant given name(s) |
| `legalFamilyName` | No | Applicant family name |
| `dateOfBirth` | No | ISO 8601 date (YYYY-MM-DD) |
| `emailPersonal` | No | Applicant personal email |
| `programmeId` | No | SRS programme UUID — links application to programme |
| `modeOfStudyCode` | No | `FT`, `PT`, or `DL` |
| `attendanceTypeCode` | No | `campus`, `blended`, `online` |
| `academicYearOfEntry` | No | SRS academic year format, e.g. `2025/26` |
| `startDate` | No | YYYY-MM-DD |
| `expectedEndDate` | No | YYYY-MM-DD |
| `feeBandCode` | No | `home`, `international`, `eu` |
| `fundingSourceCode` | No | `slc`, `self`, `sponsor`, `scholarship`, `other` |
| `slcReference` | No | SLC customer reference if known |
| `ukviCasRequired` | No | Whether a CAS will be needed |

The `applicant` and `enrolment` nested objects are alternative encodings for the same fields. Top-level flat fields take precedence.

### UCAS status codes

| Code | Meaning |
|---|---|
| `U` | Unconditional offer made |
| `C` | Conditional offer made |
| `A` | Offer accepted |
| `R` | Application / offer rejected |
| `W` | Applicant withdrew |

### Response

```json
{ "applicationId": "uuid", "linkedEnrolmentId": "uuid | null" }
```

`linkedEnrolmentId` is set if SRS was able to automatically link the application to an existing enrolment.

### Idempotency

Re-submitting the same `ucasPersonalId` + `cycle` updates the existing record in place. No duplicate records are created.

### Failure handling

- `422 Unprocessable Entity` — validation failure (missing required fields, invalid codes). The adapter must correct and resubmit.
- `404 Not Found` — referenced `programmeId` does not exist for this tenant.

---

## Outbound: Confirmation Batch

### Endpoint

`POST /api/v1/regulatory/ucas/confirmations/generate`

### Permission

`regulatory:write`

### Request body

```json
{ "cycle": "2025" }
```

### Response / payload schema

`schemas/file-contracts/ucas/confirmation-outbound.v1.json`

The response payload is the batch to transmit to UCAS. Shape:

```json
{
  "processedCount": 14,
  "payload": {
    "cycle": "2025",
    "confirmations": [
      {
        "triggerId": "uuid",
        "enrolmentId": "uuid",
        "ucasPersonalId": "0123456789",
        "confirmationType": "enrolled",
        "confirmedAt": "2025-09-01T09:00:00Z"
      }
    ]
  }
}
```

### Confirmation types

| Type | Meaning | UCAS notification |
|---|---|---|
| `enrolled` | Student has fully enrolled | Enrolment confirmation |
| `withdrawn` | Student withdrew, was no-show, or offer rescinded | Withdrawal or no-show |
| `deferred` | Start deferred to next cycle | Deferral |

### Idempotency

Each confirmation record carries a `triggerId` (UUID). Adapters must transmit each `triggerId` to UCAS exactly once. If UCAS accepts the notification, the adapter marks the trigger as acknowledged. If the API is called again, any already-processed triggers are excluded from the new batch.

### Transport

The outbound confirmation payload must be transmitted to UCAS via the UCAS web-link API or UCAS-mandated file channel, depending on the cycle and institutional UCAS agreement. Revelation SRS provides the payload; the adapter is responsible for the UCAS transmission protocol.

### Replay / reconciliation

To regenerate the pending confirmation batch for a cycle: call `POST /api/v1/regulatory/ucas/confirmations/generate` again with the same cycle. Only unacknowledged triggers are included.

To review all applications: `GET /api/v1/regulatory/ucas/applications?cycle=2025&statusCode=A`.

---

## Audit and Events

Every call to `POST /api/v1/regulatory/ucas/applications` generates an audit record (`ucas_application.create`).

Every call to `POST /api/v1/regulatory/ucas/confirmations/generate` generates an audit record (`integration_exchange.create`).

Domain events published:
- `srs.regulatory.ucas-application-received` — on successful application ingestion
- `srs.regulatory.ucas-confirmation-sent` — on confirmation batch generation

See `docs/integrations/event-consumer-guide.md` for event schema and consumer guidance.
