# Revelation SRS Integration Contract Index

> Phase 7 — Stage 5
> Status: Current
> OpenAPI spec: `apps/api/openapi/v1.json`
> Event registry: `schemas/events/registry.json`
> File contract registry: `schemas/file-contracts/registry.json`

This index is the single reference for every published integration surface. Use it to identify the correct contract for your integration, then follow the links to the detailed specification.

---

## REST API Surfaces

The complete REST API is documented in `apps/api/openapi/v1.json`. The surfaces below are those explicitly designed for system-to-system integration.

Publication classes: **PUB** = published external, **INT** = integration-class (system-to-system write), **WF** = workflow command, **PRIV** = internal/not for third parties.

### Student and Identity

| Method | Path | Class | Permission | Notes |
|--------|------|-------|------------|-------|
| `POST` | `/api/v1/students` | INT | `registry:write` | Create student record |
| `GET` | `/api/v1/students/:id` | PUB | `registry:read` | |
| `PATCH` | `/api/v1/students/:id/identity` | PUB | `registry:write` | |
| `PATCH` | `/api/v1/students/:id/hesa-id` | INT | `regulatory:write` | HESA ID assignment |
| `GET` | `/api/v1/students/:id/disability-declarations` | PUB | `wellbeing-advisor` or own-record | Special-category |
| `POST` | `/api/v1/students/:id/identity-verifications` | INT | `registry:write` | OIV request trigger |
| `POST` | `/api/v1/students/:id/identity-verifications/:checkId/completion` | INT | `registry:write` | OIV outcome inbound |

### Enrolment

| Method | Path | Class | Permission | Notes |
|--------|------|-------|------------|-------|
| `POST` | `/api/v1/enrolments` | INT | `registry:write` | Enrol student |
| `GET` | `/api/v1/enrolments/:id` | PUB | `registry:read` | |
| `POST` | `/api/v1/enrolments/:id/graduate` | WF | `registry:write` | |
| `POST` | `/api/v1/module-registrations` | INT | `registry:write` | Register on module |
| `GET` | `/api/v1/module-registrations/:id` | PUB | `registry:read` | |
| `POST` | `/api/v1/module-registrations/:id/withdrawal` | WF | `registry:write` | |
| `POST` | `/api/v1/module-registrations/:id/completion` | WF | `registry:write` | |

### Assessment and Marks

| Method | Path | Class | Permission | Notes |
|--------|------|-------|------------|-------|
| `POST` | `/api/v1/module-registrations/:id/marks` | INT | `registry:write` | **VLE mark submission** |
| `GET` | `/api/v1/marks/:id` | PUB | `registry:read` | |
| `PATCH` | `/api/v1/marks/:id` | PUB | `registry:write` | Pre-board correction; audited |
| `GET` | `/api/v1/module-registrations/:id/result` | PUB | `registry:read` | |

### Adjustments and Wellbeing

| Method | Path | Class | Permission | Notes |
|--------|------|-------|------------|-------|
| `POST` | `/api/v1/students/:id/adjustments` | INT | `wellbeing-advisor` | **Wellbeing module inbound** |
| `GET` | `/api/v1/students/:id/adjustments` | PUB | `wellbeing-advisor` or `registry:read` | |
| `POST` | `/api/v1/adjustments/:id/distributions/:distId/acknowledge` | INT | `wellbeing-advisor` | Target system acknowledgement |
| `POST` | `/api/v1/students/:id/exceptional-circumstances` | INT | `wellbeing-advisor` | **Wellbeing EC inbound** |
| `PATCH` | `/api/v1/exceptional-circumstances/:ecId` | WF | `wellbeing-advisor` | Pre-board correction |
| `POST` | `/api/v1/students/:id/misconduct-outcomes` | INT | `wellbeing-advisor` | Misconduct outcome inbound |

### Regulatory — UCAS

| Method | Path | Class | Permission | Notes |
|--------|------|-------|------------|-------|
| `POST` | `/api/v1/regulatory/ucas/applications` | INT | `regulatory:write` | Application ingestion |
| `POST` | `/api/v1/regulatory/ucas/confirmations/generate` | INT | `regulatory:write` | Generate confirmation batch |
| `GET` | `/api/v1/regulatory/ucas/applications` | PUB | `regulatory:read` | List received applications |

### Regulatory — HESA

| Method | Path | Class | Permission | Notes |
|--------|------|-------|------------|-------|
| `POST` | `/api/v1/regulatory/hesa/returns` | INT | `regulatory:write` | Initiate return |
| `GET` | `/api/v1/regulatory/hesa/returns/:id/file` | INT | `regulatory:read` | Download XML return |
| `POST` | `/api/v1/regulatory/hesa/returns/:id/validation-reports` | INT | `regulatory:write` | Ingest HESA validation report |
| `POST` | `/api/v1/regulatory/hesa/returns/:id/amendments` | WF | `regulatory:write` | Generate amendment |

### Regulatory — SLC

| Method | Path | Class | Permission | Notes |
|--------|------|-------|------------|-------|
| `POST` | `/api/v1/regulatory/slc/confirmations/generate` | INT | `regulatory:write` | Generate enrolment confirmations |
| `POST` | `/api/v1/regulatory/slc/notifications` | INT | `regulatory:write` | Inbound payment/hold notification |
| `GET` | `/api/v1/regulatory/slc/notifications` | PUB | `regulatory:read` | |

### Regulatory — UKVI

| Method | Path | Class | Permission | Notes |
|--------|------|-------|------------|-------|
| `POST` | `/api/v1/regulatory/ukvi/cas-requests` | INT | `regulatory:write` | CAS application |
| `GET` | `/api/v1/regulatory/ukvi/cas-requests/:id` | PUB | `regulatory:read` | |
| `POST` | `/api/v1/regulatory/ukvi/attendance-reports` | INT | `regulatory:write` | Attendance submission |
| `POST` | `/api/v1/regulatory/ukvi/visa-updates` | INT | `regulatory:write` | Visa status inbound |

### Integration Registry

| Method | Path | Class | Permission | Notes |
|--------|------|-------|------------|-------|
| `GET` | `/api/v1/integration-contracts` | Admin | `integration:manage` | List all contracts |
| `GET` | `/api/v1/integration-contracts/:contractId` | Admin | `integration:manage` | Get contract metadata |
| `GET` | `/api/v1/integration-registrations` | Admin | `integration:manage` | List tenant registrations |
| `POST` | `/api/v1/integration-registrations` | Admin | `integration:manage` | Create registration |
| `GET` | `/api/v1/integration-registrations/:id` | Admin | `integration:manage` | |
| `PATCH` | `/api/v1/integration-registrations/:id` | Admin | `integration:manage` | Update configuration |
| `POST` | `/api/v1/integration-registrations/:id/enable` | Admin | `integration:manage` | Enable (safety enforced) |
| `POST` | `/api/v1/integration-registrations/:id/disable` | Admin | `integration:manage` | Disable |
| `POST` | `/api/v1/integration-registrations/:id/health-check` | Admin | `integration:manage` | Record health status |
| `POST` | `/api/v1/integration-registrations/:id/replay` | Admin | `integration:manage` | Request backfill |
| `GET` | `/api/v1/integration-exchanges` | Admin | `integration:manage` | Exchange audit log |
| `GET` | `/api/v1/integration-exchanges/:id` | Admin | `integration:manage` | |

---

## Event Subjects

All events are published on NATS JetStream. Schema files are at `schemas/events/{domain}/{event}.v1.json`. The full registry is at `schemas/events/registry.json`.

Data classification: **standard** = non-personal operational, **personal** = personal data (GDPR), **sensitive** = sensitive personal, **special-category** = Article 9 GDPR, **regulatory** = statutory compliance data.

| Subject | Version | Data Class | Typical Consumers | Schema |
|---------|---------|------------|------------------|--------|
| `srs.student.created` | 1.0.0 | personal | VLE, Finance, IAM | `schemas/events/student/created.v1.json` |
| `srs.student.identity-updated` | 1.0.0 | personal | VLE, Finance | `schemas/events/student/identity-updated.v1.json` |
| `srs.student.enrolled` | 1.0.0 | personal | Finance, VLE, Wellbeing | `schemas/events/student/enrolled.v1.json` |
| `srs.student.status-changed` | 1.0.0 | personal | Finance, VLE, SLC, UKVI | `schemas/events/student/status-changed.v1.json` |
| `srs.student.disability-declaration-updated` | 1.0.0 | special-category | Wellbeing, Disability Service | `schemas/events/student/disability-declaration-updated.v1.json` |
| `srs.identity.verification-requested` | 1.0.0 | personal | Identity Service | `schemas/events/identity/verification-requested.v1.json` |
| `srs.identity.verification-completed` | 1.0.0 | personal | Admissions | `schemas/events/identity/verification-completed.v1.json` |
| `srs.enrolment.fee-liability-generated` | 1.0.0 | regulatory | Finance | `schemas/events/enrolment/fee-liability-generated.v1.json` |
| `srs.enrolment.module-registered` | 1.0.0 | standard | VLE, Timetabling, Finance | `schemas/events/enrolment/module-registered.v1.json` |
| `srs.enrolment.module-registration-withdrawn` | 1.0.0 | standard | VLE, Timetabling | `schemas/events/enrolment/module-registration-withdrawn.v1.json` |
| `srs.enrolment.module-registration-completed` | 1.0.0 | standard | VLE, Transcript | `schemas/events/enrolment/module-registration-completed.v1.json` |
| `srs.catalogue.programme-updated` | 1.0.0 | standard | VLE, Prospectus, BI | `schemas/events/catalogue/programme-updated.v1.json` |
| `srs.catalogue.module-updated` | 1.0.0 | standard | VLE, Timetabling, BI | `schemas/events/catalogue/module-updated.v1.json` |
| `srs.catalogue.module-relationship-updated` | 1.0.0 | standard | Curriculum | `schemas/events/catalogue/module-relationship-updated.v1.json` |
| `srs.catalogue.learning-outcome-updated` | 1.0.0 | standard | VLE, HEAR | `schemas/events/catalogue/learning-outcome-updated.v1.json` |
| `srs.assessment.mark-received` | 1.0.0 | standard | BI, Wellbeing | `schemas/events/assessment/mark-received.v1.json` |
| `srs.assessment.mark-updated` | 1.0.0 | standard | BI | `schemas/events/assessment/mark-updated.v1.json` |
| `srs.assessment.module-result-calculated` | 1.0.0 | standard | BI, Transcript | `schemas/events/assessment/module-result-calculated.v1.json` |
| `srs.assessment.module-result-ratified` | 1.0.0 | standard | BI, Transcript, HEAR | `schemas/events/assessment/module-result-ratified.v1.json` |
| `srs.adjustment.approved` | 1.0.0 | sensitive | Venue, Wellbeing | `schemas/events/adjustment/approved.v1.json` |
| `srs.adjustment.distributed` | 1.0.0 | sensitive | Venue | `schemas/events/adjustment/distributed.v1.json` |
| `srs.adjustment.expired` | 1.0.0 | sensitive | Venue, Wellbeing | `schemas/events/adjustment/expired.v1.json` |
| `srs.circumstances.exceptional-circumstances-flagged` | 1.0.0 | sensitive | Wellbeing, BI | `schemas/events/circumstances/exceptional-circumstances-flagged.v1.json` |
| `srs.circumstances.exceptional-circumstances-updated` | 1.0.0 | sensitive | Wellbeing, BI | `schemas/events/circumstances/exceptional-circumstances-updated.v1.json` |
| `srs.circumstances.misconduct-outcome-recorded` | 1.0.0 | sensitive | BI | `schemas/events/circumstances/misconduct-outcome-recorded.v1.json` |
| `srs.governance.exam-board-data-pack-ready` | 1.0.0 | standard | Exam Board Portal | `schemas/events/governance/exam-board-data-pack-ready.v1.json` |
| `srs.governance.exam-board-ratified` | 1.0.0 | standard | Transcript, HEAR, BI | `schemas/events/governance/exam-board-ratified.v1.json` |
| `srs.governance.record-locked` | 1.0.0 | standard | BI | `schemas/events/governance/record-locked.v1.json` |
| `srs.governance.record-amended-post-ratification` | 1.0.0 | standard | Transcript, HEAR | `schemas/events/governance/record-amended-post-ratification.v1.json` |
| `srs.governance.exam-entry-submitted` | 1.0.0 | standard | Timetabling | `schemas/events/governance/exam-entry-submitted.v1.json` |
| `srs.governance.exam-schedule-received` | 1.0.0 | standard | Timetabling, Venue | `schemas/events/governance/exam-schedule-received.v1.json` |
| `srs.progression.decided` | 1.0.0 | standard | BI, Transcript | `schemas/events/progression/decided.v1.json` |
| `srs.award.conferred` | 1.0.0 | standard | Transcript, HEAR, BI, Alumni | `schemas/events/award/conferred.v1.json` |
| `srs.regulatory.ucas-application-received` | 1.0.0 | personal | Admissions | `schemas/events/regulatory/ucas-application-received.v1.json` |
| `srs.regulatory.ucas-confirmation-sent` | 1.0.0 | regulatory | Admissions | `schemas/events/regulatory/ucas-confirmation-sent.v1.json` |
| `srs.regulatory.hesa-return-generated` | 1.0.0 | regulatory | Regulatory Reporting | `schemas/events/regulatory/hesa-return-generated.v1.json` |
| `srs.regulatory.hesa-return-submitted` | 1.0.0 | regulatory | Regulatory Reporting, BI | `schemas/events/regulatory/hesa-return-submitted.v1.json` |
| `srs.regulatory.hesa-id-assigned` | 1.0.0 | personal | Regulatory Reporting | `schemas/events/regulatory/hesa-id-assigned.v1.json` |
| `srs.regulatory.slc-confirmation-sent` | 1.0.0 | regulatory | Finance | `schemas/events/regulatory/slc-confirmation-sent.v1.json` |
| `srs.regulatory.slc-notification-received` | 1.0.0 | regulatory | Finance | `schemas/events/regulatory/slc-notification-received.v1.json` |
| `srs.regulatory.ukvi-cas-requested` | 1.0.0 | regulatory | UKVI | `schemas/events/regulatory/ukvi-cas-requested.v1.json` |
| `srs.regulatory.ukvi-cas-assigned` | 1.0.0 | regulatory | UKVI | `schemas/events/regulatory/ukvi-cas-assigned.v1.json` |
| `srs.regulatory.ukvi-attendance-submitted` | 1.0.0 | regulatory | UKVI | `schemas/events/regulatory/ukvi-attendance-submitted.v1.json` |
| `srs.regulatory.ukvi-visa-status-updated` | 1.0.0 | regulatory | UKVI, Wellbeing | `schemas/events/regulatory/ukvi-visa-status-updated.v1.json` |
| `srs.regulatory.ukvi-compliance-alert-raised` | 1.0.0 | regulatory | UKVI, Wellbeing | `schemas/events/regulatory/ukvi-compliance-alert-raised.v1.json` |
| `srs.regulatory.ofs-extract-generated` | 1.0.0 | regulatory | Regulatory Reporting, BI | `schemas/events/regulatory/ofs-extract-generated.v1.json` |

**Internal events — not for external consumption**:

| Subject | Notes |
|---------|-------|
| `srs.enrolment.downstream-trigger-created` | Internal downstream trigger coordination |
| `srs.workflow.task-assigned` | Workflow engine internal |
| `srs.workflow.task-completed` | Workflow engine internal |
| `srs.workflow.task-escalated` | Workflow engine internal |
| `srs.workflow.decision-recorded` | Workflow engine internal |
| `srs.workflow.completed` | Workflow engine internal |

---

## File Exchange Contracts

Schemas at `schemas/file-contracts/`. Spec documents at `docs/integrations/file-contracts/`.

| Contract ID | Name | Direction | Format | Endpoint | Schema |
|-------------|------|-----------|--------|----------|--------|
| `ucas-admissions-exchange.v1` | UCAS Admissions Exchange | Inbound | JSON | `POST /api/v1/regulatory/ucas/applications` | `schemas/file-contracts/ucas/application-inbound.v1.json` |
| `ucas-admissions-exchange.v1` | UCAS Admissions Exchange | Outbound | JSON | `POST /api/v1/regulatory/ucas/confirmations/generate` | `schemas/file-contracts/ucas/confirmation-outbound.v1.json` |
| `hesa-student-return.v1` | HESA Student Return | Outbound | XML | `GET /api/v1/regulatory/hesa/returns/:id/file` | HESA C16032 coding frame (year-specific) |
| `hesa-student-return.v1` | HESA Student Return | Inbound | JSON | `POST /api/v1/regulatory/hesa/returns/:id/validation-reports` | `schemas/file-contracts/hesa/validation-report.v1.json` |
| `slc-enrolment-exchange.v1` | SLC Enrolment Exchange | Outbound | JSON | `POST /api/v1/regulatory/slc/confirmations/generate` | `schemas/file-contracts/slc/confirmation-outbound.v1.json` |
| `slc-enrolment-exchange.v1` | SLC Enrolment Exchange | Inbound | JSON | `POST /api/v1/regulatory/slc/notifications` | `schemas/file-contracts/slc/notification-inbound.v1.json` |
| `ukvi-sponsor-compliance.v1` | UKVI Sponsor Compliance | Outbound | JSON | `POST /api/v1/regulatory/ukvi/cas-requests` | `schemas/file-contracts/ukvi/cas-request.v1.json` |
| `ukvi-sponsor-compliance.v1` | UKVI Sponsor Compliance | Outbound | JSON | `POST /api/v1/regulatory/ukvi/attendance-reports` | `schemas/file-contracts/ukvi/attendance-report.v1.json` |
| `ukvi-sponsor-compliance.v1` | UKVI Sponsor Compliance | Inbound | JSON | `POST /api/v1/regulatory/ukvi/visa-updates` | `schemas/file-contracts/ukvi/visa-update.v1.json` |
| `exam-scheduling.v1` | Exam Scheduling Exchange | Outbound | JSON | File export | `schemas/file-contracts/exam/entry-outbound.v1.json` |
| `exam-scheduling.v1` | Exam Scheduling Exchange | Inbound | JSON | File import | `schemas/file-contracts/exam/schedule-inbound.v1.json` |

Detailed specifications: [`file-contracts/ucas-admissions-exchange.md`](file-contracts/ucas-admissions-exchange.md), [`hesa-student-return.md`](file-contracts/hesa-student-return.md), [`slc-enrolment-exchange.md`](file-contracts/slc-enrolment-exchange.md), [`ukvi-sponsor-compliance.md`](file-contracts/ukvi-sponsor-compliance.md), [`exam-scheduling.md`](file-contracts/exam-scheduling.md).

---

## Integration Registry Contracts

These are the contracts available for registration via the plugin registry API.

| Contract ID | Display Name | Direction | Pattern | Data Class | Current Version |
|-------------|-------------|-----------|---------|------------|-----------------|
| `ucas-admissions-exchange.v1` | UCAS Admissions Exchange | bidirectional | api-and-file | regulatory | 1.0.0 |
| `hesa-student-return.{year}` | HESA Student Return | bidirectional | api-and-file | regulatory | 1.0.0 |
| `slc-enrolment-exchange.v1` | SLC Enrolment Exchange | bidirectional | api-and-file | regulatory | 1.0.0 |
| `ukvi-sponsor-compliance.v1` | UKVI Sponsor Compliance | bidirectional | api-and-file | regulatory | 1.0.0 |
| `exam-scheduling.v1` | Exam Scheduling Exchange | bidirectional | file | operational | 1.0.0 |
| `ofs-regulatory-extracts.v1` | OfS Regulatory Extracts | outbound | api-and-file | regulatory | 1.0.0 |
