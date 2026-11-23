# Outbound delivery to adjacent systems

> Pattern: per-flow fulfilment (event, staff task, file, or none) over one delivery ledger
> Audience: institutions configuring Revelation SRS, and teams building connectors
> Code: `apps/api/src/platform/delivery/`, migration `0000_baseline` (section `0006_adjustments_integration_and_support` / `0029_delivery_ledger`)

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
| F-SIS-LIB-01 | Library | An enrolment is created or changes status: grant, suspend or revoke access |
| F-SIS-CRM-01 | CRM | An enrolment is created, changes status, or gets a progression decision: current status and latest progression |
| F-SIS-ACC-01 | Accommodation | An enrolment is created or changes status: status, mode, programme, start date |
| F-SIS-CMS-01 | Content management | Same triggers as CRM: programme, mode, status and year of study for content personalisation |
| F-SIS-ITSM-01 | IT service management | A person is created, their identity changes, or an enrolment changes: a per-person service-desk snapshot (no date of birth, gender or nationality) |
| F-SIS-OIV-01 | Identity verification | An identity verification check is requested: one item per check with the identity data the provider needs; completing the check marks it delivered |
| F-SIS-RP-01 | Research portal | Supervisors are approved, or the team is closed: the current supervisory team |
| F-SIS-EST-01 | Estates | **Run per academic period**: registered students against capacity, per module offering |
| F-SIS-SETS-01 | Survey system | **Run per academic period**: roster of registered students (student numbers), per module offering |
| F-SIS-CM-01 | Curriculum management | **Run per academic period**: registration and result counts, per module offering |
| F-SIS-PAY-01 | Payroll | A student support instalment is approved: one payment instruction per instalment (see below). GTA teaching pay is not sent: HR and payroll own it |
| F-SIS-HR-01 | HR | A student with current university employment interrupts, is suspended, withdraws or completes: one item per student asking HR to review the roles (HR references, role, new status) |

Event-driven flows are state-sync snapshots except OIV, where each check is its own request. The three extracts run from **Operations → Integration tasks → Other systems** or `POST /api/v1/delivery-flows/{flowCode}/run { "academicPeriodId": "…" }` (`config:write` or `delivery:fulfil`, audited). They produce one item per offering; an offering whose figures are unchanged since its latest item is not re-sent, and a changed one supersedes an undelivered earlier item. Adding a producer is one call to `DeliveryService.request()` (see `producers/`).

## Student support payments (F-SIS-PAY-01 ↔ F-PAY-SIS-01)

Student support (studentship stipends, bursaries, scholarships, hardship awards) is an entitlement the SRS decides; payroll only pays it. Employment pay (GTA, demonstrating) is a contract HR and payroll own, and the SRS refuses it as support (`422`). Migration `0000_baseline` (section `0006_adjustments_integration_and_support` / `0032_student_support_and_employment`).

1. Staff with `support:write` record a `support_award` and its `support_instalment` schedule on the student's **Support & employment** tab.
2. Someone else with `support:approve` approves the award, then each instalment. Whoever recorded it cannot approve it (`409`).
3. Approving an instalment creates one F-SIS-PAY-01 item. Its operation id is the instalment id:

```json
{ "operationId": "…", "personId": "…", "studentNumber": "S1234567", "awardReference": "UKRI-123", "awardTypeCode": "studentship",
  "funder": "UKRI", "paymentTypeCode": "stipend", "currencyCode": "GBP", "amountMinorUnits": 180000, "periodStart": "2026-10-01", "periodEnd": "2026-10-31", "dueDate": "2026-10-25" }
```

4. Payroll acknowledging the item only means it accepted the instruction. The instalment stays `approved` ("awaiting payroll").
5. Payroll's F-PAY-SIS-01 report with `instructionId` = the operation id marks the instalment `paid` (with reference, date and amount) or `rejected` (with the reason), and closes the item. A report naming an instruction for a different student is stored but reconciles nothing.

Only planned instalments can be cancelled. Corrections after instruction go through payroll.

## Employed students and work limits

HR holds the appointment, contract and pay. The SRS keeps only a `student_employment_link` per HR employment reference: role (`employment-role-type-code`), dates, weekly hours, modules taught, and whether the supervisor agreed. It is written by an HR connector (`integration:manage`) or by staff (`employment-link:write`) with `PUT /api/v1/students/{personId}/employment-links/{hrEmploymentReference}`. One HR reference belongs to one student.

It is used for two things:

- **Work-limit warnings**, recalculated when read. University employment only; the SRS cannot see other jobs. Limits are per tenant in `work_limit_rule` (`GET`/`PUT /api/v1/work-limits/{ruleCode}`, `config:write`). The starting values should be checked against the institution's policy and the current Home Office guidance:
  - `student-visa-term-time`, 20 h/week: a student with a current CAS or visa record, in an academic period that overlaps the roles.
  - `studentship`, 6 h/week: a student with an approved studentship. Each role without supervisor agreement is also flagged.
- **F-SIS-HR-01**, so HR can review roles when the student's study status changes.

Warnings are advisory. The SRS does not block employment, which is HR's decision.

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

## Identity merges (ADR-031, BL-357)

When two student records are merged, every flow that has delivered something about either person receives one `person-merged` item, in the merge's transaction. This is a minor version of each flow's contract: targets that do not know `messageType` can ignore it, and the flow's normal snapshot for the survivor follows.

| Field | Meaning |
|---|---|
| `messageType` | `person-merged` |
| `mergeId` | The merge; the same id is in `srs.person.merged` |
| `survivorPersonId`, `survivorStudentNumber` | The record that continues |
| `mergedPersonId`, `mergedStudentNumber` | The record merged into it, which still resolves to the survivor |
| `effectiveAt` | When the merge took effect |

The item's subject is the merge (`subjectType: person-merge`), so it never supersedes a pending snapshot. After the merge commits, the flows' own producers send the survivor's fresh state: its recomputed IAM account, its service-desk snapshot, and a snapshot for each enrolment it now holds.

**F-SIS-IAM-01 (contract 2.1).** IAM gets an account instruction instead of the notice, on the merged person's account (`instruction`, `successorPersonId`, `mergeId`):
- `rebind`: only the merged person had an account; bind it to the survivor.
- `ended`, with `accessLevel: ended` and `endReason: merged`: both had accounts (the merge proposal confirmed it); end the merged person's, and the survivor keeps theirs.

HESA, UCAS, SLC and UKVI are not ledger targets; a regulatory correction for a dropped identifier is BL-419.

## Inbound: what other systems report back

The reverse direction is a store of what adjacent systems report about a student (migration `0000_baseline` (section `0006_adjustments_integration_and_support` / `0030_external_records`)). A connector posts with `integration:manage`; where none exists, staff with `external-record:write` enter it on the student record (**Other systems** tab), and each entry is audited. Staff with `external-record:read` (registry administrators, tenant administrators, personal tutors) see current records and, on request, earlier ones.

```http
POST /api/v1/inbound/F-LIB-SIS-01
{ "studentNumber": "S1234567", "observedAt": "2026-10-08T09:00:00Z", "idempotencyKey": "lib-2026-10-08-S1234567",
  "payload": { "accountStatus": "active", "loansOnIssue": 2, "overdueItems": 0, "outstandingBalancePence": 0 } }
```

`personId` may be given instead of `studentNumber`. A repeat of the same `idempotencyKey` returns `200` with the original record. Records are append-only; the latest observation of each record (the library account; each accommodation booking by `bookingReference`) is current.

| Flow | Fields |
|---|---|
| F-LIB-SIS-01 Library | `accountStatus` (value set `library-account-status-code`), `loansOnIssue`, `overdueItems`, `outstandingBalancePence` |
| F-ACC-SIS-01 Accommodation | `bookingReference`, `bookingStatus` (value set `accommodation-booking-status-code`), `roomReference`, `startDate`, `endDate` |
| F-PAY-SIS-01 Payroll | `paymentReference`, `paymentType` (`payment-type-code`: bursary, stipend, GTA pay), `instructionId` (the F-SIS-PAY-01 operation id, if it answers one), `paymentStatus` (`payment-status-code`: paid, rejected), `amountPence`, `paidOn`, `rejectionReason` |
| F-RP-SIS-01 Research portal | `awardReference`, `funder`, `awardStatus` (`studentship-status-code`), `startDate`, `endDate` |
| F-ITSM-SIS-01 IT service desk | `ticketReference`, `outcome` (`service-request-outcome-code`), `closedOn` |

Six inbound flows are not stored here, and a report to them is rejected with `422` saying where it belongs:

| Flow | Handling |
|---|---|
| F-OIV-SIS-01 | Dedicated: the identity verification check's completion endpoint (which also closes the F-SIS-OIV-01 request) |
| F-CRM-SIS-01 | Dedicated: the admissions hand-off and UCAS integration |
| F-CM-SIS-01 | Dedicated: the programme and module catalogue API |
| F-EST-SIS-01 | Not per student: rooms and timetable slots; needs a rooms model the SRS does not have |
| F-SETS-SIS-01 | Not per student: aggregated per module; belongs with module evaluation |
| F-CMS-SIS-01 | Not per student: institution-wide notices; belongs with communications |

These records are for information only and never change academic status. Under AJ-17 a library fine does not block results or an award, and Registry relies on its own enrolment, not a housing check-in.
