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
| [BP-01-001](01-recruitment-and-admissions/bp-01-001-receive-an-application.md) | Receive an application | P1 | Create application and applicant identity | W001 | Draft |
| [BP-01-002](01-recruitment-and-admissions/bp-01-002-assess-an-application.md) | Assess an application | P2 | Record assessment and decision evidence | W001 | Draft |
| [BP-01-003](01-recruitment-and-admissions/bp-01-003-make-and-manage-an-offer.md) | Make and manage an offer | P1 | Create/change offer and response | W001 | Draft |
| [BP-01-004](01-recruitment-and-admissions/bp-01-004-confirm-offer-conditions.md) | Confirm offer conditions | P1 | Record evidence and confirmation outcome | W001 | Draft |
| [BP-01-005](01-recruitment-and-admissions/bp-01-005-create-and-assign-a-cas.md) | Create and assign a CAS | P1 | Create CAS request/assignment and sponsor evidence | W012 | Draft |
| [BP-01-006](01-recruitment-and-admissions/bp-01-006-place-an-applicant-through-clearing.md) | Place an applicant through Clearing | P2 | Change application/offer and UCAS status | W001 partial | Draft |
| [BP-01-007](01-recruitment-and-admissions/bp-01-007-convert-an-accepted-applicant-to-a-prospective-student-record.md) | Convert an accepted applicant to a prospective student record | P1 | Resolve identity and create registration precursor | W001 | Draft |

## 02 — Registration and student status

| ID | Process | Priority | Principal record impact | Existing workflow | Status |
|---|---|---:|---|---|---|
| [BP-02-001](02-registration-and-student-status/bp-02-001-prepare-initial-registration.md) | Prepare a student for initial registration | P1 | Create obligations and registration eligibility | W001 | Draft |
| [BP-02-002](02-registration-and-student-status/bp-02-002-verify-identity-and-right-to-study.md) | Verify identity, nationality and right to study | P1 | Record verification and immigration evidence | W001/W012 | Draft |
| [BP-02-003](02-registration-and-student-status/bp-02-003-complete-initial-academic-registration.md) | Complete initial academic registration | P1 | Create enrolment and accept current terms | W001 | Draft |
| [BP-02-004](02-registration-and-student-status/bp-02-004-complete-financial-registration.md) | Complete financial registration | P1 | Create fee liability/payment arrangement state | W001 | Draft |
| [BP-02-005](02-registration-and-student-status/bp-02-005-activate-access-and-entitlements.md) | Activate student access and entitlements | P1 | Publish status to IAM, library, VLE and portal | W001 | Draft |
| [BP-02-006](02-registration-and-student-status/bp-02-006-transfer-programme-route-or-mode.md) | Transfer programme, route or mode | P1 | Version enrolment/programme/fee/CAS facts | No complete workflow | Draft |
| [BP-02-007](02-registration-and-student-status/bp-02-007-interrupt-or-suspend-studies.md) | Interrupt or suspend studies | P1 | Change enrolment status and downstream entitlement | W007 partial | Draft |
| [BP-02-008](02-registration-and-student-status/bp-02-008-return-from-interruption.md) | Return from interruption | P1 | Reinstate/update enrolment and entitlements | No complete workflow | Draft |
| [BP-02-009](02-registration-and-student-status/bp-02-009-withdraw-from-studies.md) | Withdraw from studies | P1 | End enrolment and report downstream consequences | W007 partial | Draft |
| [BP-02-010](02-registration-and-student-status/bp-02-010-complete-annual-re-registration.md) | Complete annual re-registration | P1 | Create annual confirmation; continue enrolment | W010 | Draft |
| [BP-02-011](02-registration-and-student-status/bp-02-011-resolve-failure-to-register.md) | Resolve failure to register or re-register | P1 | Escalate, suspend, or close enrolment | W010 partial | Draft |
| [BP-02-012](02-registration-and-student-status/bp-02-012-close-leaver-record.md) | Close a leaver record and entitlements | P2 | Close obligations/access and archive outputs | W007/W011 partial | Draft |

## 03 — Curriculum and module registration

| ID | Process | Priority | Principal record impact | Existing workflow | Status |
|---|---|---:|---|---|---|
| [BP-03-001](03-curriculum-and-module-registration/bp-03-001-import-and-publish-curriculum-data.md) | Import and publish curriculum data to the SRS | P1 | Version programmes, modules and rules | None | Draft |
| [BP-03-002](03-curriculum-and-module-registration/bp-03-002-assign-programme-route-and-rules.md) | Assign a programme route and rule set | P1 | Bind student/cohort to effective rules | W001 partial | Draft |
| [BP-03-003](03-curriculum-and-module-registration/bp-03-003-select-modules.md) | Select modules | P1 | Create proposed module registrations | None | Draft |
| [BP-03-004](03-curriculum-and-module-registration/bp-03-004-validate-and-approve-module-selection.md) | Validate and approve module selection | P1 | Confirm/hold/reject module registrations | None | Draft |
| [BP-03-005](03-curriculum-and-module-registration/bp-03-005-change-module-registration.md) | Change a module registration | P1 | Version module registration and liabilities | None | Draft |
| [BP-03-006](03-curriculum-and-module-registration/bp-03-006-provision-confirmed-registrations.md) | Provision confirmed registrations downstream | P1 | Publish rosters/entitlements to VLE, timetable and attendance | None | Draft |
| [BP-03-007](03-curriculum-and-module-registration/bp-03-007-establish-pgr-supervision.md) | Establish PGR supervision and research context | P2 | Create staff assignment/research profile | None | Draft |

## 04 — Learning, engagement and support

| ID | Process | Priority | Principal record impact | Existing workflow | Status |
|---|---|---:|---|---|---|
| [BP-04-001](04-learning-engagement-and-support/bp-04-001-record-attendance-and-academic-engagement-evidence.md) | Record attendance and academic engagement evidence | P1 | Append attendance and engagement facts | W009 partial | Draft |
| [BP-04-002](04-learning-engagement-and-support/bp-04-002-investigate-and-respond-to-non-engagement.md) | Investigate and respond to non-engagement | P1 | Create alert/case and possible status action | W009 | Draft |
| [BP-04-003](04-learning-engagement-and-support/bp-04-003-review-pgr-progress-and-milestones.md) | Review PGR progress and milestones | P2 | Version research milestone/progress outcome | None | Draft |
| [BP-04-004](04-learning-engagement-and-support/bp-04-004-manage-a-reasonable-adjustment-case.md) | Manage a reasonable adjustment case | P1 | Receive approved adjustment outcome | W002 | Draft |
| [BP-04-005](04-learning-engagement-and-support/bp-04-005-manage-exceptional-circumstances.md) | Manage exceptional circumstances | P1 | Receive determination and board visibility | W003 | Draft |
| [BP-04-006](04-learning-engagement-and-support/bp-04-006-distribute-an-approved-support-outcome.md) | Distribute an approved support outcome | P1 | Create per-system distribution status | W002/W003 partial | Draft |

## 05 — Assessment and results

| ID | Process | Priority | Principal record impact | Existing workflow | Status |
|---|---|---:|---|---|---|
| [BP-05-001](05-assessment-and-results/bp-05-001-establish-assessment-structures.md) | Establish assessment structures | P1 | Create components/patterns and rules | None | Draft |
| [BP-05-002](05-assessment-and-results/bp-05-002-create-examination-entries-and-accommodations.md) | Create examination entries and accommodations | P1 | Create entry/candidate/accommodation facts | W005 partial | Draft |
| [BP-05-003](05-assessment-and-results/bp-05-003-receive-or-enter-marks.md) | Receive or enter marks | P1 | Create mark/submission evidence | W005 partial | Draft |
| [BP-05-004](05-assessment-and-results/bp-05-004-moderate-and-confirm-marks.md) | Moderate and confirm marks | P1 | Version confirmed marks and approvals | W005 partial | Draft |
| [BP-05-005](05-assessment-and-results/bp-05-005-determine-a-module-result.md) | Determine a module result | P1 | Create module result and reassessment outcome | W005 partial | Draft |
| [BP-05-006](05-assessment-and-results/bp-05-006-investigate-academic-misconduct.md) | Investigate academic misconduct | P1 | Record governed case outcome and penalty effect | W004 | Draft |
| [BP-05-007](05-assessment-and-results/bp-05-007-prepare-an-exam-board-and-data-pack.md) | Prepare an exam board and data pack | P1 | Snapshot candidate/decision evidence | W005 | Draft |
| [BP-05-008](05-assessment-and-results/bp-05-008-complete-external-examiner-review.md) | Complete external examiner review | P1 | Append review/sign-off | W005 | Draft |
| [BP-05-009](05-assessment-and-results/bp-05-009-ratify-and-publish-results.md) | Ratify and publish results | P1 | Lock results/decisions and publish outcomes | W005 | Draft |
| [BP-05-010](05-assessment-and-results/bp-05-010-submit-and-examine-a-pgr-thesis.md) | Submit and examine a PGR thesis | P2 | Record submission, examiners, viva and outcome | None | Draft |
| [BP-05-011](05-assessment-and-results/bp-05-011-correct-a-ratified-academic-outcome.md) | Correct a ratified academic outcome | P1 | Authorised amendment and re-lock | W006 | Draft |

## 06 — Progression, awards and graduation

| ID | Process | Priority | Principal record impact | Existing workflow | Status |
|---|---|---:|---|---|---|
| [BP-06-001](06-progression-awards-and-graduation/bp-06-001-determine-progression.md) | Determine progression | P1 | Create governed progression decision | W005 partial | Draft |
| [BP-06-002](06-progression-awards-and-graduation/bp-06-002-manage-reassessment-referral-or-repeat-study.md) | Manage reassessment, referral or repeat study | P1 | Create next-attempt/registration eligibility | W005/W010 partial | Draft |
| [BP-06-003](06-progression-awards-and-graduation/bp-06-003-determine-and-confer-an-award.md) | Determine and confer an award | P1 | Create and ratify award | W011 | Draft |
| [BP-06-004](06-progression-awards-and-graduation/bp-06-004-issue-award-documentation-and-hear.md) | Issue award documentation and HEAR | P2 | Create/version issued document facts | W011 | Draft |
| [BP-06-005](06-progression-awards-and-graduation/bp-06-005-determine-graduation-eligibility-and-attendance.md) | Determine graduation eligibility and attendance | P2 | Record ceremony eligibility/choice | W011 | Draft |
| [BP-06-006](06-progression-awards-and-graduation/bp-06-006-record-successful-pgr-completion.md) | Record successful PGR completion | P2 | Close research candidature and confer award | W011 partial | Draft |

## 07 — Regulatory and statutory reporting

| ID | Process | Priority | Principal record impact | Existing workflow | Status |
|---|---|---:|---|---|---|
| [BP-07-001](07-regulatory-and-statutory-reporting/bp-07-001-prepare-and-submit-hesa-student-data.md) | Prepare and submit HESA student data | P1 | Snapshot, validate, submit and reconcile data | W008 | Draft |
| [BP-07-002](07-regulatory-and-statutory-reporting/bp-07-002-exchange-registration-attendance-and-changes-with-student-finance-bodies.md) | Exchange registration, attendance and changes with student finance bodies | P1 | Record confirmations/notifications and responses | W001/W007/W010 | Draft |
| [BP-07-003](07-regulatory-and-statutory-reporting/bp-07-003-manage-student-sponsor-reporting-and-compliance.md) | Manage Student sponsor reporting and compliance | P1 | Record CAS, engagement and circumstance reports | W009/W012 | Draft |
| [BP-07-004](07-regulatory-and-statutory-reporting/bp-07-004-produce-ofs-regulatory-extracts.md) | Produce OfS regulatory extracts | P1 England | Create reproducible regulatory extracts | No durable workflow | Draft |
| [BP-07-005](07-regulatory-and-statutory-reporting/bp-07-005-produce-scottish-funding-council-returns.md) | Produce Scottish Funding Council returns | P1 Scotland | Create/submit Scottish funding data | None | Draft |
| [BP-07-006](07-regulatory-and-statutory-reporting/bp-07-006-produce-medr-regulatory-and-funding-returns.md) | Produce Medr regulatory and funding returns | P1 Wales | Create/submit Welsh regulatory/funding data | None | Draft |
| [BP-07-007](07-regulatory-and-statutory-reporting/bp-07-007-produce-department-for-the-economy-returns.md) | Produce Department for the Economy returns | P1 Northern Ireland | Create/submit NI regulatory/funding data | None | Draft |
| [BP-07-008](07-regulatory-and-statutory-reporting/bp-07-008-resolve-a-statutory-submission-data-quality-issue.md) | Resolve a statutory submission data-quality issue | P1 | Correct source fact or submission and resubmit | W008 partial | Draft |

## 08 — Record governance and lifecycle

| ID | Process | Priority | Principal record impact | Existing workflow | Status |
|---|---|---:|---|---|---|
| [BP-08-001](08-record-governance-and-lifecycle/bp-08-001-resolve-a-duplicate-or-uncertain-identity.md) | Resolve a duplicate or uncertain identity | P1 | Link/merge identities with provenance | None | Draft |
| [BP-08-002](08-record-governance-and-lifecycle/bp-08-002-correct-personal-or-enrolment-data.md) | Correct personal or enrolment data | P1 | Add authorised effective/transaction-time version | W006 partial | Draft |
| [BP-08-003](08-record-governance-and-lifecycle/bp-08-003-fulfil-a-data-subject-access-request.md) | Fulfil a data subject access request | P2 | Search, review, disclose and audit personal data | None | Draft |
| [BP-08-004](08-record-governance-and-lifecycle/bp-08-004-assess-restriction-rectification-or-erasure-rights.md) | Assess restriction, rectification or erasure rights | P2 | Record decision and propagate approved action | None | Draft |
| [BP-08-005](08-record-governance-and-lifecycle/bp-08-005-retain-archive-and-dispose-of-student-records.md) | Retain, archive and dispose of student records | P1 | Apply schedule, legal holds and disposal evidence | None | Draft |
| [BP-08-006](08-record-governance-and-lifecycle/bp-08-006-audit-access-and-material-record-changes.md) | Audit access and material record changes | P2 | Review immutable access/change evidence | None | Draft |

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
