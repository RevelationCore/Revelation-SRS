# HESA Student Return

> Contract ID: `hesa-student-return.v1`
> Flows: F047 (return generation and submission), F048 (validation report and HESA IDs)
> Direction: Bidirectional
> Pattern: REST API (JSON management) + XML file download
> Data classification: regulatory
> Statutory body: HESA (Higher Education Statistics Agency)

---

## Overview

The HESA Student Record return is the primary statutory data submission to HESA. Revelation SRS supports the full lifecycle:

1. **Generate** — create a student return record from current enrolment data
2. **Validate** — run internal pre-submission validation
3. **Download XML** — retrieve the submission-ready XML file
4. **Receive validation report** — ingest HESA's validation feedback after submission
5. **Mark submitted** — record the HESA submission reference
6. **Generate amendment** — create a corrected return if needed

The return is versioned per academic year. Breaking amendments create a new `returnId` linked to the original via `amendmentOfId`.

---

## Return Lifecycle

```
generate → validate → download XML → submit to HESA portal
                                          ↓
                              receive validation report (POST /validation-reports)
                                          ↓
                              mark submitted (POST /submit)
                                          ↓
                              [if errors: generate amendment → repeat]
```

---

## Endpoints

### 1. Generate student return

`POST /api/v1/regulatory/hesa/returns`

**Permission:** `regulatory:write`

**Body:**
```json
{ "academicYear": "2024/25" }
```

**Response:**
```json
{ "returnId": "uuid" }
```

Generates a new HESA student return record populated from all enrolments in the given academic year. Records are derived from current valid-time data. The return starts in `draft` status.

---

### 2. List returns

`GET /api/v1/regulatory/hesa/returns?academicYear=2024/25`

**Permission:** `regulatory:read`

Returns all returns for the tenant, optionally filtered by academic year.

---

### 3. Get return

`GET /api/v1/regulatory/hesa/returns/{returnId}`

**Permission:** `regulatory:read`

**Response:**
```json
{
  "returnId": "uuid",
  "academicYear": "2024/25",
  "statusCode": "draft",
  "submittedAt": null,
  "validatedAt": null,
  "submissionReference": null,
  "amendmentOfId": null,
  "generatedBy": "user-uuid",
  "generatedAt": "2025-02-01T09:00:00Z",
  "recordCount": 4821,
  "validationSummary": {
    "blockingErrorCount": 0,
    "warningCount": 14
  }
}
```

**Return status codes:**

| Code | Meaning |
|---|---|
| `draft` | Generated; not yet validated |
| `validated` | Internal validation passed |
| `submitted` | Transmitted to HESA |
| `accepted` | Accepted by HESA |
| `rejected` | HESA returned errors; requires amendment |
| `amended` | Superseded by an amendment return |

---

### 4. Validate return

`POST /api/v1/regulatory/hesa/returns/{returnId}/validate`

**Permission:** `regulatory:write`

Runs internal pre-submission validation rules against the return data. Returns a structured error/warning list. This is a local validation only — it does not submit to HESA.

**Response:**
```json
{
  "isValid": true,
  "errors": [],
  "warnings": [
    { "field": "OWNSTU", "enrolmentId": null, "message": "12 records have no OWNSTU set" }
  ]
}
```

---

### 5. Download XML submission file

`GET /api/v1/regulatory/hesa/returns/{returnId}/file`

**Permission:** `regulatory:read`

**Response:**
- `Content-Type: application/xml`
- Body: HESA C16032 Student XML

This endpoint returns the submission-ready XML file. The institution uploads this file to the HESA Data Collection portal (or transmits it via HESA's API channel if available).

**XML structure:**

The XML conforms to the HESA C16032 Student Record schema for the relevant coding-manual year. The root element is `<STUDENTRECORD>` containing:

| Element | Description |
|---|---|
| `<INSTITUTION>` | Institution UKPRN and coding-year metadata |
| `<STUDENT>` | One element per student |
| `<INSTANCE>` | One per enrolment (within `<STUDENT>`) |
| `<ENTRY>` | Entry qualification data |
| `<MODULE>` | Module registrations (within `<INSTANCE>`) |
| `<STUDENTCOURSESESSION>` | Annual session data |
| `<AWARD>` | Award data where applicable |
| `<LEAVER>` | Leaver data where applicable |

Field-to-database mapping follows the HESA coding frame for the academic year. Consult the HESA Data Futures specification for field codes, allowed values, and derivation rules.

---

### 6. Receive HESA validation report

`POST /api/v1/regulatory/hesa/returns/{returnId}/validation-reports`

**Permission:** `regulatory:write`

Ingests the validation report returned by HESA after submission via the HESA Data Collection portal. If the report contains HESA-assigned student identifiers (HUSIDs), they are stored against the enrolment records.

**Payload schema:** `schemas/file-contracts/hesa/validation-report-inbound.v1.json`

**Body:**
```json
{
  "reportPayload": {
    "submissionReference": "HESA-2025-12345",
    "validatedAt": "2025-02-15T14:30:00Z",
    "errors": [
      {
        "field": "FEEELIG",
        "enrolmentId": "uuid",
        "message": "Fee eligibility code missing for UK-domiciled student",
        "ruleCode": "FE001",
        "severity": "error"
      }
    ],
    "warnings": [],
    "studentIdentifiers": [
      { "enrolmentId": "uuid", "husid": "1234567890123", "ownRef": "ST12345" }
    ]
  }
}
```

**Response:**
```json
{
  "reportId": "uuid",
  "assignmentsProcessed": 4821,
  "blockingErrorCount": 1,
  "warningCount": 0
}
```

Domain event published: `srs.regulatory.hesa-return-submitted` (once `markSubmitted` is called).
HUSID assignment events: `srs.regulatory.hesa-id-assigned` per student identifier processed.

---

### 7. Mark submitted

`POST /api/v1/regulatory/hesa/returns/{returnId}/submit`

**Permission:** `regulatory:write`

Records the HESA submission reference and transitions the return to `submitted` status. Call this after successfully uploading the XML to the HESA portal.

**Body:**
```json
{ "submissionReference": "HESA-2025-12345" }
```

---

### 8. Generate amendment

`POST /api/v1/regulatory/hesa/returns/{returnId}/amendments`

**Permission:** `regulatory:write`

Creates a corrected return derived from the original. The amendment inherits all records from the original return and re-derives them from current data. The new return's `amendmentOfId` is set to the original `returnId`. The original return transitions to `amended` status.

**Response:**
```json
{ "returnId": "new-amendment-uuid" }
```

---

## Retry and Reconciliation

| Scenario | Recovery path |
|---|---|
| XML upload to HESA portal fails | Re-download the file (`GET /file`) and retry. The file content is stable for the same `returnId`. |
| HESA returns blocking errors | Call `POST /amendments` to generate a corrected return. Address the errors in SRS data, then repeat the lifecycle. |
| Validation report import fails | Re-POST the report; the operation is idempotent by `returnId` + `submissionReference`. |
| HUSID assignment not stored | Re-POST the validation report containing `studentIdentifiers`. |

---

## Audit and Events

| Action | Audit entity | Domain event |
|---|---|---|
| Generate return | `hesa_student_return.create` | `srs.regulatory.hesa-return-generated` |
| Validate return | `hesa_student_return.update` | — |
| Receive validation report | `hesa_validation_report.create` | — |
| Mark submitted | `hesa_student_return.update` | `srs.regulatory.hesa-return-submitted` |
| Generate amendment | `hesa_student_return.create` | `srs.regulatory.hesa-return-generated` |
| HUSID processed | (within validation report) | `srs.regulatory.hesa-id-assigned` (per student) |
