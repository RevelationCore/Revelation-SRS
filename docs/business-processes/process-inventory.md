# Business Process Inventory

> Status: Working baseline
> Last updated: 2026-07-26
> Identifier state: Stable working identifiers; all inventory pages drafted

This inventory is broader than the existing durable workflow catalogue. A process is included when its outcome creates, changes, validates, consumes, reports, or governs material student record data.

## Prioritisation

- **P1** — regulatory, high data-model impact, or critical cross-system hand-off.
- **P2** — core lifecycle capability or material institutional variation.
- **P3** — supporting/governance process with lower transaction volume or urgency.

## 01 — Recruitment and admissions

| ID | Process | Priority | Principal record impact | Existing workflow | Status |
|---|---|---:|---|---|---|
| [BP-001](01-recruitment-and-admissions/bp-001-receive-an-application.md) | Receive an application | P1 | Create application and applicant identity | W001 | Draft |
| [BP-002](01-recruitment-and-admissions/bp-002-assess-an-application.md) | Assess an application | P2 | Record assessment and decision evidence | W001 | Draft |
| [BP-003](01-recruitment-and-admissions/bp-003-make-and-manage-an-offer.md) | Make and manage an offer | P1 | Create/change offer and response | W001 | Draft |
| [BP-004](01-recruitment-and-admissions/bp-004-confirm-offer-conditions.md) | Confirm offer conditions | P1 | Record evidence and confirmation outcome | W001 | Draft |
| [BP-005](01-recruitment-and-admissions/bp-005-create-and-assign-a-cas.md) | Create and assign a CAS | P1 | Create CAS request/assignment and sponsor evidence | W012 | Draft |
| [BP-006](01-recruitment-and-admissions/bp-006-place-an-applicant-through-clearing.md) | Place an applicant through Clearing | P2 | Change application/offer and UCAS status | W001 partial | Draft |
| [BP-007](01-recruitment-and-admissions/bp-007-convert-an-accepted-applicant-to-a-prospective-student-record.md) | Convert an accepted applicant to a prospective student record | P1 | Resolve identity and create registration precursor | W001 | Draft |

## 02 — Registration and student status

| ID | Process | Priority | Principal record impact | Existing workflow | Status |
|---|---|---:|---|---|---|
| [BP-008](02-registration-and-student-status/bp-008-prepare-initial-registration.md) | Prepare a student for initial registration | P1 | Create obligations and registration eligibility | W001 | Draft |
| [BP-009](02-registration-and-student-status/bp-009-verify-identity-and-right-to-study.md) | Verify identity, nationality and right to study | P1 | Record verification and immigration evidence | W001/W012 | Draft |
| [BP-010](02-registration-and-student-status/bp-010-complete-initial-academic-registration.md) | Complete initial academic registration | P1 | Create enrolment and accept current terms | W001 | Draft |
| [BP-011](02-registration-and-student-status/bp-011-complete-financial-registration.md) | Complete financial registration | P1 | Create fee liability/payment arrangement state | W001 | Draft |
| [BP-012](02-registration-and-student-status/bp-012-activate-access-and-entitlements.md) | Activate student access and entitlements | P1 | Publish status to IAM, library, VLE and portal | W001 | Draft |
| [BP-013](02-registration-and-student-status/bp-013-transfer-programme-route-or-mode.md) | Transfer programme, route or mode | P1 | Version enrolment/programme/fee/CAS facts | No complete workflow | Draft |
| [BP-014](02-registration-and-student-status/bp-014-interrupt-or-suspend-studies.md) | Interrupt or suspend studies | P1 | Change enrolment status and downstream entitlement | W007 partial | Draft |
| [BP-015](02-registration-and-student-status/bp-015-return-from-interruption.md) | Return from interruption | P1 | Reinstate/update enrolment and entitlements | No complete workflow | Draft |
| [BP-016](02-registration-and-student-status/bp-016-withdraw-from-studies.md) | Withdraw from studies | P1 | End enrolment and report downstream consequences | W007 partial | Draft |
| [BP-017](02-registration-and-student-status/bp-017-complete-annual-re-registration.md) | Complete annual re-registration | P1 | Create annual confirmation; continue enrolment | W010 | Draft |
| [BP-018](02-registration-and-student-status/bp-018-resolve-failure-to-register.md) | Resolve failure to register or re-register | P1 | Escalate, suspend, or close enrolment | W010 partial | Draft |
| [BP-019](02-registration-and-student-status/bp-019-close-leaver-record.md) | Close a leaver record and entitlements | P2 | Close obligations/access and archive outputs | W007/W011 partial | Draft |

## 03 — Curriculum and module registration

| ID | Process | Priority | Principal record impact | Existing workflow | Status |
|---|---|---:|---|---|---|
| [BP-020](03-curriculum-and-module-registration/bp-020-import-and-publish-curriculum-data.md) | Import and publish curriculum data to the SRS | P1 | Version programmes, modules and rules | None | Draft |
| [BP-021](03-curriculum-and-module-registration/bp-021-assign-programme-route-and-rules.md) | Assign a programme route and rule set | P1 | Bind student/cohort to effective rules | W001 partial | Draft |
| [BP-022](03-curriculum-and-module-registration/bp-022-select-modules.md) | Select modules | P1 | Create proposed module registrations | None | Draft |
| [BP-023](03-curriculum-and-module-registration/bp-023-validate-and-approve-module-selection.md) | Validate and approve module selection | P1 | Confirm/hold/reject module registrations | None | Draft |
| [BP-024](03-curriculum-and-module-registration/bp-024-change-module-registration.md) | Change a module registration | P1 | Version module registration and liabilities | None | Draft |
| [BP-025](03-curriculum-and-module-registration/bp-025-provision-confirmed-registrations.md) | Provision confirmed registrations downstream | P1 | Publish rosters/entitlements to VLE, timetable and attendance | None | Draft |
| [BP-026](03-curriculum-and-module-registration/bp-026-establish-pgr-supervision.md) | Establish PGR supervision and research context | P2 | Create staff assignment/research profile | None | Draft |

## 04 — Learning, engagement and support

| ID | Process | Priority | Principal record impact | Existing workflow | Status |
|---|---|---:|---|---|---|
| [BP-027](04-learning-engagement-and-support/bp-027-record-attendance-and-academic-engagement-evidence.md) | Record attendance and academic engagement evidence | P1 | Append attendance and engagement facts | W009 partial | Draft |
| [BP-028](04-learning-engagement-and-support/bp-028-investigate-and-respond-to-non-engagement.md) | Investigate and respond to non-engagement | P1 | Create alert/case and possible status action | W009 | Draft |
| [BP-029](04-learning-engagement-and-support/bp-029-review-pgr-progress-and-milestones.md) | Review PGR progress and milestones | P2 | Version research milestone/progress outcome | None | Draft |
| [BP-030](04-learning-engagement-and-support/bp-030-manage-a-reasonable-adjustment-case.md) | Manage a reasonable adjustment case | P1 | Receive approved adjustment outcome | W002 | Draft |
| [BP-031](04-learning-engagement-and-support/bp-031-manage-exceptional-circumstances.md) | Manage exceptional circumstances | P1 | Receive determination and board visibility | W003 | Draft |
| [BP-032](04-learning-engagement-and-support/bp-032-distribute-an-approved-support-outcome.md) | Distribute an approved support outcome | P1 | Create per-system distribution status | W002/W003 partial | Draft |

## 05 — Assessment and results

| ID | Process | Priority | Principal record impact | Existing workflow | Status |
|---|---|---:|---|---|---|
| [BP-033](05-assessment-and-results/bp-033-establish-assessment-structures.md) | Establish assessment structures | P1 | Create components/patterns and rules | None | Draft |
| [BP-034](05-assessment-and-results/bp-034-create-examination-entries-and-accommodations.md) | Create examination entries and accommodations | P1 | Create entry/candidate/accommodation facts | W005 partial | Draft |
| [BP-035](05-assessment-and-results/bp-035-receive-or-enter-marks.md) | Receive or enter marks | P1 | Create mark/submission evidence | W005 partial | Draft |
| [BP-036](05-assessment-and-results/bp-036-moderate-and-confirm-marks.md) | Moderate and confirm marks | P1 | Version confirmed marks and approvals | W005 partial | Draft |
| [BP-037](05-assessment-and-results/bp-037-determine-a-module-result.md) | Determine a module result | P1 | Create module result and reassessment outcome | W005 partial | Draft |
| [BP-038](05-assessment-and-results/bp-038-investigate-academic-misconduct.md) | Investigate academic misconduct | P1 | Record governed case outcome and penalty effect | W004 | Draft |
| [BP-039](05-assessment-and-results/bp-039-prepare-an-exam-board-and-data-pack.md) | Prepare an exam board and data pack | P1 | Snapshot candidate/decision evidence | W005 | Draft |
| [BP-040](05-assessment-and-results/bp-040-complete-external-examiner-review.md) | Complete external examiner review | P1 | Append review/sign-off | W005 | Draft |
| [BP-041](05-assessment-and-results/bp-041-ratify-and-publish-results.md) | Ratify and publish results | P1 | Lock results/decisions and publish outcomes | W005 | Draft |
| [BP-042](05-assessment-and-results/bp-042-submit-and-examine-a-pgr-thesis.md) | Submit and examine a PGR thesis | P2 | Record submission, examiners, viva and outcome | None | Draft |
| [BP-043](05-assessment-and-results/bp-043-correct-a-ratified-academic-outcome.md) | Correct a ratified academic outcome | P1 | Authorised amendment and re-lock | W006 | Draft |

## 06 — Progression, awards and graduation

| ID | Process | Priority | Principal record impact | Existing workflow | Status |
|---|---|---:|---|---|---|
| [BP-044](06-progression-awards-and-graduation/bp-044-determine-progression.md) | Determine progression | P1 | Create governed progression decision | W005 partial | Draft |
| [BP-045](06-progression-awards-and-graduation/bp-045-manage-reassessment-referral-or-repeat-study.md) | Manage reassessment, referral or repeat study | P1 | Create next-attempt/registration eligibility | W005/W010 partial | Draft |
| [BP-046](06-progression-awards-and-graduation/bp-046-determine-and-confer-an-award.md) | Determine and confer an award | P1 | Create and ratify award | W011 | Draft |
| [BP-047](06-progression-awards-and-graduation/bp-047-issue-award-documentation-and-hear.md) | Issue award documentation and HEAR | P2 | Create/version issued document facts | W011 | Draft |
| [BP-048](06-progression-awards-and-graduation/bp-048-determine-graduation-eligibility-and-attendance.md) | Determine graduation eligibility and attendance | P2 | Record ceremony eligibility/choice | W011 | Draft |
| [BP-049](06-progression-awards-and-graduation/bp-049-record-successful-pgr-completion.md) | Record successful PGR completion | P2 | Close research candidature and confer award | W011 partial | Draft |

## 07 — Regulatory and statutory reporting

| ID | Process | Priority | Principal record impact | Existing workflow | Status |
|---|---|---:|---|---|---|
| [BP-050](07-regulatory-and-statutory-reporting/bp-050-prepare-and-submit-hesa-student-data.md) | Prepare and submit HESA student data | P1 | Snapshot, validate, submit and reconcile data | W008 | Draft |
| [BP-051](07-regulatory-and-statutory-reporting/bp-051-exchange-registration-attendance-and-changes-with-student-finance-bodies.md) | Exchange registration, attendance and changes with student finance bodies | P1 | Record confirmations/notifications and responses | W001/W007/W010 | Draft |
| [BP-052](07-regulatory-and-statutory-reporting/bp-052-manage-student-sponsor-reporting-and-compliance.md) | Manage Student sponsor reporting and compliance | P1 | Record CAS, engagement and circumstance reports | W009/W012 | Draft |
| [BP-053](07-regulatory-and-statutory-reporting/bp-053-produce-ofs-regulatory-extracts.md) | Produce OfS regulatory extracts | P1 England | Create reproducible regulatory extracts | No durable workflow | Draft |
| [BP-054](07-regulatory-and-statutory-reporting/bp-054-produce-scottish-funding-council-returns.md) | Produce Scottish Funding Council returns | P1 Scotland | Create/submit Scottish funding data | None | Draft |
| [BP-055](07-regulatory-and-statutory-reporting/bp-055-produce-medr-regulatory-and-funding-returns.md) | Produce Medr regulatory and funding returns | P1 Wales | Create/submit Welsh regulatory/funding data | None | Draft |
| [BP-056](07-regulatory-and-statutory-reporting/bp-056-produce-department-for-the-economy-returns.md) | Produce Department for the Economy returns | P1 Northern Ireland | Create/submit NI regulatory/funding data | None | Draft |
| [BP-057](07-regulatory-and-statutory-reporting/bp-057-resolve-a-statutory-submission-data-quality-issue.md) | Resolve a statutory submission data-quality issue | P1 | Correct source fact or submission and resubmit | W008 partial | Draft |

## 08 — Record governance and lifecycle

| ID | Process | Priority | Principal record impact | Existing workflow | Status |
|---|---|---:|---|---|---|
| [BP-058](08-record-governance-and-lifecycle/bp-058-resolve-a-duplicate-or-uncertain-identity.md) | Resolve a duplicate or uncertain identity | P1 | Link/merge identities with provenance | None | Draft |
| [BP-059](08-record-governance-and-lifecycle/bp-059-correct-personal-or-enrolment-data.md) | Correct personal or enrolment data | P1 | Add authorised effective/transaction-time version | W006 partial | Draft |
| [BP-060](08-record-governance-and-lifecycle/bp-060-fulfil-a-data-subject-access-request.md) | Fulfil a data subject access request | P2 | Search, review, disclose and audit personal data | None | Draft |
| [BP-061](08-record-governance-and-lifecycle/bp-061-assess-restriction-rectification-or-erasure-rights.md) | Assess restriction, rectification or erasure rights | P2 | Record decision and propagate approved action | None | Draft |
| [BP-062](08-record-governance-and-lifecycle/bp-062-retain-archive-and-dispose-of-student-records.md) | Retain, archive and dispose of student records | P1 | Apply schedule, legal holds and disposal evidence | None | Draft |
| [BP-063](08-record-governance-and-lifecycle/bp-063-audit-access-and-material-record-changes.md) | Audit access and material record changes | P2 | Review immutable access/change evidence | None | Draft |

## Known inventory gaps requiring SME review

- Fitness to study and fitness to practise outcomes.
- Collaborative provision, validation partners and franchise data exchanges.
- Apprenticeship-specific records and ILR interaction.
- Credit transfer, recognition of prior learning and incoming/outgoing mobility.
- Degree apprenticeships and professional/statutory body reporting.
- Student complaints and OIA completion-of-procedures hand-off.
- Deceased-student record handling.
- PGR annual progression, interruption, thesis restriction and corrections variants.
- Nation-specific funding processes below the level of the four umbrella return pages.

These are not excluded. They remain explicit discovery items before the inventory is baselined.
