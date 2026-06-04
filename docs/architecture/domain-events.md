# Domain Event Taxonomy

> Status: Updated — Phase 2 remediation
> Last updated: 2026-06-04
> All events are published to NATS JetStream using the envelope defined in `integration-layer.md`. Subject names follow the pattern `srs.{domain}.{event-name}`. Payload schemas are versioned; breaking changes create a new version suffix.

---

## Student Lifecycle Events (`srs.student.*`)

| Subject | Version | Trigger | Key Payload Fields | Primary Consumers |
|---|---|---|---|---|
| `srs.student.created` | 1.0 | Student record created (from UCAS or direct) | `personId`, `studentNumber`, `sourceSystem`, `sourceReference` | IAM, CRM |
| `srs.student.identity-updated` | 1.0 | Personal data change (name, address, contact) | `personId`, `changedFields[]`, `effectiveDate` | IAM, EWP, LIB |
| `srs.student.enrolled` | 1.0 | Enrolment created and confirmed | `personId`, `enrolmentId`, `programmeId`, `academicYear`, `modeOfStudy`, `fundingSource` | VLE, IAM, LIB, FIN, CRM, AM, EWP |
| `srs.student.status-changed` | 1.0 | Enrolment status transition (intermission, withdrawal, suspension, graduation) | `personId`, `enrolmentId`, `previousStatus`, `newStatus`, `effectiveDate`, `reason` | VLE, IAM, LIB, FIN, SLC, UKVI, EWP, CRM |
| `srs.student.re-enrolled` | 1.0 | Annual re-enrolment confirmed | `personId`, `enrolmentId`, `academicYear` | VLE, IAM, EWP |
| `srs.student.graduated` | 1.0 | Award conferred and enrolment closed | `personId`, `enrolmentId`, `awardId`, `qualificationCode`, `classificationCode`, `awardDate` | IAM, EDRMS, EWP, CRM |
| `srs.student.disability-declaration-updated` | 1.0 | Disability declaration status changed | `personId`, `declarationId`, `disabilityCategoryCode`, `declarationStatusCode` | WELL |
| `srs.student.hold-applied` | 1.0 | Hold applied to student account | `personId`, `enrolmentId`, `holdId`, `holdTypeCode` | EWP, IAM |
| `srs.student.hold-released` | 1.0 | Hold released | `personId`, `enrolmentId`, `holdId` | EWP, IAM |

---

## Module Registration Events (`srs.module-registration.*`)

| Subject | Version | Trigger | Key Payload Fields | Primary Consumers |
|---|---|---|---|---|
| `srs.module-registration.created` | 1.0 | Student registered on a module offering | `personId`, `enrolmentId`, `moduleRegistrationId`, `moduleOfferingId`, `moduleCode`, `academicPeriod` | VLE, AM, TTB, SETS |
| `srs.module-registration.withdrawn` | 1.0 | Student withdrawn from a module | `personId`, `moduleRegistrationId`, `moduleOfferingId`, `effectiveDate` | VLE, AM |
| `srs.module-registration.completed` | 1.0 | Module registration marked complete (post-ratification) | `personId`, `moduleRegistrationId`, `moduleResultId` | VLE, CRIS (PGR) |

---

## Assessment and Results Events (`srs.assessment.*`)

| Subject | Version | Trigger | Key Payload Fields | Primary Consumers |
|---|---|---|---|---|
| `srs.assessment.mark-received` | 1.0 | Mark ingested from VLE or manual entry | `moduleRegistrationId`, `assessmentComponentId`, `rawMark`, `sourceSystem` | — (internal) |
| `srs.assessment.mark-updated` | 1.0 | Existing mark corrected (pre-ratification) | `markId`, `previousMark`, `newMark`, `reason` | — (internal) |
| `srs.assessment.module-result-calculated` | 1.0 | Aggregate module result derived from marks | `moduleRegistrationId`, `moduleResultId`, `aggregateMark`, `resultCode` | EWP (provisional grades if configured) |
| `srs.assessment.module-result-ratified` | 1.0 | Module result ratified by Exam Board | `moduleRegistrationId`, `moduleResultId`, `aggregateMark`, `resultCode`, `examBoardId` | VLE, EWP, DW, BI |

---

## Exam Board and Record Lifecycle Events (`srs.exam-board.*`)

| Subject | Version | Trigger | Key Payload Fields | Primary Consumers |
|---|---|---|---|---|
| `srs.exam-board.data-pack-ready` | 1.0 | Board data pack generated, ready for review | `examBoardId`, `boardType`, `academicPeriod`, `candidateCount` | — (internal notification) |
| `srs.exam-board.ratified` | 1.0 | Board has formally ratified outcomes | `examBoardId`, `boardType`, `academicPeriod`, `ratifiedAt`, `externalExaminerConfirmedAt` | EWP, VLE, SLC, DW, BI |
| `srs.record.locked` | 1.0 | Academic records locked post-ratification | `examBoardId`, `lockedEntityTypes[]`, `lockedCount` | — (internal) |
| `srs.record.amended-post-ratification` | 1.0 | A locked record amended via appeal/correction workflow | `entityType`, `entityId`, `appealReference`, `amendedBy`, `amendedAt` | EWP, DW |

---

## Progression and Awards Events (`srs.progression.*`)

| Subject | Version | Trigger | Key Payload Fields | Primary Consumers |
|---|---|---|---|---|
| `srs.progression.decided` | 1.0 | Progression decision recorded and ratified | `enrolmentId`, `personId`, `academicYear`, `yearOfStudy`, `decisionCode`, `examBoardId` | EWP, VLE, CRM |
| `srs.award.conferred` | 1.0 | Award formally conferred | `enrolmentId`, `personId`, `awardId`, `qualificationCode`, `classificationCode`, `awardDate` | EWP, EDRMS, CRIS |

---

## Reasonable Adjustment Events (`srs.adjustment.*`)

| Subject | Version | Trigger | Key Payload Fields | Primary Consumers |
|---|---|---|---|---|
| `srs.adjustment.approved` | 1.0 | Approved adjustment outcome received from Wellbeing and recorded in SIS | `enrolmentId`, `personId`, `adjustmentId`, `adjustmentTypeCode`, `scopeCode`, `validFrom`, `validTo` | — (internal; triggers distribution) |
| `srs.adjustment.distributed` | 1.0 | Approved adjustment distributed to a downstream system | `adjustmentId`, `targetSystem`, `distributedAt` | VLE, AM, EXAMS |
| `srs.adjustment.expired` | 1.0 | Adjustment valid period ended | `adjustmentId`, `enrolmentId`, `expiredAt` | VLE, AM, EXAMS |

---

## Exceptional Circumstances Events (`srs.exceptional-circumstances.*`)

| Subject | Version | Trigger | Key Payload Fields | Primary Consumers |
|---|---|---|---|---|
| `srs.exceptional-circumstances.flagged` | 1.0 | Approved EC outcome received and recorded | `enrolmentId`, `personId`, `moduleOfferingId`, `outcomeCode`, `determinationDate` | — (internal; surfaced in board pack) |
| `srs.exceptional-circumstances.updated` | 1.0 | EC flag corrected or superseded | `exceptionalCircumstancesId`, `enrolmentId`, `previousOutcomeCode`, `newOutcomeCode` | Exam Board tooling |

---

## Academic Integrity Events (`srs.misconduct.*`)

| Subject | Version | Trigger | Key Payload Fields | Primary Consumers |
|---|---|---|---|---|
| `srs.misconduct.outcome-recorded` | 1.0 | Misconduct outcome received from AI system | `enrolmentId`, `personId`, `outcomeCode`, `penaltyCode`, `effectiveDate` | EWP, DW |
| `srs.misconduct.outcome-updated` | 1.0 | Misconduct outcome corrected pre-board or by appeal | `misconductOutcomeId`, `enrolmentId`, `previousOutcomeCode`, `newOutcomeCode` | EWP, Exam Board tooling, DW |

---

## Admissions Events (`srs.admissions.*`)

| Subject | Version | Trigger | Key Payload Fields | Primary Consumers |
|---|---|---|---|---|
| `srs.admissions.application-received` | 1.0 | Application ingested from UCAS / CRM / direct | `applicationId`, `personId`, `programmeId`, `sourceSystem`, `entryAcademicYear` | CRM, Registry workflow |
| `srs.admissions.offer-accepted` | 1.0 | Offer accepted; enrolment workflow can proceed | `applicationId`, `offerId`, `personId` | Registry, FIN, IAM |
| `srs.identity.verification-requested` | 1.0 | OIV request initiated | `personId`, `verificationCheckId` | OIV adapter |
| `srs.identity.verification-completed` | 1.0 | OIV outcome received and stored | `personId`, `verificationCheckId`, `statusCode`, `fraudFlag` | Registry, IAM |

---

## Catalogue Events (`srs.catalogue.*`)

| Subject | Version | Trigger | Key Payload Fields | Primary Consumers |
|---|---|---|---|---|
| `srs.catalogue.programme-updated` | 1.0 | Programme created or version changed | `programmeId`, `programmeCode`, `effectiveFrom` | EWP, VLE, TTB, BI, DW |
| `srs.catalogue.module-updated` | 1.0 | Module created or version changed | `moduleId`, `moduleCode`, `effectiveFrom` | EWP, VLE, TTB, SETS, BI, DW |
| `srs.catalogue.module-relationship-updated` | 1.0 | Prerequisite / co-requisite / exclusion changed | `moduleId`, `relatedModuleId`, `relationshipTypeCode` | EWP, enrolment module |

---

## Enrolment and Finance Events (`srs.enrolment.*`, `srs.finance.*`)

| Subject | Version | Trigger | Key Payload Fields | Primary Consumers |
|---|---|---|---|---|
| `srs.enrolment.fee-liability-created` | 1.0 | Fee liability first calculated | `enrolmentId`, `personId`, `academicYear`, `feeAmount`, `fundingSource` | FIN, SLC |
| `srs.enrolment.fee-liability-updated` | 1.0 | Liability changes (status / intensity change) | `feeLiabilityId`, `enrolmentId`, `previousAmount`, `newAmount` | FIN, SLC |
| `srs.finance.payment-confirmed` | 1.0 | Payment confirmation received from Finance | `enrolmentId`, `paymentConfirmationId`, `amount`, `paymentSource` | EWP, Registry |

---

## Timetable, Attendance, and Exam Entry Events

| Subject | Version | Trigger | Key Payload Fields | Primary Consumers |
|---|---|---|---|---|
| `srs.timetable.published` | 1.0 | Finalised timetable received from TTB | `academicPeriodId`, `activityCount`, `publishedAt` | EWP, AM, VLE |
| `srs.attendance.record-received` | 1.0 | Attendance event received from AM | `enrolmentId`, `timetabledActivityId`, `statusCode`, `ukviRelevant` | Registry, UKVI compliance, BI |
| `srs.attendance.absence-alert-raised` | 1.0 | Absence alert received or generated | `enrolmentId`, `absenceAlertId`, `alertTypeCode`, `currentValue` | Personal tutor, Registry, UKVI compliance |
| `srs.exam.entry-created` | 1.0 | Exam entry sent to EXAMS | `examEntryId`, `enrolmentId`, `assessmentComponentId` | EXAMS |
| `srs.exam.timetable-published` | 1.0 | Final exam timetable / candidate number received from EXAMS | `examEntryId`, `enrolmentId`, `candidateNumber`, `scheduledStart` | EWP, Registry |
| `srs.exam.accommodation-distributed` | 1.0 | Exam accommodation distributed to EXAMS | `adjustmentId`, `examEntryId`, `targetSystem` | EXAMS |

---

## Exam Board Additions

| Subject | Version | Trigger | Key Payload Fields | Primary Consumers |
|---|---|---|---|---|
| `srs.exam-board.data-pack-superseded` | 1.0 | Board data pack regenerated after source data correction | `examBoardId`, `previousPackId`, `newPackId` | Registry, board members |
| `srs.exam-board.external-examiner-signed-off` | 1.0 | External examiner confirmation received | `examBoardId`, `examinerId`, `confirmedAt` | Exam board workflow |
| `srs.appeal.submitted` | 1.0 | Post-ratification appeal or correction workflow started | `postRatificationCaseId`, `enrolmentId`, `caseTypeCode` | Registry |
| `srs.appeal.resolved` | 1.0 | Appeal dismissed / upheld and closed | `postRatificationCaseId`, `enrolmentId`, `outcomeCode` | EWP, Registry, DW |

---

## Adjustment Additions

| Subject | Version | Trigger | Key Payload Fields | Primary Consumers |
|---|---|---|---|---|
| `srs.adjustment.distribution-failed` | 1.0 | Downstream adjustment distribution failed after all retries | `adjustmentId`, `targetSystem`, `attemptCount`, `lastError` | Integration dashboard, Registry |

---

## Regulatory Events (`srs.regulatory.*`)

| Subject | Version | Trigger | Key Payload Fields | Primary Consumers |
|---|---|---|---|---|
| `srs.regulatory.ucas-application-received` | 1.0 | UCAS application imported | `applicationId`, `personId`, `programmeId`, `ucasCycle` | Admissions workflow |
| `srs.regulatory.ucas-enrolment-confirmed` | 1.0 | Enrolment confirmation sent to UCAS | `personId`, `ucasPersonalId`, `programmeCode` | — |
| `srs.regulatory.ucas-withdrawal-notified` | 1.0 | Withdrawal / deferral / no-show sent to UCAS | `personId`, `notificationTypeCode`, `notifiedAt` | Audit / compliance |
| `srs.regulatory.hesa-return-generated` | 1.0 | HESA return generated for internal review | `hesaReturnId`, `academicYear`, `studentCount` | Registry |
| `srs.regulatory.hesa-return-submitted` | 1.0 | HESA return submitted | `hesaReturnId`, `submissionId`, `academicYear`, `submittedAt` | — |
| `srs.regulatory.hesa-return-accepted` | 1.0 | HESA acceptance received | `hesaReturnId`, `submissionId`, `acceptedAt` | — |
| `srs.regulatory.hesa-return-amended` | 1.0 | Submitted return amended | `hesaReturnId`, `amendmentNumber`, `amendedAt` | Registry, audit |
| `srs.regulatory.hesa-validation-report-received` | 1.0 | Validation report received from HESA | `hesaReturnId`, `errorCount`, `warningCount` | Registry |
| `srs.regulatory.hesa-ids-received` | 1.0 | HESA student identifiers received and stored | `processedCount`, `academicYear` | IAM, EWP |
| `srs.regulatory.slc-enrolment-confirmed` | 1.0 | SLC enrolment confirmation sent | `enrolmentId`, `personId`, `academicYear` | — |
| `srs.regulatory.slc-status-notified` | 1.0 | SLC notified of enrolment status change | `enrolmentId`, `personId`, `newStatus`, `notifiedAt` | — |
| `srs.regulatory.slc-entitlement-received` | 1.0 | Loan entitlement received from SLC | `enrolmentId`, `slcEntitlementId`, `tuitionFeeLoanAmount` | FIN, Registry |
| `srs.regulatory.slc-payment-status-received` | 1.0 | Payment status received from SLC | `enrolmentId`, `paymentTypeCode`, `statusCode`, `amount` | FIN, EWP |
| `srs.regulatory.slc-overpayment-notified` | 1.0 | Overpayment notice received from SLC | `enrolmentId`, `amount` | FIN, Registry |
| `srs.regulatory.ukvi-cas-created` | 1.0 | CAS reference assigned and issued | `enrolmentId`, `personId`, `casReference`, `createdAt` | EWP |
| `srs.regulatory.ukvi-visa-status-updated` | 1.0 | Visa grant / refusal / curtailment received from UKVI | `personId`, `visaStatusId`, `statusCode`, `expiryDate` | Registry, UKVI compliance |
| `srs.regulatory.ukvi-compliance-alert` | 1.0 | Attendance threshold breach detected | `enrolmentId`, `personId`, `thresholdType`, `currentValue`, `thresholdValue` | WELL (early warning), Registry |
| `srs.regulatory.ukvi-sponsor-action-reported` | 1.0 | Sponsor compliance report sent to UKVI | `ukviComplianceCaseId`, `enrolmentId`, `reportedAt` | Registry, audit |

---

## Enterprise Integration Events

| Subject | Version | Trigger | Key Payload Fields | Primary Consumers |
|---|---|---|---|---|
| `srs.iam.account-state-received` | 1.0 | IAM account lock / credential update received | `personId`, `accountStateCode` | Registry, EWP |
| `srs.edrms.document-archived` | 1.0 | EDRMS archive confirmation received | `studentDocumentId`, `edrmsReference`, `archivedAt` | Registry, DPO |
| `srs.bi.risk-flag-received` | 1.0 | BI at-risk flag received | `enrolmentId`, `riskFlagId`, `flagTypeCode`, `severityCode` | Personal tutor, Registry |
| `srs.data-quality.issue-received` | 1.0 | DW reconciliation / data quality issue received | `dataQualityIssueId`, `entityType`, `issueDescription` | Data administrators |
| `srs.staff-assignment.updated` | 1.0 | Tutor / supervisor assignment received from HR | `staffAssignmentId`, `enrolmentId`, `assignmentTypeCode`, `staffDisplayName` | EWP, Registry |
| `srs.research.milestone-recorded` | 1.0 | CRIS milestone received | `researchMilestoneId`, `enrolmentId`, `milestoneTypeCode`, `milestoneDate` | PGR student, Supervisor, Registry |

---

## Workflow Events (`srs.workflow.*`)

| Subject | Version | Trigger | Key Payload Fields | Primary Consumers |
|---|---|---|---|---|
| `srs.workflow.task-assigned` | 1.0 | A human task assigned to an actor | `workflowId`, `workflowType`, `taskType`, `assignedActorId`, `assignedActorRole`, `dueAt` | Notification service → EWP |
| `srs.workflow.task-completed` | 1.0 | Human task completed | `workflowId`, `taskType`, `completedByActorId`, `completedAt`, `outcome` | — |
| `srs.workflow.deadline-breached` | 1.0 | Workflow deadline passed without task completion | `workflowId`, `workflowType`, `taskType`, `escalatedToActorId` | Notification service |
| `srs.workflow.completed` | 1.0 | Workflow instance reached terminal state | `workflowId`, `workflowType`, `terminalState`, `completedAt` | DW (audit analytics) |

---

## Event Envelope

Every event uses this standard JSON envelope. Fields added during Phase 2 remediation are marked †.

```typescript
interface DomainEventEnvelope<T> {
  id:                 string;   // UUID v4 — unique event ID; idempotency key for consumers
  type:               string;   // e.g. "srs.student.enrolled"
  version:            string;   // Semver: "1.0.0"
  schemaRef:          string;   // † URI to the JSON Schema for this version
  tenantId:           string;   // UUID of the publishing tenant
  occurredAt:         string;   // ISO 8601 UTC — when the fact occurred in the real world
  publishedAt:        string;   // † ISO 8601 UTC — when the event was published
  validAt:            string;   // † ISO 8601 UTC — valid-time of the fact (may differ from occurredAt)
  correlationId:      string;   // UUID — traces the originating request/command
  causationId:        string;   // † UUID — the ID of the event or command that caused this event
  source:             string;   // "srs-core" / "wellbeing-module" / etc.
  dataClassification: string;   // † "standard" / "sensitive" / "special-category"
  payload:            T;        // Event-specific typed payload
}
```

`id` doubles as the **idempotency key**: consumers use it to detect and suppress duplicate deliveries (e.g. after a retry). Consumers should store processed event IDs and discard re-delivered events with a known ID.

`causationId` chains events: if event B was caused by event A, `causationId` on B = `id` of A. This is distinct from `correlationId` (which traces the original user request across all events it caused).

`dataClassification` allows consumers to enforce special-category and sensitive-data handling policies without inspecting payload content.

---

## Event Schema Versioning

Event schemas are defined as TypeScript types in `packages/domain/src/events/` and compiled to JSON Schema for NATS message validation and `schemaRef` resolution.

```
packages/domain/src/events/
├── admissions/
│   ├── application-received.v1.ts
│   └── offer-accepted.v1.ts
├── student/
│   ├── enrolled.v1.ts
│   ├── status-changed.v1.ts
│   └── hold-applied.v1.ts
├── catalogue/
│   └── programme-updated.v1.ts
├── enrolment/
│   └── fee-liability-created.v1.ts
├── assessment/
│   ├── mark-received.v1.ts
│   └── module-result-ratified.v1.ts
├── exam-board/
│   ├── ratified.v1.ts
│   └── external-examiner-signed-off.v1.ts
├── adjustment/
│   ├── approved.v1.ts
│   └── distributed.v1.ts
├── regulatory/
│   ├── hesa-return-submitted.v1.ts
│   └── ukvi-visa-status-updated.v1.ts
└── index.ts              # Barrel export of all event types and envelope type
```

Breaking changes produce a new file (`enrolled.v2.ts`) and dual-publish both versions during the deprecation window. Consumers declare their supported version in the plugin registry; the Core publishes to both versions until the old version is retired.
