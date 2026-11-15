# Outbound delivery to adjacent systems

> Pattern: per-flow fulfilment (event, staff task, file, or none) over one delivery ledger
> Audience: institutions configuring Revelation SRS, and teams building connectors
> Code: `apps/api/src/platform/delivery/`, migration `0029_delivery_ledger`

Not every institution has every adjacent system, and not every system it has is connected. Rather than build each system or leave changes to wait silently, every outbound reference-model flow with no other route is registered, and each institution says how it is fulfilled:

| Mode | What happens |
|---|---|
| `connected` | The SRS publishes `srs.delivery.requested` on the subject `srs.delivery.requested.<flow>` (for example `srs.delivery.requested.f-sis-lib-01`). A connector applies it and replies. |
| `manual` | The change becomes a task in **Operations → Integration tasks → Other systems**. Staff with `delivery:fulfil` make it in the target system and confirm it, or report why they cannot. Default for every flow. |
| `file` | Collected by a file export. |
| `not-used` | Nothing is recorded. |

Settings: `GET /api/v1/delivery-flows`; change with `PUT /api/v1/delivery-flows/{flowCode}` (`config:write`, audited). The mode in force is copied onto each item, so a change applies to new items only. A manual flow can name an owner, an overdue period and a team mailbox; the mailbox gets at most one digest a day while tasks are overdue, with counts and a link only.

Reasonable adjustments use the same modes on their own ledger, with a withdrawal lifecycle (see [wellbeing integration](examples/wellbeing-integration.md#how-each-target-is-fulfilled)); both queues are on the same Integration tasks page.

## Registered flows

| Flow | Target | SRS trigger |
|---|---|---|
| F-SIS-LIB-01 | Library | **Implemented**: an enrolment being created or changing status grants, suspends or revokes access |
| F-SIS-CRM-01 | CRM | **Implemented**: an enrolment being created, changing status or receiving a progression decision sends its current status and latest progression |
| F-SIS-ACC-01 | Accommodation | **Implemented**: an enrolment being created or changing status sends its status, mode of study, programme and start date |
| F-SIS-EST-01 | Estates | Not yet |
| F-SIS-OIV-01 | Identity verification | Not yet |
| F-SIS-SETS-01 | Survey system | Not yet |
| F-SIS-PAY-01 | Payroll | Not yet |
| F-SIS-RP-01 | Research portal | Not yet |
| F-SIS-CMS-01 | Content management | Not yet |
| F-SIS-ITSM-01 | IT service management | Not yet |
| F-SIS-CM-01 | Curriculum management | Not yet |

A flow with no trigger is listed so the gap is visible: nothing reaches that system from the SRS today. Adding a trigger is one call to `DeliveryService.request()` with a minimal payload and a one-line summary (see `producers/library.ts`).

## Items, supersession and replies

One `delivery_item` per change to a subject (an enrolment, say), with the minimal payload the target needs and never notes, evidence or special-category detail. For state-sync flows, a newer item supersedes an undelivered older one for the same subject: the library needs the student's current access, not every step. Statuses: `pending`, `delivered`, `failed`, `superseded`.

Connected items are published after commit and republished by the worker's reconcile loop until stamped, always with the item's event id; connectors must be idempotent on `deliveryItemId`. Replies:

| Call | Meaning |
|---|---|
| `POST /api/v1/delivery-items/{id}/acknowledge` | Applied (repeat-safe) |
| `POST /api/v1/delivery-items/{id}/failure` `{ "reason": "…" }` | Cannot apply; stays in the queue with the reason |

A connector replies with `integration:manage`. A person replies with `delivery:fulfil`, only for manual items, and each reply is audited. Acknowledging a superseded item returns `409`. `GET /api/v1/delivery-items?flowCode=&subjectId=` shows an item's history.

### F-SIS-LIB-01 payload

```json
{
  "personId": "…", "studentNumber": "S1234567", "enrolmentId": "…",
  "enrolmentStatus": "intermitting", "accessAction": "suspend", "effectiveFrom": "2027-01-15"
}
```

`accessAction`: `grant` (enrolled), `suspend` (intermitting, suspended), `revoke` (withdrawn, graduated).

### F-SIS-CRM-01 and F-SIS-ACC-01 payloads

Both carry a snapshot of the enrolment's current state, so a later item can replace an undelivered earlier one without losing anything.

```json
{ "personId": "…", "studentNumber": "S1234567", "enrolmentId": "…", "programmeId": "…",
  "enrolmentStatus": "enrolled",
  "progression": { "academicYear": "2026-27", "yearOfStudy": "1", "decisionCode": "progress", "ratified": false } }
```

`progression` is the latest decision (`null` if none); `ratified` is false until an exam board locks it. The accommodation payload has `modeOfStudy` and `startDate` instead of `progression`.
