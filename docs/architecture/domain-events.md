# Domain Event Taxonomy

> Status: Reconciled with implementation — Phase 7 Stage 2
> Last updated: 2026-06-15
> Authoritative source of truth: `packages/domain/src/events/index.ts` (`EVENT_TYPES`) and `schemas/events/registry.json`.
>
> The Phase 2 draft of this document described planned events. Phases 4–6 implementation introduced domain namespace restructuring and additions. This document reflects the **as-built** state. Planned events that are not yet implemented are listed in the [Backlog](#backlog--not-yet-implemented) section.

All events are published to NATS JetStream stream `SRS_EVENTS` using subject namespace `srs.*`. Subject names follow the pattern `srs.{domain}.{event-name}`. Payload schemas are in `schemas/events/` and versioned; breaking changes create a new version suffix.

---

## Event Envelope

Every event uses this standard JSON envelope (schema: `schemas/events/envelope.v1.json`):

```typescript
interface DomainEventEnvelope<T> {
  id:                 string;   // UUID v4 — unique event ID; idempotency key for consumers
  type:               string;   // e.g. "srs.student.enrolled"
  version:            string;   // Semver: "1.0.0"
  schemaRef:          string;   // URI to the JSON Schema for this version of the payload
  tenantId:           string;   // UUID of the publishing tenant
  occurredAt:         string;   // ISO 8601 UTC — when the fact occurred in the real world
  publishedAt:        string;   // ISO 8601 UTC — when the event was published
  validAt:            string;   // ISO 8601 UTC — valid-time of the fact (may differ from occurredAt)
  correlationId:      string;   // UUID — traces the originating request/command
  causationId:        string;   // UUID — the ID of the event or command that caused this event
  source:             string;   // "srs-core" / "wellbeing-module" / etc.
  dataClassification: string;   // "standard" | "personal" | "sensitive" | "special-category" | "regulatory"
  payload:            T;        // Event-specific typed payload (validate against schemaRef)
}
```

`id` doubles as the **idempotency key**: consumers store processed event IDs and discard duplicates on retry.

`causationId` chains events: if event B was caused by event A, `causationId` on B equals `id` of A. `correlationId` traces the original user request across all events it produced.

`dataClassification` allows consumers to enforce data-handling policies without inspecting payload content. Values:

| Classification | Meaning |
|---|---|
| `standard` | Non-personal operational data |
| `personal` | Contains personal data (UK GDPR Art. 4) |
| `sensitive` | Sensitive personal data — access controls required |
| `special-category` | Special category data (UK GDPR Art. 9) — strict access controls |
| `regulatory` | Regulatory submission data — audit retention requirements |

---

## Published Events

### Student (`srs.student.*`)

| Subject | Data Class | Partition Key | Consumers |
|---|---|---|---|
| `srs.student.created` | personal | `personId` | identity-service, admissions-adapter, vle-adapter, finance-adapter |
| `srs.student.identity-updated` | personal | `personId` | identity-service, vle-adapter, finance-adapter |
| `srs.student.enrolled` | personal | `personId` | finance-adapter, vle-adapter, wellbeing-module |
| `srs.student.status-changed` | personal | `personId` | finance-adapter, vle-adapter, wellbeing-module |
| `srs.student.disability-declaration-updated` | special-category | `personId` | wellbeing-module, disability-service |

### Identity (`srs.identity.*`)

| Subject | Data Class | Partition Key | Consumers |
|---|---|---|---|
| `srs.identity.verification-requested` | personal | `personId` | identity-service |
| `srs.identity.verification-completed` | personal | `personId` | identity-service, admissions-adapter |

### Enrolment (`srs.enrolment.*`)

| Subject | Data Class | Partition Key | Consumers |
|---|---|---|---|
| `srs.enrolment.fee-liability-generated` | regulatory | `enrolmentId` | finance-adapter |
| `srs.enrolment.module-registered` | standard | `enrolmentId` | vle-adapter, timetabling-adapter, finance-adapter |
| `srs.enrolment.module-registration-withdrawn` | standard | `enrolmentId` | vle-adapter, timetabling-adapter |
| `srs.enrolment.module-registration-completed` | standard | `enrolmentId` | vle-adapter, transcript-service |

> `srs.enrolment.downstream-trigger-created` exists but is **internal-only** — see [Internal Events](#internal-events).

### Catalogue (`srs.catalogue.*`)

| Subject | Data Class | Partition Key | Consumers |
|---|---|---|---|
| `srs.catalogue.programme-updated` | standard | `programmeId` | vle-adapter, prospectus-adapter, bi-adapter |
| `srs.catalogue.module-updated` | standard | `moduleId` | vle-adapter, timetabling-adapter, bi-adapter |
| `srs.catalogue.module-relationship-updated` | standard | `moduleId` | curriculum-adapter |
| `srs.catalogue.learning-outcome-updated` | standard | `learningOutcomeId` | curriculum-adapter, hear-service |

### Assessment (`srs.assessment.*`)

| Subject | Data Class | Partition Key | Consumers |
|---|---|---|---|
| `srs.assessment.mark-received` | standard | `moduleRegistrationId` | bi-adapter, wellbeing-module |
| `srs.assessment.mark-updated` | standard | `moduleRegistrationId` | bi-adapter |
| `srs.assessment.module-result-calculated` | standard | `moduleRegistrationId` | bi-adapter, transcript-service |
| `srs.assessment.module-result-ratified` | standard | `moduleRegistrationId` | bi-adapter, transcript-service, hear-service |

### Adjustments (`srs.adjustment.*`)

| Subject | Data Class | Partition Key | Consumers |
|---|---|---|---|
| `srs.adjustment.approved` | sensitive | `enrolmentId` | assessment-venue-adapter, wellbeing-module |
| `srs.adjustment.distributed` | sensitive | `adjustmentId` | assessment-venue-adapter |
| `srs.adjustment.expired` | sensitive | `enrolmentId` | assessment-venue-adapter, wellbeing-module |

### Circumstances (`srs.circumstances.*`)

EC and misconduct events share the `circumstances` namespace. Both carry `sensitive` data classifications.

| Subject | Data Class | Partition Key | Consumers |
|---|---|---|---|
| `srs.circumstances.exceptional-circumstances-flagged` | sensitive | `enrolmentId` | wellbeing-module, bi-adapter |
| `srs.circumstances.exceptional-circumstances-updated` | sensitive | `exceptionalCircumstancesId` | wellbeing-module, bi-adapter |
| `srs.circumstances.misconduct-outcome-recorded` | sensitive | `enrolmentId` | bi-adapter |

### Governance (`srs.governance.*`)

Exam board lifecycle, record locking, and exam entry events are unified under `governance`. This namespace was introduced during Phase 5 to consolidate previously separate `exam-board`, `record`, and `exam` namespaces.

| Subject | Data Class | Partition Key | Consumers |
|---|---|---|---|
| `srs.governance.exam-board-data-pack-ready` | standard | `examBoardId` | exam-board-portal |
| `srs.governance.exam-board-ratified` | standard | `examBoardId` | transcript-service, hear-service, bi-adapter |
| `srs.governance.record-locked` | standard | `examBoardId` | bi-adapter |
| `srs.governance.record-amended-post-ratification` | standard | `examBoardId` | transcript-service, hear-service, bi-adapter |
| `srs.governance.exam-entry-submitted` | standard | `examBoardId` | timetabling-adapter |
| `srs.governance.exam-schedule-received` | standard | `examBoardId` | timetabling-adapter, assessment-venue-adapter |

### Progression and Awards

| Subject | Data Class | Partition Key | Consumers |
|---|---|---|---|
| `srs.progression.decided` | standard | `enrolmentId` | bi-adapter, transcript-service |
| `srs.award.conferred` | standard | `enrolmentId` | transcript-service, hear-service, bi-adapter, alumni-service |

### Regulatory (`srs.regulatory.*`)

All regulatory events carry `regulatory` data class (audit retention required) unless they contain personal data, in which case `personal` applies.

| Subject | Data Class | Partition Key | Consumers |
|---|---|---|---|
| `srs.regulatory.ucas-application-received` | personal | `applicationId` | admissions-adapter |
| `srs.regulatory.ucas-confirmation-sent` | regulatory | `enrolmentId` | admissions-adapter |
| `srs.regulatory.hesa-return-generated` | regulatory | `returnId` | regulatory-reporting-adapter |
| `srs.regulatory.hesa-return-submitted` | regulatory | `returnId` | regulatory-reporting-adapter, bi-adapter |
| `srs.regulatory.hesa-id-assigned` | personal | `enrolmentId` | regulatory-reporting-adapter |
| `srs.regulatory.slc-confirmation-sent` | regulatory | `enrolmentId` | finance-adapter |
| `srs.regulatory.slc-notification-received` | regulatory | `enrolmentId` | finance-adapter |
| `srs.regulatory.ukvi-cas-requested` | regulatory | `enrolmentId` | ukvi-adapter |
| `srs.regulatory.ukvi-cas-assigned` | regulatory | `enrolmentId` | ukvi-adapter |
| `srs.regulatory.ukvi-attendance-submitted` | regulatory | `academicPeriodId` | ukvi-adapter |
| `srs.regulatory.ukvi-visa-status-updated` | regulatory | `enrolmentId` | ukvi-adapter, wellbeing-module |
| `srs.regulatory.ukvi-compliance-alert-raised` | regulatory | `enrolmentId` | ukvi-adapter, wellbeing-module |
| `srs.regulatory.ofs-extract-generated` | regulatory | `extractId` | regulatory-reporting-adapter, bi-adapter |

---

## Internal Events

These events are published to the `SRS_EVENTS` stream but are **not part of the published integration contract**. They have no schemas in `schemas/events/` and do not appear in `registry.json` as `published`. External services must not subscribe to them.

| Subject | Reason |
|---|---|
| `srs.enrolment.downstream-trigger-created` | Internal routing event; drives UCAS/SLC/UKVI trigger processing |
| `srs.workflow.task-assigned` | Internal workflow coordination — drives notification service only |
| `srs.workflow.task-completed` | Internal workflow coordination |
| `srs.workflow.task-escalated` | Internal workflow coordination — deadline breach escalation |
| `srs.workflow.decision-recorded` | Internal workflow coordination |
| `srs.workflow.completed` | Internal workflow coordination |

---

## Backlog — Not Yet Implemented

These events were planned in Phase 2 but not implemented in Phases 4–6. They remain on the product roadmap but have no `EVENT_TYPES` entries and no schemas.

> **Not covered by this backlog**: CRM, Library, Accommodation, Estates, Online ID Verification, Student Evaluation of Teaching Software, Payroll, Research Proposals, Content Management Systems and IT Service Management are deliberately absent from the list below — they are not "planned but unbuilt". Their contracts are seeded (migration `0019_partner_systems_contracts`) and simulated end-to-end by `apps/partner-systems-sandbox` against the real integration registry — see `docs/architecture/integration-contract-catalogue.md`.

### Student lifecycle
- `srs.student.re-enrolled` — Annual re-enrolment confirmation
- `srs.student.hold-applied` / `srs.student.hold-released` — Account holds

### Fee and finance
- `srs.enrolment.fee-liability-updated` — Liability change on status/intensity change
- `srs.finance.payment-confirmed` — Payment confirmation from Finance

### Timetable and attendance
- `srs.timetable.published` — Finalised timetable from TTB
- `srs.attendance.record-received` — Attendance event from AM
- `srs.attendance.absence-alert-raised` — Absence alert (UKVI-relevant)

### Governance extensions
- `srs.governance.exam-board-data-pack-superseded` — Board pack regenerated after correction
- `srs.governance.external-examiner-signed-off` — External examiner confirmation
- `srs.governance.appeal-submitted` — Post-ratification appeal/correction started
- `srs.governance.appeal-resolved` — Appeal dismissed or upheld

### Adjustment extensions
- `srs.adjustment.distribution-failed` — Downstream distribution failed after all retries

### Regulatory extensions (HESA)
- `srs.regulatory.hesa-return-accepted` — HESA acceptance received
- `srs.regulatory.hesa-return-amended` — Submitted return amended
- `srs.regulatory.hesa-validation-report-received` — Validation report from HESA

### Regulatory extensions (SLC)
- `srs.regulatory.slc-entitlement-received` — Loan entitlement from SLC
- `srs.regulatory.slc-payment-status-received` — Payment status from SLC
- `srs.regulatory.slc-overpayment-notified` — Overpayment notice from SLC

### Regulatory extensions (UKVI)
- `srs.regulatory.ucas-withdrawal-notified` — Withdrawal/deferral/no-show sent to UCAS
- `srs.regulatory.ukvi-sponsor-action-reported` — Compliance report sent to UKVI

### Enterprise integration inbound events
- `srs.iam.account-state-received` — IAM account lock / credential update
- `srs.edrms.document-archived` — EDRMS archive confirmation
- `srs.bi.risk-flag-received` — BI at-risk flag
- `srs.data-quality.issue-received` — DW reconciliation / data quality issue
- `srs.staff-assignment.updated` — Tutor/supervisor assignment from HR
- `srs.research.milestone-recorded` — CRIS milestone for PGR students

---

## Domain Namespace Changes (Phase 2 → Phase 5)

For teams migrating from Phase 2 plans to the live system, the following subject renames occurred during implementation:

| Phase 2 subject | Implemented subject | Change type |
|---|---|---|
| `srs.module-registration.created` | `srs.enrolment.module-registered` | Namespace merge into `enrolment` |
| `srs.module-registration.withdrawn` | `srs.enrolment.module-registration-withdrawn` | Namespace merge |
| `srs.module-registration.completed` | `srs.enrolment.module-registration-completed` | Namespace merge |
| `srs.exceptional-circumstances.flagged` | `srs.circumstances.exceptional-circumstances-flagged` | Namespace rename |
| `srs.exceptional-circumstances.updated` | `srs.circumstances.exceptional-circumstances-updated` | Namespace rename |
| `srs.misconduct.outcome-recorded` | `srs.circumstances.misconduct-outcome-recorded` | Namespace consolidation |
| `srs.exam-board.data-pack-ready` | `srs.governance.exam-board-data-pack-ready` | Namespace consolidation |
| `srs.exam-board.ratified` | `srs.governance.exam-board-ratified` | Namespace consolidation |
| `srs.record.locked` | `srs.governance.record-locked` | Namespace consolidation |
| `srs.record.amended-post-ratification` | `srs.governance.record-amended-post-ratification` | Namespace consolidation |
| `srs.exam.entry-created` | `srs.governance.exam-entry-submitted` | Namespace consolidation + rename |
| `srs.exam.timetable-published` | `srs.governance.exam-schedule-received` | Namespace consolidation + rename |
| `srs.enrolment.fee-liability-created` | `srs.enrolment.fee-liability-generated` | Event rename |
| `srs.regulatory.ucas-enrolment-confirmed` | `srs.regulatory.ucas-confirmation-sent` | Event rename |
| `srs.regulatory.hesa-ids-received` | `srs.regulatory.hesa-id-assigned` | Event rename |
| `srs.regulatory.slc-enrolment-confirmed` | `srs.regulatory.slc-confirmation-sent` | Event rename |
| `srs.regulatory.slc-status-notified` | `srs.regulatory.slc-notification-received` | Event rename |
| `srs.regulatory.ukvi-cas-created` | `srs.regulatory.ukvi-cas-requested` + `srs.regulatory.ukvi-cas-assigned` | Split into two events |
| `srs.regulatory.ukvi-compliance-alert` | `srs.regulatory.ukvi-compliance-alert-raised` | Event rename |
| `srs.workflow.deadline-breached` | `srs.workflow.task-escalated` (internal) | Rename + reclassified as internal |

---

## Schema Versioning

Event payload schemas are derived from TypeScript interfaces in `packages/domain/src/events/` using `ts-json-schema-generator` and committed to `schemas/events/`. The generation script is `packages/domain/scripts/generate-event-schemas.ts`.

```
schemas/events/
├── envelope.v1.json                          — shared envelope wrapper
├── registry.json                             — machine-readable event registry (46 published + 6 internal)
├── student/
│   ├── created/v1.json
│   ├── identity-updated/v1.json
│   ├── enrolled/v1.json
│   ├── status-changed/v1.json
│   └── disability-declaration-updated/v1.json
├── identity/
│   ├── verification-requested/v1.json
│   └── verification-completed/v1.json
├── enrolment/
│   ├── fee-liability-generated/v1.json
│   ├── module-registered/v1.json
│   ├── module-registration-withdrawn/v1.json
│   └── module-registration-completed/v1.json
├── catalogue/
│   ├── programme-updated/v1.json
│   ├── module-updated/v1.json
│   ├── module-relationship-updated/v1.json
│   └── learning-outcome-updated/v1.json
├── assessment/
│   ├── mark-received/v1.json
│   ├── mark-updated/v1.json
│   ├── module-result-calculated/v1.json
│   └── module-result-ratified/v1.json
├── adjustment/
│   ├── approved/v1.json
│   ├── distributed/v1.json
│   └── expired/v1.json
├── circumstances/
│   ├── exceptional-circumstances-flagged/v1.json
│   ├── exceptional-circumstances-updated/v1.json
│   └── misconduct-outcome-recorded/v1.json
├── governance/
│   ├── exam-board-data-pack-ready/v1.json
│   ├── exam-board-ratified/v1.json
│   ├── record-locked/v1.json
│   ├── record-amended-post-ratification/v1.json
│   ├── exam-entry-submitted/v1.json
│   └── exam-schedule-received/v1.json
├── progression/
│   └── decided/v1.json
├── award/
│   └── conferred/v1.json
└── regulatory/
    ├── ucas-application-received/v1.json
    ├── ucas-confirmation-sent/v1.json
    ├── hesa-return-generated/v1.json
    ├── hesa-return-submitted/v1.json
    ├── hesa-id-assigned/v1.json
    ├── slc-confirmation-sent/v1.json
    ├── slc-notification-received/v1.json
    ├── ukvi-cas-requested/v1.json
    ├── ukvi-cas-assigned/v1.json
    ├── ukvi-attendance-submitted/v1.json
    ├── ukvi-visa-status-updated/v1.json
    ├── ukvi-compliance-alert-raised/v1.json
    └── ofs-extract-generated/v1.json
```

Schema IDs follow the pattern `https://schemas.revelation-srs.io/events/{domain}/{event-name}/v1.json`. Breaking changes produce a new version file (`v2.json`) and dual-publish both versions during a deprecation window. The `schemaRef` field in the envelope identifies which version to validate against.

To regenerate all schemas after payload type changes:

```bash
pnpm --filter @revelation-srs/domain generate:schemas
```
