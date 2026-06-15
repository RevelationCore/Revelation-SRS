# UKVI Sponsor Compliance

> Contract ID: `ukvi-sponsor-compliance.v1`
> Flows: F051 (CAS management), F052 (attendance compliance and visa status)
> Direction: Bidirectional
> Pattern: REST API (JSON)
> Data classification: regulatory (personal and special-category where accommodations are included)
> Statutory body: UK Visas and Immigration (UKVI)

---

## Overview

As a licensed Student Route sponsor, the institution has statutory obligations to UKVI:

1. **Issue CAS references** — assign a Confirmation of Acceptance for Studies reference to each eligible international student before their visa application
2. **Report attendance** — submit periodic attendance monitoring reports for sponsored students
3. **Record visa decisions** — store UKVI visa grant/refusal/curtailment outcomes
4. **Raise compliance alerts** — identify students who breach the attendance reporting threshold

Revelation SRS manages the full sponsor-compliance workflow via the UKVI exchange endpoints.

---

## CAS Management

### 1. Generate CAS request batch

`POST /api/v1/regulatory/ukvi/cas-requests/generate`

**Permission:** `regulatory:write`

Generates a batch of pending CAS requests for all sponsored students who require a CAS reference but do not yet have one assigned. Returns the payload for transmission to UKVI's Sponsorship Management System (SMS).

**Payload schema:** `schemas/file-contracts/ukvi/cas-request-outbound.v1.json`

**Response:**
```json
{
  "processedCount": 8,
  "casRequests": [
    {
      "casRequestId": "uuid",
      "enrolmentId": "uuid",
      "personData": {
        "personId": "uuid",
        "legalFirstName": "Mei",
        "legalFamilyName": "Zhang",
        "dateOfBirth": "2001-04-15",
        "nationalityCode": "CN",
        "programmeId": "uuid",
        "programmeCode": "BSC-COMP",
        "programmeTitle": "BSc Computer Science",
        "modeOfStudyCode": "FT",
        "academicYearOfEntry": "2025/26",
        "startDate": "2025-09-15",
        "expectedEndDate": "2028-06-30"
      }
    }
  ]
}
```

**Key requirements:**
- `legalFirstName` and `legalFamilyName` must match the student's travel document exactly
- `dateOfBirth` must match the passport
- `nationalityCode` must be a valid ISO 3166-1 alpha-2 code
- `startDate` must be the actual programme start date, not the CAS issue date

---

### 2. List CAS requests

`GET /api/v1/regulatory/ukvi/cas-requests?statusCode=pending`

**Permission:** `regulatory:read`

Returns all CAS requests, optionally filtered by status.

**Status codes:**

| Code | Meaning |
|---|---|
| `pending` | Request generated, awaiting UKVI CAS assignment |
| `assigned` | CAS reference received from UKVI |
| `expired` | CAS expired without use |

---

### 3. Record CAS assignment

`POST /api/v1/regulatory/ukvi/cas-requests/{casRequestId}/assignment`

**Permission:** `regulatory:write`

Records the CAS reference assigned by UKVI in the SMS, linking it to the pending CAS request. Transitions the request to `assigned` status and publishes `srs.regulatory.ukvi-cas-assigned`.

**Body:**
```json
{ "casReference": "A12345678910" }
```

**Response:** Updated CAS request record including the assigned reference.

**Idempotency:** The `casRequestId` is the idempotency key. Re-POSTing with the same reference is a no-op.

---

## Attendance Monitoring

### 4. Generate attendance report

`POST /api/v1/regulatory/ukvi/attendance-reports/generate`

**Permission:** `regulatory:write`

Generates an attendance monitoring report for all sponsored students in a given academic period. The report identifies students who have breached the unauthorised absence threshold (default: 10 absences in any 8-week window).

**Body:**
```json
{ "academicPeriodId": "uuid" }
```

**Payload schema:** `schemas/file-contracts/ukvi/attendance-report-outbound.v1.json`

**Response:**
```json
{
  "reportId": "uuid",
  "payload": {
    "academicPeriodId": "uuid",
    "generatedAt": "2025-11-01T09:00:00Z",
    "studentCount": 243,
    "threshold": { "unauthorisedAbsencesPerEightWeeks": 10 },
    "_attendance_data_completeness": "provided",
    "students": [
      {
        "enrolmentId": "uuid",
        "personId": "uuid",
        "casReference": "A12345678910",
        "programmeCode": "BSC-COMP",
        "enrolmentStatusCode": "enrolled",
        "legalFirstName": "Mei",
        "legalFamilyName": "Zhang",
        "absenceCount": 12,
        "thresholdBreached": true,
        "attendanceDataCompleteness": "provided"
      }
    ]
  }
}
```

**Data completeness warning:**

If the AM (Attendance Monitoring) integration is not yet live, `_attendance_data_completeness` will be `"pending-attendance-integration"` and absence counts will be zero. Reports in this state **must not be transmitted to UKVI** without manual review and supplementary data. The institution remains responsible for meeting its UKVI reporting obligations.

**Threshold:**

The UKVI reporting threshold is 10 unauthorised absences in any 8-week rolling window. `thresholdBreached: true` indicates UKVI notification may be required. The institution's compliance team should review all breaching students and determine whether a formal UKVI sponsor report is required.

---

### 5. Evaluate compliance alerts

`POST /api/v1/regulatory/ukvi/compliance-alerts/evaluate`

**Permission:** `regulatory:write`

Evaluates all sponsored students against the attendance threshold and raises compliance alerts for students who breach it. Returns the number of new alerts raised. This is a lightweight operation that can be run on a schedule (e.g. weekly).

**Response:**
```json
{ "alertsRaised": 3 }
```

---

### 6. List compliance alerts

`GET /api/v1/regulatory/ukvi/compliance-alerts?unresolvedOnly=true`

**Permission:** `regulatory:read`

Returns all UKVI compliance alerts for the tenant. Filter by `unresolvedOnly=true` to see only open alerts.

---

### 7. Resolve compliance alert

`POST /api/v1/regulatory/ukvi/compliance-alerts/{alertId}/resolve`

**Permission:** `regulatory:write`

Marks an alert as resolved. Use once the compliance team has reviewed the case and either submitted a UKVI sponsor report or determined no action is required.

---

## Visa Status Updates (Inbound)

### 8. Record visa status update

`POST /api/v1/regulatory/ukvi/visa-updates`

**Permission:** `regulatory:write`

Records a UKVI visa decision received from the SMS or electronic notification channel.

**Payload schema:** `schemas/file-contracts/ukvi/visa-update-inbound.v1.json`

**Body:**
```json
{
  "casReference": "A12345678910",
  "statusCode": "granted",
  "effectiveDate": "2025-08-15",
  "idempotencyKey": "UKVI-NOTIF-2025-98765",
  "rawPayload": { "...": "original UKVI notification" }
}
```

**Status codes:**

| Code | Meaning |
|---|---|
| `granted` | Student visa granted |
| `refused` | Visa application refused |
| `curtailed` | Leave to remain curtailed |
| `expired` | Visa expired |
| `cancelled` | Visa cancelled |

**Response:**
```json
{
  "visaStatusId": "uuid",
  "alertId": "uuid | null"
}
```

If `statusCode` is `refused`, `curtailed`, or `cancelled`, a UKVI compliance alert is automatically raised and returned in `alertId`.

**Idempotency:** Submit the UKVI notification reference as `idempotencyKey`. Duplicate submissions with the same key are rejected with `422`.

---

## Compliance Obligations Summary

| Obligation | SRS endpoint | Frequency |
|---|---|---|
| Issue CAS before visa application | `generate` + `assignment` | As required per student |
| Monitor attendance | `attendance-reports/generate` + `compliance-alerts/evaluate` | Minimum: every 8 weeks per academic term |
| Report non-attendance to UKVI | Review alert → manual SMS report | Per breach detected |
| Record visa decisions | `visa-updates` | Per UKVI notification |

---

## Audit and Events

| Action | Audit entity | Domain event |
|---|---|---|
| Generate CAS requests | `ukvi_cas_request.create` | — |
| Record CAS assignment | `ukvi_cas_request.update` | `srs.regulatory.ukvi-cas-requested` + `srs.regulatory.ukvi-cas-assigned` |
| Generate attendance report | `ukvi_attendance_report.create` | `srs.regulatory.ukvi-attendance-submitted` |
| Evaluate compliance alerts | `ukvi_compliance_alert.create` | `srs.regulatory.ukvi-compliance-alert-raised` |
| Record visa status | `ukvi_visa_status.create` | `srs.regulatory.ukvi-visa-status-updated` |
