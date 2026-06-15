# Finance Integration — Fee Liability and Payment/Hold Updates

> Pattern: Events (inbound) + REST API (bidirectional)
> Audience: Finance system integrators (Agresso, Unit4, Sage, custom ledger)
> Classification: External integration (public surface) / first-party module (if same platform)

---

## Overview

The Finance integration keeps the institution's finance system in sync with the SRS on two axes:

1. **Fee liability notification**: when the SRS creates an enrolment, it generates a fee liability record and publishes an event. The finance system picks this up to raise a fee debt.
2. **Payment and hold updates**: when the finance system records a payment, waiver, or liability hold, it notifies the SRS (future Phase 8 endpoint). The SRS uses this to update enrolment status and regulatory returns (SLC, UKVI).

The SRS also generates SLC enrolment confirmations which the finance system monitors to reconcile maintenance loan disbursements.

---

## What Finance Subscribes To

```
Consumer group: finance.{institution-code}.main
Subjects:
  srs.enrolment.fee-liability-generated
  srs.student.enrolled
  srs.student.status-changed
  srs.regulatory.slc-confirmation-sent
  srs.regulatory.slc-notification-received
  srs.award.conferred
```

### Fee liability event

**`srs.enrolment.fee-liability-generated`** — raise a fee debt in the finance ledger:

```json
{
  "subject": "srs.enrolment.fee-liability-generated",
  "payload": {
    "feeLiabilityId": "fl-001",
    "enrolmentId": "enr-def456",
    "studentId": "stu-001",
    "academicYear": "2026/27",
    "feeTypeCode": "tuition-home",
    "grossAmountMinorUnits": 950000,
    "currencyCode": "GBP",
    "instalmentScheduleCode": "termly-3",
    "dueDate": "2026-09-30",
    "regulatoryFeeCategory": "standard"
  }
}
```

`grossAmountMinorUnits` is in pence (divide by 100 for display). Use `feeLiabilityId` as the external reference in your finance ledger for reconciliation.

### Student status changes affecting fee liability

**`srs.student.status-changed`** — adjust liability on interruption, suspension, or withdrawal:

```json
{
  "payload": {
    "studentId": "stu-001",
    "enrolmentId": "enr-def456",
    "previousStatus": "student",
    "newStatus": "interrupted",
    "effectiveDate": "2026-11-15",
    "reason": "personal-circumstances"
  }
}
```

Status transitions and their fee implications:

| `newStatus` | Fee action |
|------------|-----------|
| `interrupted` | Suspend further instalments; recalculate pro-rata liability |
| `suspended` | As interrupted |
| `withdrawn` | Final pro-rata calculation; close liability |
| `alumnus` | No action; liability already settled |
| `student` (re-enrolment) | Reactivate liability from effective date |

### SLC reconciliation events

**`srs.regulatory.slc-confirmation-sent`** — SRS has generated a Student Loans Company enrolment confirmation:

```json
{
  "payload": {
    "slcExchangeId": "slc-exch-001",
    "studentId": "stu-001",
    "enrolmentId": "enr-def456",
    "confirmationType": "full",
    "academicYear": "2026/27",
    "sentAt": "2026-09-15T10:00:00Z"
  }
}
```

**`srs.regulatory.slc-notification-received`** — SLC has paid or held a loan amount:

```json
{
  "payload": {
    "slcNotificationId": "slc-notif-001",
    "studentId": "stu-001",
    "enrolmentId": "enr-def456",
    "notificationType": "payment-made",
    "amountMinorUnits": 328333,
    "currencyCode": "GBP",
    "paymentPeriod": "2026/27-T1",
    "receivedAt": "2026-09-30T00:00:00Z"
  }
}
```

Use these events to reconcile maintenance loan disbursements against the institutional ledger. `notificationType` values: `payment-made`, `overpayment-recovery`, `hold-applied`, `hold-released`.

---

## Pushing Payment Notifications to the SRS

> **Note**: The direct `POST /integrations/finance/payments` endpoint is planned for Phase 8. In Phase 7, use the SLC inbound notification endpoint for SLC-related payments.

### SLC payment notification (Phase 7)

When SLC transfers maintenance loan funds, record the notification:

```http
POST /api/v1/regulatory/slc/notifications
Authorization: Bearer <token>
Idempotency-Key: slc-notif-{slcPaymentReference}
Content-Type: application/json

{
  "studentId": "stu-001",
  "enrolmentId": "enr-def456",
  "slcReference": "SLC-2026-789456",
  "notificationType": "payment-made",
  "amountMinorUnits": 328333,
  "currencyCode": "GBP",
  "paymentPeriod": "2026/27-T1"
}
```

The SRS records this in the SLC exchange ledger and publishes `srs.regulatory.slc-notification-received`.

---

## Querying Fee Liability and Enrolment Data

Fetch enrolment details for a student:

```http
GET /api/v1/students/{studentId}/enrolments?academicYear=2026/27
Authorization: Bearer <token>
```

The response includes `feeLiabilityId` and `regulatoryFeeCategory` needed to correctly categorise the liability in the finance system.

Query SLC confirmation history for audit:

```http
GET /api/v1/regulatory/slc/notifications?studentId={studentId}&academicYear=2026/27
Authorization: Bearer <token>
```

---

## Plugin Registration

```http
POST /api/v1/integration-registrations
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "contractId": "slc-enrolment-exchange.v1",
  "displayName": "Finance System — Acme University",
  "transportCode": "nats-push",
  "endpointSafetyClass": "external-test",
  "liveTrafficApproved": false,
  "replaySupported": true
}
```

---

## Error Handling

| Scenario | Action |
|----------|--------|
| Duplicate `fee-liability-generated` event | Idempotent: check `feeLiabilityId` — if already in ledger, discard |
| `status-changed` event with unknown `studentId` | Log and alert; student may have been created after your last sync |
| SLC notification 422 | Validate `slcReference` format and `enrolmentId`; check student is enrolled |
| Fee liability amount zero | Valid — bursary or scholarship covers full fee; close debt at zero |

---

## Reconciliation

Daily reconciliation pass:

1. For each active enrolment in the SRS (`GET /api/v1/enrolments?status=active&academicYear=2026/27`), verify a corresponding fee debt exists in the finance ledger.
2. For each `feeLiabilityId` in the finance ledger, query the SRS enrolment to confirm enrolment status is still active (not withdrawn or interrupted without a corresponding ledger adjustment).
3. For SLC: compare SRS SLC confirmation records (`GET /api/v1/regulatory/slc/notifications`) against your finance ledger. Any SLC payment recorded in SRS but not in the ledger indicates a missed notification event — re-process from the exchange audit log.
