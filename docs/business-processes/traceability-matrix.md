# Business Process Traceability Matrix

> Status: Initial working crosswalk
> Last updated: 2026-11-16

This matrix connects business outcomes to current Revelation design. It records alignment and gaps; it does not imply that current implementation defines sector practice.

P0 findings have detailed [functional requirements and ADR mappings](p0-requirements-and-adr-traceability.md).

Data findings BPR-D01–BPR-D19 have a completed [logical/physical delta assessment](../architecture/business-process-data-model-delta.md).

## Implementation coverage

> Checked: 2026-11-16, against the running app and the code. `npm run check:process-coverage` keeps this table complete.

How far each academic-journey process (areas 01–06) can be carried out in the app. **On screen**: staff (and, where it applies, students) can do it in the admin or portal. **Partly built**: useful implementation exists but part of the process is manual or missing. **API only**: complete in the API with no screen. **Not built**: no service. **On screen (simulated link)**: usable on screen, with the external party reached by manual file or an in-repo simulator until a live link is agreed (Phase 3 D-14). The [gap-closure plan](../product/academic-journey-gap-closure-plan.md) schedules the rest.

| Coverage | Processes |
|---|---|
| On screen | 43 |
| On screen (simulated link) | 5 |
| Partly built | 1 |
| API only | 0 |
| Not built | 0 |

| Process | Coverage | Staff screen | Student portal | Gap |
|---|---|---|---|---|
| [BP-01-001](01-recruitment-and-admissions/bp-01-001-receive-an-application.md) Receive an application | On screen | Applications worklist and application page | — | UCAS adapter feeds applications; no applicant view |
| [BP-01-002](01-recruitment-and-admissions/bp-01-002-assess-an-application.md) Assess an application | On screen | Application page: assessments, recommendation | — | Safeguarding concern blocks an offer recommendation |
| [BP-01-003](01-recruitment-and-admissions/bp-01-003-make-and-manage-an-offer.md) Make and manage an offer | On screen (simulated link) | Application page: decision, offer change and withdrawal; UCAS page: Decisions for UCAS (queue, send, reconciliation) | — | Decisions on UCAS applications queue with the decision and go by manual file or the in-repo simulator (D-14, D-15); a live UCAS link is a deployment adapter |
| [BP-01-004](01-recruitment-and-admissions/bp-01-004-confirm-offer-conditions.md) Confirm offer conditions | On screen (simulated link) | Application page: condition evidence with UCAS match outcomes, bulk confirmation of conditions the results meet, decisions, confirmation | — | UCAS results are matched only to structured conditions; free text is suggested for review and nothing is decided automatically (D-15); embargoed results wait for results day |
| [BP-01-005](01-recruitment-and-admissions/bp-01-005-create-and-assign-a-cas.md) Create and assign a CAS | On screen (simulated link) | Application page: Student visa card; UKVI page CAS tab: eligibility, preparation, approval by another officer, SMS export file, CAS number; student record CAS tab | — | One CAS record on `cas_case` (D-16); SMS is reached by manual file (D-14); conversion waits for the CAS |
| [BP-01-006](01-recruitment-and-admissions/bp-01-006-place-an-applicant-through-clearing.md) Place an applicant through Clearing | On screen | Clearing: take a call to a verbal or unconditional offer in one step; next-day review list; Applications pages for the resulting application | — | Fast path only inside the window and for listed programmes, never with a safeguarding, conviction, fitness-to-practise or visa need (D-13); the window and programme list are set in tenant configuration, with no screen yet |
| [BP-01-007](01-recruitment-and-admissions/bp-01-007-convert-an-accepted-applicant-to-a-prospective-student-record.md) Convert an accepted applicant to a prospective student record | On screen | Application page: Enrolment card creates the enrolment from the confirmed offer and completes the hand-off task | — | The enrolment starts in pre-registration (D-10); converting again returns the same enrolment |
| [BP-02-001](02-registration-and-student-status/bp-02-001-prepare-initial-registration.md) Prepare a student for initial registration | On screen | Application page: Enrolment card; Registration: initial registration periods invite pre-registration students | Registration | Required declarations and in-person steps are not modelled (institution to confirm, D-10) |
| [BP-02-002](02-registration-and-student-status/bp-02-002-verify-identity-and-right-to-study.md) Verify identity, nationality and right to study | On screen | Identity tab: verification checks and Right to study (basis, method, expiry, referral and decision); Registration checks worklist | Registration: share a View and Prove code when blocked | Right to study is its own outcome and blocks initial registration (D-17); expiry warnings and UKVI alerts come from the worker's daily scan |
| [BP-02-003](02-registration-and-student-status/bp-02-003-complete-initial-academic-registration.md) Complete initial academic registration | On screen | Registration: initial period worklist and assisted registration; student record Enrolments tab | Registration: accept the terms and register, which moves the enrolment to enrolled | The accepted terms version is recorded; other declarations are not |
| [BP-02-004](02-registration-and-student-status/bp-02-004-complete-financial-registration.md) Complete financial registration | On screen (simulated link) | Enrolments tab: Fees and financial registration (status per year, fee-status reassessment); Registration checks worklist | Enrolment page: fees | Finance is reached through the F-SIS-FIN-01 delivery flow and F-FIN-SIS-01 updates (D-14, D-18); only a tuition hold can block, and only if the institution chooses |
| [BP-02-005](02-registration-and-student-status/bp-02-005-activate-access-and-entitlements.md) Activate student access and entitlements | On screen (simulated link) | Student record, Other systems: Access and entitlements (latest instruction per flow); Operations: delivery tasks | — | Study access follows status; the account (F-SIS-IAM-01) follows conversion, status and leaver closure plus a grace period (D-19); IAM is reached by the delivery ledger (D-14) |
| [BP-02-006](02-registration-and-student-status/bp-02-006-transfer-programme-route-or-mode.md) Transfer programme, route or mode | On screen | Status cases worklist and case page; Status changes tab | Enrolment page: request a transfer | Needs destination-programme support to approve |
| [BP-02-007](02-registration-and-student-status/bp-02-007-interrupt-or-suspend-studies.md) Interrupt or suspend studies | On screen | Status cases (interruption, suspension) | Enrolment page: request an interruption | Funding and Student-visa notices before requesting |
| [BP-02-008](02-registration-and-student-status/bp-02-008-return-from-interruption.md) Return from interruption | On screen | Status cases (return, with return conditions) | Enrolment page: request a return | Offered only after an approved interruption |
| [BP-02-009](02-registration-and-student-status/bp-02-009-withdraw-from-studies.md) Withdraw from studies | On screen | Status cases (withdrawal) | Enrolment page: request a withdrawal | Sponsored students need UKVI compliance advice before a decision |
| [BP-02-010](02-registration-and-student-status/bp-02-010-complete-annual-re-registration.md) Complete annual re-registration | On screen | Registration: open a period, follow who has registered, register a student on their behalf (with a reason), close the period | Registration: accept the current terms and register | Confirmation is blocked until the previous year's results are ratified; fee debt does not block (D-8); closing lapses unregistered students |
| [BP-02-011](02-registration-and-student-status/bp-02-011-resolve-failure-to-register.md) Resolve failure to register or re-register | On screen | Registration → Students who did not register: contact attempts, written statement, referral, non-registration decision; status cases for the resulting withdrawal | — | Non-registration opens a withdrawal that another person approves (D-9); last engagement is entered by staff because attendance is a separate module |
| [BP-02-012](02-registration-and-student-status/bp-02-012-close-leaver-record.md) Close a leaver record and entitlements | On screen | Status cases (leaver closure, closure items); Access and entitlements | — | An approved closure ends the institutional account after the grace period (30 days after withdrawal, 90 after graduation, configurable), unless another enrolment is in progress |
| [BP-03-001](03-curriculum-and-module-registration/bp-03-001-import-and-publish-curriculum-data.md) Import and publish curriculum data to the SRS | On screen | Curriculum publications list and review, with a notice when a publication affects bound students | — | Programmes, modules, routes, rule sets with groups and members, learning outcomes and offerings in one atomic unit (D-22); what students are bound to cannot be closed, and changing it needs a rationale and a curriculum-binding approver; a person cannot apply a publication they entered |
| [BP-03-002](03-curriculum-and-module-registration/bp-03-002-assign-programme-route-and-rules.md) Assign a programme route and rule set | On screen | Programme rules; student record Credit & exceptions: bound rule set and changing it; approvals page for programme approvers | — | A change of programme or mode goes through a transfer |
| [BP-03-003](03-curriculum-and-module-registration/bp-03-003-select-modules.md) Select modules | On screen | Module selection proposals | Module selection | No timetable-clash, joint-honours or selection-window rules |
| [BP-03-004](03-curriculum-and-module-registration/bp-03-004-validate-and-approve-module-selection.md) Validate and approve module selection | On screen | Module selection proposals: approval | — | Applies approved credit and rule exceptions; no ranked allocation |
| [BP-03-005](03-curriculum-and-module-registration/bp-03-005-change-module-registration.md) Change a module registration | On screen | Registration requests | My modules: add and withdraw requests | — |
| [BP-03-006](03-curriculum-and-module-registration/bp-03-006-provision-confirmed-registrations.md) Provision confirmed registrations downstream | Partly built | Integration operations (exchange status) | — | Confirmed registrations reach the VLE (F-SIS-VLE-01); nothing provisions timetabling |
| [BP-03-007](03-curriculum-and-module-registration/bp-03-007-establish-pgr-supervision.md) Establish PGR supervision and research context | On screen | PGR supervision | Enrolment page: supervision | — |
| [BP-04-001](04-learning-engagement-and-support/bp-04-001-record-attendance-and-academic-engagement-evidence.md) Record attendance and academic engagement evidence | On screen | Engagement | — | — |
| [BP-04-002](04-learning-engagement-and-support/bp-04-002-investigate-and-respond-to-non-engagement.md) Investigate and respond to non-engagement | On screen | Engagement cases | — | — |
| [BP-04-003](04-learning-engagement-and-support/bp-04-003-review-pgr-progress-and-milestones.md) Review PGR progress and milestones | On screen | PGR progress review | Enrolment page: milestones | — |
| [BP-04-004](04-learning-engagement-and-support/bp-04-004-manage-a-reasonable-adjustment-case.md) Manage a reasonable adjustment case | On screen | Adjustment cases; student record Wellbeing tab | Adjustments | No independent review of the case workflow yet |
| [BP-04-005](04-learning-engagement-and-support/bp-04-005-manage-exceptional-circumstances.md) Manage exceptional circumstances | On screen | Student record: exceptional circumstances | Circumstances | — |
| [BP-04-006](04-learning-engagement-and-support/bp-04-006-distribute-an-approved-support-outcome.md) Distribute an approved support outcome | On screen | Operations: adjustment and delivery tasks | — | — |
| [BP-05-001](05-assessment-and-results/bp-05-001-establish-assessment-structures.md) Establish assessment structures | On screen | Assessment structures: components, weightings, pass marks, durations | — | Reusable assessment patterns (`assessment_pattern`) have no service or API; components cannot change once marks exist (except duration) |
| [BP-05-002](05-assessment-and-results/bp-05-002-create-examination-entries-and-accommodations.md) Create examination entries and accommodations | On screen | Exam timings; exam board: exam entries | Exams | — |
| [BP-05-003](05-assessment-and-results/bp-05-003-receive-or-enter-marks.md) Receive or enter marks | On screen | Student record Assessment tab: marks | Results | — |
| [BP-05-004](05-assessment-and-results/bp-05-004-moderate-and-confirm-marks.md) Moderate and confirm marks | On screen | Moderation | — | — |
| [BP-05-005](05-assessment-and-results/bp-05-005-determine-a-module-result.md) Determine a module result | On screen | Student record Assessment tab: module results | Results | Rule-version explanation incomplete |
| [BP-05-006](05-assessment-and-results/bp-05-006-investigate-academic-misconduct.md) Investigate academic misconduct | On screen | Student record: Misconduct tab | — | Effects on individual marks are API only |
| [BP-05-007](05-assessment-and-results/bp-05-007-prepare-an-exam-board-and-data-pack.md) Prepare an exam board and data pack | On screen | Exam board page: data pack | — | Pack hash and rule manifest not populated |
| [BP-05-008](05-assessment-and-results/bp-05-008-complete-external-examiner-review.md) Complete external examiner review | On screen | Exam board page: external examiner sign-off | — | — |
| [BP-05-009](05-assessment-and-results/bp-05-009-ratify-and-publish-results.md) Ratify and publish results | On screen | Exam board page: ratify | Results | — |
| [BP-05-010](05-assessment-and-results/bp-05-010-submit-and-examine-a-pgr-thesis.md) Submit and examine a PGR thesis | On screen | PGR examination | Enrolment page | — |
| [BP-05-011](05-assessment-and-results/bp-05-011-correct-a-ratified-academic-outcome.md) Correct a ratified academic outcome | On screen | Student record Corrections tab | — | Before and after version references not populated |
| [BP-06-001](06-progression-awards-and-graduation/bp-06-001-determine-progression.md) Determine progression | On screen | Awards tab: Progression | — | Ratified years are locked |
| [BP-06-002](06-progression-awards-and-graduation/bp-06-002-manage-reassessment-referral-or-repeat-study.md) Manage reassessment, referral or repeat study | On screen | Awards tab: reassessment plans | — | Plans are created at ratification (D-12); due dates need a reassessment period in the calendar |
| [BP-06-003](06-progression-awards-and-graduation/bp-06-003-determine-and-confer-an-award.md) Determine and confer an award | On screen | Awards tab: recommend and confer | — | — |
| [BP-06-004](06-progression-awards-and-graduation/bp-06-004-issue-award-documentation-and-hear.md) Issue award documentation and HEAR | On screen | Awards tab: documents (signed PDF download, two-person revocation); Verify a document (code, or name and date of birth with consent) | Award documents: download the signed PDF | Rendered and signed (D-20); public verification by code or file without an account (D-21); templates are neutral built-ins |
| [BP-06-005](06-progression-awards-and-graduation/bp-06-005-determine-graduation-eligibility-and-attendance.md) Determine graduation eligibility and attendance | On screen | Graduation cycles and cycle page | Graduation | — |
| [BP-06-006](06-progression-awards-and-graduation/bp-06-006-record-successful-pgr-completion.md) Record successful PGR completion | On screen | PGR completion | Enrolment page | — |

## Domain crosswalk

Principal integration flows are summarised by system pair below; see the [Enterprise Reference Model](../reference/revelation-student-records-reference-model.md) for the specific `F-<FROM>-<TO>-<nn>` identifiers each pair covers.

| BP range | Domain | Existing workflows | Principal system pairs | Principal data areas | Initial finding |
|---|---|---|---|---|---|
| BP-01-001–BP-01-007 | Recruitment and admissions | W001, W012 | CRM↔SIS, OIV↔SIS, UCAS↔SIS, UKVI↔SIS | `student_application`, `admissions_offer`, identity and CAS entities | W001 requires decomposition |
| BP-02-001–BP-02-012 | Registration and status | W001, W007, W010, W012 | LIB↔SIS, FIN↔SIS, EWP↔SIS, AM↔SIS, VLE↔SIS, IAM↔SIS, UCAS↔SIS, HESA↔SIS, SLC↔SIS, UKVI↔SIS | identity, enrolment, fee, hold, re-registration and compliance entities | Transfer/return/closure coverage incomplete |
| BP-03-001–BP-03-007 | Curriculum and modules | None complete | CM↔SIS, TTB↔SIS, AM←SIS, VLE↔SIS, SETS←SIS, HR→SIS, CRIS↔SIS, RP↔SIS | programme, route, module, registration, staff and research entities | No durable module-registration or PGR setup workflow |
| BP-04-001–BP-04-006 | Learning, engagement and support | W002, W003, W009 | AM↔SIS, BI↔SIS, WELL↔SIS, VLE←SIS, EXAMS↔SIS | attendance, engagement, adjustment, EC and research milestones | PGR progress absent from workflow catalogue |
| BP-05-001–BP-05-011 | Assessment and results | W004, W005, W006 | VLE→SIS, EXAMS↔SIS, WELL→SIS, EXAMBOARD↔SIS, EXTEX↔SIS/EXAMBOARD, AI↔SIS | assessment, marks, results, boards, misconduct and amendment entities | W005 spans several business outcomes |
| BP-06-001–BP-06-006 | Progression, awards and graduation | W005, W011 | EWP←SIS, EDRMS↔SIS, DW←SIS | progression, award, document and research completion data | PGR completion only partially represented |
| BP-07-001–BP-07-008 | Regulatory/statutory | W008, W009, W012 | HESA↔SIS, SLC↔SIS, UKVI↔SIS, OfS←SIS | HESA, SLC, CAS/visa/compliance and extracts | Scotland/Wales/NI regulator/funder contracts absent |
| BP-08-001–BP-08-006 | Record governance | W006 partial | EDRMS↔SIS, DW→SIS, affected entity contracts | identity, bitemporal versions, audit, documents | DSAR, rights and retention workflows absent |

## Pilot detailed crosswalk

| Process | Workflow | Requirements | Entities | Events | Contracts | Alignment/gap |
|---|---|---|---|---|---|---|
| BP-02-010 Complete annual re-registration | W010 | ENR-003, ENR-005, ENR-008–ENR-010; REG-001–REG-007 where coupled | `enrolment`, `reenrolment_period`, `reenrolment_confirmation`, `person_identity`, `student_address`, `student_contact_method`, `fee_liability`, `student_hold`, `slc_notification`, `integration_exchange` | `srs.student.re-enrolled` is published on confirmation; `srs.enrolment.fee-liability-updated` remains in the not-implemented event backlog | `portal-self-service-update.v1`, `finance-fee-liability.v1`, `slc-enrolment-exchange.v1`, `iam-account-provisioning.v1`, `vle-course-provisioning.v1`, `library-access-entitlement.v1` | Current W010 provides a state skeleton; national/student-mode variations, acknowledgement/reconciliation and non-registration outcome need more detail |

## Registration and student-status wave

| Process | Workflow alignment | Principal data | Principal integrations | Material Revelation finding |
|---|---|---|---|---|
| BP-02-001 Prepare initial registration | W001 partial | Person, application, offer, obligations | Admissions, UCAS, IAM | Explicit registration-case/worklist is absent |
| BP-02-002 Verify identity/right to study | W001/W012 partial | Identity check, visa and sponsor evidence | Online ID Verification, UKVI | Identity and immigration outcomes require separate controls |
| BP-02-003 Initial academic registration | W001 | Enrolment, route, terms/declarations | Portal, admissions/UCAS | Accepted terms version/channel are not modelled |
| BP-02-004 Financial registration | W001 partial | Fee liability, payment/hold and funding refs | Finance, SLC | Academic and financial registration states are not explicit |
| BP-02-005 Activate access/entitlements | W001 partial | Account/access and exchange ledger | IAM, Library, VLE, attendance, portal | No canonical entitlement matrix/core-ready threshold |
| BP-02-006 Transfer programme/route/mode | Gap | Enrolment versions, credit/rules, fees/CAS | Curriculum, Finance, SLC, UKVI and services | No complete workflow or specific transfer event |
| BP-02-007 Interrupt/suspend studies | W007 partial | Enrolment, conditions, dates, liability | Finance, SLC, UKVI and services | W007 lacks evidence/approval/return-condition detail |
| BP-02-008 Return from interruption | Gap | Enrolment, return plan, curriculum/modules | Finance, SLC, UKVI and services | No durable return workflow |
| BP-02-009 Withdraw | W007 partial | Enrolment, academic history, liability | Finance, SLC, UKVI, IAM, services | Voluntary/institutional routes and date authority need separation |
| BP-02-011 Resolve non-registration | W010→W007 gap | Case/evidence, registration and enrolment status | Communications, SLC, UKVI, services | Missing investigation/decision stage before withdrawal |
| BP-02-012 Close leaver record | W007/W011 partial | Closure worklist, documents, retention, exchanges | All entitlement/regulatory systems, EDRMS | No durable per-target closure workflow |

## Curriculum, module-registration and PGR-supervision wave

| Process | Workflow alignment | Principal data | Principal integrations | Material Revelation finding |
|---|---|---|---|---|
| BP-03-001 Import and publish curriculum | Gap | Programme, route, module, offering and rule-set versions | Curriculum management, metrics and timetabling | No atomic publication/version workflow or protection for assigned cohorts |
| BP-03-002 Assign route and rules | W001 partial | Enrolment, route/rule-set binding and recognised credit | Curriculum and admissions | No explicit effective route/rule-set assignment with decision provenance |
| BP-03-003 Select modules | Gap | Selection proposal, preferences and candidate modules | Portal and curriculum | Current model lacks a durable proposed-selection state |
| BP-03-004 Validate and approve selection | Gap | Validation outcomes, approvals, exceptions and registration | Portal, curriculum and timetabling capacity | Current service creates `registered` immediately; approval, waitlist and exception states are absent |
| BP-03-005 Change registration | Gap | Add/drop request, effective registration versions and impact decision | Portal, finance, timetabling, VLE and attendance | No atomic substitution/change approval or assessment-impact guard |
| BP-03-006 Provision registrations | Gap | Registration and per-target exchange state | Timetabling, VLE and attendance | No general per-target acknowledgement/reconciliation ledger for provisioning |
| BP-03-007 Establish PGR supervision | Gap | Supervision case, `staff_assignment` and research context | HR, CRIS and Research Proposals | Inbound staff assignment does not model nomination, academic approval or initial working arrangements |

## Remaining-wave architecture findings

| BP range | Detailed decomposition now documented | Principal new/extended records indicated | Highest-impact Revelation gap |
|---|---|---|---|
| BP-01-001–BP-01-007 | Application intake, assessment, offer, confirmation, CAS, Clearing and conversion | Received application payload, assessment, condition evidence, CAS case, Clearing permission and conversion ledger | W001 combines distinct decisions and does not preserve every source/authority boundary |
| BP-04-001–BP-04-006 | Engagement evidence/intervention, PGR review, adjustments, exceptional circumstances and distribution | Expected engagement event/evidence, intervention, PGR review/panel, scoped support outcome and distribution ledger | Specialist evidence, SRS outcome and regulatory decision are not consistently separated |
| BP-05-001–BP-05-011 | Assessment setup, entry, marking, moderation, calculation, misconduct, boards, external review, ratification, PGR examination and correction | Assessment-pattern version, candidate attempt, mark-set/moderation, board snapshot/decision, thesis examination and amendment case | W005 is too broad to demonstrate rule-version binding, decision authority and immutable ratification |
| BP-06-001–BP-06-006 | Progression, reassessment, award, documents, ceremony and PGR completion | Progression explanation, repeat-study plan, award recommendation/conferment, document instance and PGR closure | Recommendation, conferment, documentation and ceremony status need separate lifecycles |
| BP-07-001–BP-07-008 | HESA, student finance, sponsor, OfS, SFC, Medr, DfE and quality correction | Collection specification/snapshot, field lineage, submission/sign-off, response and data-quality issue | Devolved regulator/funder contracts and reproducible submission evidence are absent |
| BP-08-001–BP-08-006 | Identity resolution, correction, access, rights, retention/disposal and audit | Identity-resolution case, bitemporal correction, rights case, restriction marker, hold/disposal certificate and audit review | Cross-system governance actions lack durable workflow and reconciliation coverage |

## Coverage controls

Before SME approval:

- every W001–W012 workflow must map to at least one BP page;
- every reference-model flow (all 69, plus the locally added `F-SIS-OFS-01`) must map to at least one BP page or carry an exclusion rationale;
- every core student entity must have creation, material change, correction and closure/retention coverage;
- each national regulator/funder boundary must have an owned process or explicit out-of-scope decision; and
- PGR lifecycle gaps must be resolved or explicitly deferred.
