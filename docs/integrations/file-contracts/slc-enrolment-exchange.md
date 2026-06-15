# SLC Enrolment Exchange

> Contract ID: `slc-enrolment-exchange.v1`
> Flows: F049 (enrolment confirmation and status notification), F050 (inbound notifications)
> Direction: Bidirectional
> Pattern: REST API (JSON)
> Data classification: regulatory
> Statutory body: Student Loans Company (SLC)

---

## Overview

The SLC exchange covers the institution's obligation to notify the Student Loans Company of enrolment events and to receive SLC payment and entitlement notifications in return.

**Outbound (SRS → SLC):**
- Batch enrolment confirmation, withdrawal, and intermission notifications
- Individual status change notifications triggered by specific enrolment events

**Inbound (SLC → SRS):**
- Loan entitlement notifications
- Payment confirmation notifications
- Status change notifications
- Overpayment notices

All SLC exchanges use the SLC Data Exchange service or equivalent SLC API channel.

---

## Outbound: Confirmation Batch

### Endpoint

`POST /api/v1/regulatory/slc/confirmations/generate`

### Permission

`regulatory:write`

### Description

Generates a batch of pending SLC enrolment confirmations for all enrolments where a downstream trigger has been raised but not yet acknowledged. Returns the full payload for transmission to SLC.

### Payload schema

`schemas/file-contracts/slc/confirmation-outbound.v1.json`

### Response

```json
{
  "processedCount": 12,
  "payload": {
    "confirmations": [
      {
        "triggerId": "uuid",
        "enrolmentId": "uuid",
        "slcReference": "SLC-REF-12345",
        "programmeId": "uuid",
        "modeOfStudyCode": "FT",
        "confirmationType": "enrolment",
        "feeAmount": "9250.00",
        "startDate": "2025-09-15",
        "expectedEndDate": "2028-06-30"
      }
    ]
  }
}
```

### Confirmation types

| Type | Meaning | SLC notification |
|---|---|---|
| `enrolment` | Student enrolled and fee liability confirmed | Enrolment confirmation |
| `withdrawal` | Student withdrew from programme | Withdrawal notification |
| `intermission` | Student intermitting (temporary leave of absence) | Intermission notification |

### Fee amount format

`feeAmount` is a decimal string in GBP with two decimal places (e.g. `"9250.00"`). Currency is always GBP; do not transmit a currency code to SLC — it is implied.

### Idempotency

Each record carries a `triggerId`. Re-calling `generate` produces a fresh batch that excludes already-acknowledged triggers. Adapters must record which `triggerId` values were successfully accepted by SLC before calling `generate` again.

---

## Outbound: Individual Status Notification

### Endpoint

`POST /api/v1/enrolments/{enrolmentId}/slc-status-notification`

### Permission

`regulatory:write`

### Description

Generates a single SLC status change notification for a specific enrolment. Used for real-time notifications triggered by individual enrolment events, as opposed to the batch `confirmations/generate` endpoint.

### Response

Returns a single `SlcConfirmationRecord` (same schema as confirmation batch items):

```json
{
  "triggerId": "uuid",
  "enrolmentId": "uuid",
  "slcReference": "SLC-REF-12345",
  "programmeId": "uuid",
  "modeOfStudyCode": "FT",
  "confirmationType": "withdrawal",
  "feeAmount": null,
  "startDate": "2025-09-15",
  "expectedEndDate": "2028-06-30"
}
```

### Review existing notifications

`GET /api/v1/enrolments/{enrolmentId}/slc-notifications` — returns all SLC notifications on record for an enrolment, both outbound triggers and inbound notifications.

---

## Inbound: SLC Notification

### Endpoint

`POST /api/v1/regulatory/slc/notifications`

### Permission

`regulatory:write`

### Description

Records an inbound SLC notification received via the SLC Data Exchange service. Covers loan entitlements, payment confirmations, status changes, and overpayment notices.

### Payload schema

`schemas/file-contracts/slc/notification-inbound.v1.json`

### Body

```json
{
  "enrolmentId": "uuid",
  "notificationTypeCode": "entitlement",
  "effectiveDate": "2025-10-01",
  "amount": "9250.00",
  "idempotencyKey": "SLC-TXN-987654",
  "rawPayload": { "...": "original SLC message preserved for audit" }
}
```

### Notification type codes

| Code | Meaning |
|---|---|
| `entitlement` | SLC has issued a tuition fee loan entitlement for this enrolment |
| `payment` | SLC has confirmed a payment to the institution |
| `status-change` | SLC reporting a change in the student's loan status |
| `overpayment` | SLC has issued an overpayment notice |

### Amount format

Decimal string or number, always GBP. For entitlement notifications, this is the approved tuition fee loan amount. For payment notifications, the amount transferred. For overpayment, the amount to be recovered.

### Idempotency

Submit the SLC transaction reference as `idempotencyKey`. Duplicate submissions with the same key are rejected with `422 Unprocessable Entity`. If `idempotencyKey` is omitted, the operation is not idempotent.

### Response

`201 Created` with the internal notification ID:
```json
{ "notificationId": "uuid" }
```

---

## Replay and Reconciliation

| Scenario | Recovery path |
|---|---|
| Batch confirmation transmission fails | Re-call `POST /regulatory/slc/confirmations/generate`. Unacknowledged triggers reappear. |
| SLC rejects a confirmation | Correct the enrolment data in SRS; re-call `generate`. The old trigger is superseded. |
| Inbound notification import fails | Re-POST with the same `idempotencyKey`; the operation is a no-op if already recorded. |
| Entitlement status unclear | `GET /enrolments/{enrolmentId}/slc-notifications` to review all recorded notifications. |

---

## Audit and Events

| Action | Audit entity | Domain event |
|---|---|---|
| Generate confirmation batch | `integration_exchange.create` | `srs.regulatory.slc-confirmation-sent` |
| Individual status notification | `integration_exchange.create` | `srs.regulatory.slc-confirmation-sent` |
| Inbound notification recorded | `slc_notification.create` | `srs.regulatory.slc-notification-received` |
