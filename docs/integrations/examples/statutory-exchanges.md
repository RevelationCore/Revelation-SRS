# Statutory Exchanges — UCAS, HESA, SLC, UKVI

> Pattern: File exchange (REST API + JSON/XML)
> Audience: Institutional IT teams managing regulatory reporting; statutory adapters
> Permission required: `regulatory:write`, `regulatory:read`

---

## Overview

Revelation SRS manages four statutory exchange families on behalf of UK Higher Education institutions:

| Body | Exchange | Direction | Format |
|------|----------|-----------|--------|
| UCAS | Admissions application ingestion and confirmation | Bidirectional | JSON |
| HESA | Student return (C16032) generation and validation | Bidirectional | XML (out) / JSON (in) |
| SLC | Enrolment confirmation and payment notification | Bidirectional | JSON |
| UKVI | CAS application, attendance reporting, visa update | Bidirectional | JSON |

Each exchange is an idempotent REST operation — re-submitting with the same idempotency key is safe. Full JSON schemas are in `schemas/file-contracts/`; spec documents are in `docs/integrations/file-contracts/`.

---

## UCAS Admissions Exchange

### Application ingestion (inbound)

UCAS pushes application data to the SRS. Your UCAS adapter calls:

```http
POST /api/v1/regulatory/ucas/applications
Authorization: Bearer <token>
Idempotency-Key: ucas-{ucasPersonalId}-{cycle}
Content-Type: application/json

{
  "ucasPersonalId": "12345678",
  "cycle": "2026",
  "surname": "Smith",
  "forenames": "Jane",
  "dateOfBirth": "2005-03-14",
  "nationality": "GBR",
  "choices": [
    {
      "courseCode": "CS",
      "campusCode": "M",
      "entryYear": "2026",
      "status": "firm-acceptance"
    }
  ],
  "appliedAt": "2025-11-15T09:00:00Z"
}
```

Validate against `schemas/file-contracts/ucas/application-inbound.v1.json` before submission.

The SRS publishes `srs.regulatory.ucas-application-received` on successful ingestion.

### Confirmation batch (outbound)

When UCAS requests a confirmation update (or on a configured schedule), generate the confirmation batch:

```http
POST /api/v1/regulatory/ucas/confirmations/generate
Authorization: Bearer <token>
Idempotency-Key: ucas-conf-{cycle}-{batchDate}
Content-Type: application/json

{
  "cycle": "2026",
  "batchDate": "2026-08-22"
}
```

The SRS processes all pending triggers and returns a batch of confirmations:

```json
{
  "batchId": "ucas-batch-001",
  "cycle": "2026",
  "confirmations": [
    {
      "ucasPersonalId": "12345678",
      "courseCode": "CS",
      "confirmationType": "unconditional-firm",
      "confirmedAt": "2026-08-22T14:00:00Z"
    }
  ],
  "totalCount": 1
}
```

Validate the response against `schemas/file-contracts/ucas/confirmation-outbound.v1.json` before transmitting to UCAS.

The SRS publishes `srs.regulatory.ucas-confirmation-sent` after generation.

For detailed field mappings, see [`file-contracts/ucas-admissions-exchange.md`](../file-contracts/ucas-admissions-exchange.md).

---

## HESA Student Return (C16032)

### Step 1 — Initiate a return

```http
POST /api/v1/regulatory/hesa/returns
Authorization: Bearer <token>
Content-Type: application/json

{
  "academicYear": "2025/26",
  "returnType": "student",
  "codingManualYear": "2025"
}
```

The SRS creates the return record and publishes `srs.regulatory.hesa-return-generated`. The response includes `returnId`.

### Step 2 — Download the XML file

```http
GET /api/v1/regulatory/hesa/returns/{returnId}/file
Authorization: Bearer <token>
Accept: application/xml
```

The response is a HESA C16032 Student Record XML file conforming to the coding manual for the specified year. This file is transmitted to HESA Data Futures.

> The XML structure is governed by the HESA C16032 coding frame. Field mappings are year-specific. Consult [`file-contracts/hesa-student-return.md`](../file-contracts/hesa-student-return.md) for the mapping from SRS domain model to HESA fields.

### Step 3 — Ingest the HESA validation report

After HESA validates the submission, ingest the validation response:

```http
POST /api/v1/regulatory/hesa/returns/{returnId}/validation-reports
Authorization: Bearer <token>
Idempotency-Key: hesa-report-{returnId}-{reportRef}
Content-Type: application/json

{
  "hesaReturnReference": "HESA-2025-123456",
  "validationStatus": "errors-found",
  "reportPayload": {
    "errorCount": 3,
    "warningCount": 12,
    "errors": [
      {
        "fieldRef": "ENROLMENT.MODE",
        "errorCode": "R02.46",
        "message": "Invalid mode of study for this programme type"
      }
    ]
  },
  "reportDate": "2026-02-15"
}
```

Validate against `schemas/file-contracts/hesa/validation-report.v1.json`. The SRS records the report, publishes `srs.regulatory.hesa-return-submitted`, and makes the errors available for correction.

### Step 4 — Generate an amendment

After fixing validation errors, request an amendment return:

```http
POST /api/v1/regulatory/hesa/returns/{returnId}/amendments
Authorization: Bearer <token>
Content-Type: application/json

{ "reason": "Corrected MODE codes for 12 interrupted students" }
```

This creates a new return linked to the original, with only changed records included.

For HESA ID assignment events, subscribe to `srs.regulatory.hesa-id-assigned`.

---

## SLC Enrolment Exchange

Student Loans Company requires confirmation of enrolment at registration and on any status change.

### Step 1 — Generate enrolment confirmations

Trigger confirmation generation (typically after a census date):

```http
POST /api/v1/regulatory/slc/confirmations/generate
Authorization: Bearer <token>
Idempotency-Key: slc-conf-{academicYear}-{term}-{runDate}
Content-Type: application/json

{
  "academicYear": "2026/27",
  "term": "1",
  "runDate": "2026-11-01"
}
```

The SRS collates all students with pending SLC triggers, generates confirmations, and returns:

```json
{
  "exchangeId": "slc-exch-001",
  "academicYear": "2026/27",
  "term": "1",
  "confirmations": [
    {
      "studentId": "stu-001",
      "slcReference": "SLC-REF-123",
      "confirmationType": "full",
      "courseStartDate": "2026-09-22",
      "expectedEndDate": "2029-06-30",
      "yearOfStudy": 1,
      "modeOfStudy": "full-time"
    }
  ],
  "totalCount": 1
}
```

Validate against `schemas/file-contracts/slc/confirmation-outbound.v1.json` before transmitting to SLC.

The SRS publishes `srs.regulatory.slc-confirmation-sent`.

`confirmationType` values: `full` (enrolment continues as expected), `change` (study mode or end date changed), `withdrawal` (student has withdrawn).

### Step 2 — Record SLC payment notifications

When SLC disburses maintenance loans:

```http
POST /api/v1/regulatory/slc/notifications
Authorization: Bearer <token>
Idempotency-Key: slc-notif-{slcPaymentReference}
Content-Type: application/json

{
  "studentId": "stu-001",
  "slcReference": "SLC-REF-123",
  "notificationType": "payment-made",
  "amountMinorUnits": 328333,
  "currencyCode": "GBP",
  "paymentPeriod": "2026/27-T1"
}
```

Validate against `schemas/file-contracts/slc/notification-inbound.v1.json`.

`notificationType` values: `payment-made`, `overpayment-recovery`, `hold-applied`, `hold-released`. Negative `amountMinorUnits` are valid for overpayment recovery.

For full field reference, see [`file-contracts/slc-enrolment-exchange.md`](../file-contracts/slc-enrolment-exchange.md).

---

## UKVI Sponsor Compliance

As a licensed Tier 4 / Student Route sponsor, the institution must report attendance and visa status changes to UKVI.

### CAS application

When admitting an international student who needs a CAS number:

```http
POST /api/v1/regulatory/ukvi/cas-requests
Authorization: Bearer <token>
Idempotency-Key: ukvi-cas-{studentId}-{academicYear}
Content-Type: application/json

{
  "studentId": "stu-001",
  "academicYear": "2026/27",
  "courseCode": "CS",
  "courseLevel": "RQF7",
  "courseStartDate": "2026-09-22",
  "courseEndDate": "2027-09-30",
  "maintenanceAmount": 150000,
  "maintenanceCurrencyCode": "GBP",
  "passportNumber": "987654321",
  "nationality": "CHN",
  "dateOfBirth": "2000-06-20"
}
```

Validate against `schemas/file-contracts/ukvi/cas-request.v1.json`.

The SRS publishes `srs.regulatory.ukvi-cas-requested`. When UKVI assigns a CAS reference, record it:

```http
PATCH /api/v1/regulatory/ukvi/cas-requests/{casRequestId}

{ "casReference": "E4Y59X77P00049321", "assignedAt": "2026-07-01T09:00:00Z" }
```

The SRS then publishes `srs.regulatory.ukvi-cas-assigned`.

### Attendance reporting

Report student attendance termly (or as required by UKVI):

```http
POST /api/v1/regulatory/ukvi/attendance-reports
Authorization: Bearer <token>
Idempotency-Key: ukvi-attend-{studentId}-{period}
Content-Type: application/json

{
  "studentId": "stu-001",
  "casReference": "E4Y59X77P00049321",
  "reportingPeriod": "2026/27-T1",
  "attendanceStatus": "attending",
  "lastContactDate": "2026-11-14",
  "attendancePercentage": 87,
  "submittedAt": "2026-11-15T09:00:00Z"
}
```

Validate against `schemas/file-contracts/ukvi/attendance-report.v1.json`.

`attendanceStatus` values: `attending`, `discontinued`, `completed`, `interrupted`, `not-yet-started`.

### Visa status updates (inbound)

When UKVI sends visa status changes to the institution:

```http
POST /api/v1/regulatory/ukvi/visa-updates
Authorization: Bearer <token>
Idempotency-Key: ukvi-visa-{casReference}-{updateRef}
Content-Type: application/json

{
  "casReference": "E4Y59X77P00049321",
  "studentId": "stu-001",
  "visaStatusCode": "expired",
  "visaExpiryDate": "2027-09-30",
  "ukviReference": "UKVI-UPDATE-456",
  "effectiveDate": "2026-11-01"
}
```

Validate against `schemas/file-contracts/ukvi/visa-update.v1.json`.

The SRS records the update, publishes `srs.regulatory.ukvi-visa-status-updated`, and where appropriate raises `srs.regulatory.ukvi-compliance-alert-raised` for the Wellbeing/Immigration Advice team.

Subscribe to `srs.regulatory.ukvi-compliance-alert-raised` to trigger case management workflows.

For full field reference, see [`file-contracts/ukvi-sponsor-compliance.md`](../file-contracts/ukvi-sponsor-compliance.md).

---

## Common Error Scenarios

| Status | Body | Meaning |
|--------|------|---------|
| 409 | `idempotency-conflict` | Same idempotency key submitted; original response returned |
| 422 | `validation-error` | Payload fails schema validation; `detail` field names the failing field |
| 404 | `not-found` | `studentId` or `enrolmentId` does not exist in this tenant |
| 403 | `forbidden` | Token lacks `regulatory:write` role |

---

## Idempotency Key Design

Choose idempotency keys that are stable for the specific submission event, not time-based:

| Exchange | Recommended key |
|----------|----------------|
| UCAS application | `ucas-{ucasPersonalId}-{cycle}` |
| UCAS confirmation batch | `ucas-conf-{cycle}-{batchDate}` |
| HESA return | `hesa-{academicYear}-{returnType}-{runDate}` |
| HESA validation report | `hesa-report-{returnId}-{hesaReference}` |
| SLC confirmation batch | `slc-conf-{academicYear}-{term}-{runDate}` |
| SLC payment notification | `slc-notif-{slcPaymentReference}` |
| UKVI CAS request | `ukvi-cas-{studentId}-{academicYear}` |
| UKVI attendance report | `ukvi-attend-{studentId}-{reportingPeriod}` |
| UKVI visa update | `ukvi-visa-{casReference}-{ukviReference}` |

---

## Regulatory Exchange Ledger

All statutory exchanges are recorded in the immutable exchange ledger. Query for audit:

```http
GET /api/v1/integration-exchanges?registrationId={registrationId}&statusCode=completed
Authorization: Bearer <admin-token>
```

The `payloadSummary` field on each exchange record contains a non-PII summary for audit purposes. Full payload detail is logged separately in the application audit trail.
