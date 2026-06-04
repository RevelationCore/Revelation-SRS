# Domain Event Taxonomy

> Status: Draft — Phase 2
> Last updated: 2026-06-04
> All events are published to NATS JetStream using the envelope defined in `integration-layer.md`. Subject names follow the pattern `srs.{domain}.{event-name}`. Payload schemas are versioned; breaking changes create a new version suffix.

---

## Student Lifecycle Events (`srs.student.*`)

| Subject | Version | Trigger | Key Payload Fields | Primary Consumers |
|---|---|---|---|---|
| `srs.student.created` | 1.0 | Student record created (from UCAS or direct) | `personId`, `studentNumber`, `sourceSystem`, `sourceReference` | IAM, CRM |
| `srs.student.identity-updated` | 1.0 | Personal data change (name, address, contact) | `personId`, `changedFields[]`, `effectiveDate` | IAM, EWP, LIB |
| `srs.student.enrolled` | 1.0 | Enrolment created and confirmed | `personId`, `enrolmentId`, `programmeId`, `academicYear`, `modeOfStudy`, `fundingSource` | VLE, IAM, LIB, FIN, CRM, AM, EWP |
| `srs.student.status-changed` | 1.0 | Enrolment status transition (intermission, withdrawal, suspension) | `personId`, `enrolmentId`, `previousStatus`, `newStatus`, `effectiveDate`, `reason` | VLE, IAM, LIB, FIN, SLC, UKVI, EWP |
| `srs.student.re-enrolled` | 1.0 | Annual re-enrolment confirmed | `personId`, `enrolmentId`, `academicYear` | VLE, IAM, EWP |
| `srs.student.graduated` | 1.0 | Award conferred and enrolment closed | `personId`, `enrolmentId`, `awardId`, `qualificationCode`, `classificationCode`, `awardDate` | IAM, EDRMS, EWP, CRM |

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

---

## Academic Integrity Events (`srs.misconduct.*`)

| Subject | Version | Trigger | Key Payload Fields | Primary Consumers |
|---|---|---|---|---|
| `srs.misconduct.outcome-recorded` | 1.0 | Misconduct outcome received from AI system | `enrolmentId`, `personId`, `outcomeCode`, `penaltyCode`, `effectiveDate` | EWP (notification to student), DW |

---

## Regulatory Events (`srs.regulatory.*`)

| Subject | Version | Trigger | Key Payload Fields | Primary Consumers |
|---|---|---|---|---|
| `srs.regulatory.hesa-return-submitted` | 1.0 | HESA annual return submitted | `submissionId`, `academicYear`, `studentCount`, `submittedAt` | — (internal audit) |
| `srs.regulatory.hesa-return-accepted` | 1.0 | HESA acceptance received | `submissionId`, `acceptedAt` | — |
| `srs.regulatory.hesa-ids-received` | 1.0 | HESA student identifiers received and stored | `processedCount`, `academicYear` | IAM, EWP |
| `srs.regulatory.slc-enrolment-confirmed` | 1.0 | SLC enrolment confirmation sent | `enrolmentId`, `personId`, `academicYear` | — |
| `srs.regulatory.slc-status-notified` | 1.0 | SLC notified of enrolment status change | `enrolmentId`, `personId`, `newStatus`, `notifiedAt` | — |
| `srs.regulatory.ukvi-cas-created` | 1.0 | CAS reference assigned | `enrolmentId`, `personId`, `casReference`, `createdAt` | EWP |
| `srs.regulatory.ukvi-compliance-alert` | 1.0 | Attendance threshold breach detected | `enrolmentId`, `personId`, `thresholdType`, `currentValue`, `thresholdValue` | Wellbeing (early warning) |
| `srs.regulatory.ucas-enrolment-confirmed` | 1.0 | Enrolment confirmation sent to UCAS | `personId`, `ucasPersonalId`, `programmeCode` | — |

---

## Workflow Events (`srs.workflow.*`)

| Subject | Version | Trigger | Key Payload Fields | Primary Consumers |
|---|---|---|---|---|
| `srs.workflow.task-assigned` | 1.0 | A human task assigned to an actor | `workflowId`, `workflowType`, `taskType`, `assignedActorId`, `assignedActorRole`, `dueAt` | Notification service → EWP |
| `srs.workflow.task-completed` | 1.0 | Human task completed | `workflowId`, `taskType`, `completedByActorId`, `completedAt`, `outcome` | — |
| `srs.workflow.deadline-breached` | 1.0 | Workflow deadline passed without task completion | `workflowId`, `workflowType`, `taskType`, `escalatedToActorId` | Notification service |
| `srs.workflow.completed` | 1.0 | Workflow instance reached terminal state | `workflowId`, `workflowType`, `terminalState`, `completedAt` | DW (audit analytics) |

---

## Event Schema Versioning

Event schemas are defined as TypeScript types in `packages/domain/src/events/` and compiled to JSON Schema for NATS message validation.

```
packages/domain/src/events/
├── student/
│   ├── enrolled.v1.ts
│   └── status-changed.v1.ts
├── assessment/
│   ├── mark-received.v1.ts
│   └── module-result-ratified.v1.ts
├── exam-board/
│   └── ratified.v1.ts
└── index.ts              # Barrel export of all event types
```

Breaking changes produce a new file (`enrolled.v2.ts`) and dual-publish both versions during the deprecation window. Consumers declare their supported version in the plugin registry; the Core publishes to both versions until the old version is retired.
