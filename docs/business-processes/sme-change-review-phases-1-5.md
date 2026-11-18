# SME Change Review: Phases 1 to 5 of the Academic Journey Plan

> Status: Submitted for review, 2026-11-18; reviewers awaiting nomination
> Context: [Academic journey gap-closure plan](../product/academic-journey-gap-closure-plan.md); register: [SME review register](sme-review-register.md)
> Prepared by: the project, from the phase decision records. Nobody has reviewed this yet, and nothing here is approved.

This pack asks subject-matter experts to review what changed in each process during Phases 1 to 5 of the gap-closure plan. Each batch lists the processes changed, what changed (with the decision and the commits that built it), how to see it in the demo, and every question the institution must answer, with the default the software uses until it does. The reviewer's response column is for the reviewer: the project does not fill it in.

Approval is recorded in the [SME review register](sme-review-register.md), not here. Under the Phase 5 decisions (D-45), submitting this pack is the review exit for Phase 5; approval is the institution's, and comes later.

`npm run check:review-pack` fails if a decision has an "Institution must confirm" item that is missing from this pack.

## R1: Phase 1: screens for the API-only processes

**Processes changed:** BP-02-002, BP-02-006 to BP-02-009, BP-02-012, BP-03-001, BP-05-006, BP-06-001, BP-06-004, BP-06-005.

**Decisions:** [Phase 1 decisions](../decisions/phase-1-gap-closure-decisions.md). **Commits:** bd033bf, d5a6ae0.

**What changed:**

- **D-1:** Retire the direct enrolment status change.
- **D-2:** Students request interruption, return, withdrawal and transfer.
- **D-3:** Progression lives on the Awards tab.
- **D-4:** Documents and graduation.
- **D-5:** Misconduct outcomes have their own permissions.
- **D-6:** Identity verification has its own read permission.
- **D-7:** A manual curriculum publication is applied by someone else.

**See it in the demo:** Sign in to the admin app as registry; open a student and request an interruption from the Status tab (a second registry user decides); open the Awards tab to see progression and award documents.

| Decision | Question for the institution | Software default until answered | Configuration | Reviewer response |
|---|---|---|---|---|
| D-1 | At least two people hold `status-case:decide`. | As the decision describes | — |  |
| D-2 | The wording of the funding and visa notices; whether students may request a transfer at all. | As the decision describes | — |  |
| D-4 | Whether revocation should need a second approver (Phase 3). | As the decision describes | — |  |
| D-5 | Which roles see misconduct history. | As the decision describes | — |  |
| D-6 | Who may mark a check fraud-flagged. | As the decision describes | — |  |

## R2: Phase 2: the processes that did not exist

**Processes changed:** BP-01-006, BP-01-007, BP-02-001, BP-02-010, BP-02-011, BP-03-002, BP-06-002.

**Decisions:** [Phase 2 decisions](../decisions/phase-2-gap-closure-decisions.md). **Commits:** 328ccaf, 730e3d8, 4e1ab98, 4fb5dff, 8b20c80, 8104754.

**What changed:**

- **D-8:** Annual re-registration (BP-02-010).
- **D-9:** Failure to register (BP-02-011).
- **D-10:** Initial registration and applicant conversion (BP-02-001, BP-01-007).
- **D-11:** Changing one student's curriculum binding (BP-03-002).
- **D-12:** Reassessment plans at ratification (BP-06-002).
- **D-13:** Clearing (BP-01-006).

**See it in the demo:** In the portal, Alice registers for the year from Registration; in the admin app, run Failure to register for the period, make a Clearing call, and ratify a board to see its reassessment plans.

| Decision | Question for the institution | Software default until answered | Configuration | Reviewer response |
|---|---|---|---|---|
| D-8 | Whether a financial hold blocks academic registration (the CMA's 2015 guidance warns against academic sanctions for non-tuition debts); the wording of the terms. | As the decision describes | — |  |
| D-9 | The contact period and channels, the review or appeal route, and what its regulations call the outcome. | As the decision describes | — |  |
| D-10 | The declarations required at registration, and anything that must be completed in person. | As the decision describes | — |  |
| D-11 | Who approves pathway changes. | As the decision describes | — |  |
| D-12 | Referral or resit terminology, whether a repeated stage is capped, and attempt limits. | As the decision describes | — |  |
| D-13 | Who holds `clearing:decide`, the published Clearing criteria, and the verbal-offer hold period. | As the decision describes | — |  |

## R3: Phase 3: integrations and outputs

**Processes changed:** BP-01-003, BP-01-004, BP-01-005, BP-02-002, BP-02-004, BP-02-005, BP-03-001, BP-06-004.

**Decisions:** [Phase 3 decisions](../decisions/phase-3-gap-closure-decisions.md). **Commits:** 9abdc65, aba9426, a70eec9, 2291043, 7f05eca, 8fc08d9.

**What changed:**

- **D-14:** What "done" means for a party we cannot reach.
- **D-15:** UCAS outbound decisions and results mapped to conditions (BP-01-003, BP-01-004).
- **D-16:** One CAS record (BP-01-005).
- **D-17:** Right to study as its own outcome (BP-02-002).
- **D-18:** Financial registration (BP-02-004).
- **D-19:** Access and entitlements follow status, then leaver closure (BP-02-005).
- **D-20:** Rendering and signing award documents (BP-06-004).
- **D-21:** Third-party verification without an account.
- **D-22:** Curriculum publication beyond programmes and modules (BP-03-001).

**See it in the demo:** From an application, make a decision and see it queued for UCAS; prepare and approve a CAS with two people; issue a signed transcript and verify it at /public/v1/verify without signing in.

| Decision | Question for the institution | Software default until answered | Configuration | Reviewer response |
|---|---|---|---|---|
| D-14 | Its UCAS, SMS, Finance and IAM link agreements and test environments, and who runs manual file transfers. | As the decision describes | — |  |
| D-15 | The UCAS link type and the code crosswalk per cycle; who may bulk-confirm; the near-miss and changed-course policy. | As the decision describes | `ucas.outbound.transport` |  |
| D-16 | At least two people hold CAS permissions; the sponsor licence scope; the guidance version in force. | As the decision describes | — |  |
| D-17 | Its scope policy; accepted methods, including remote checks; who may refer and decide ineligibility. | As the decision describes | — |  |
| D-18 | Its fee-status assessment policy and appeal route, and whether any tuition hold is used. | As the decision describes | `registration.financialHoldBlocks` |  |
| D-19 | Its grace periods, alumni email policy, and whether open complaints or OIA cases keep access. | As the decision describes | — |  |
| D-20 | Who owns the signing key, rotation and compromise procedure; the template content (signatories, crest, wording); whether a qualified certificate is wanted. | As the decision describes | — |  |
| D-21 | The lawful basis and privacy-notice wording; whether to join HEDD. | As the decision describes | `documents.publicVerification.discloseFacts`, `documents.publicVerification.enabled` |  |
| D-22 | Which system masters each object type; who approves corrections that affect students. | As the decision describes | — |  |

## R4: Phase 4: rule depth in module selection and status

**Processes changed:** BP-02-006, BP-03-002, BP-03-003, BP-03-004, BP-03-006, BP-06-002.

**Decisions:** [Phase 4 decisions](../decisions/phase-4-gap-closure-decisions.md). **Commits:** 6eb1796, 3078b06, 8c8ef7f, 31ec985, a0aadf2, 101643a, c6b3c4a, 88a2774, 927cff1, bf3d3e2.

**What changed:**

- **D-23:** Which rule types are selection rules, and how the exit is checked.
- **D-24:** Timetable data model, source and refresh (BP-03-006, BP-03-004 step 3).
- **D-25:** What counts as a clash, and advisory versus blocking.
- **D-26:** Provisioning registrations to timetabling (F-SIS-TTB-01, BP-03-006).
- **D-27:** Subject areas and joint-honours balance.
- **D-28:** Repeat-module requirement.
- **D-29:** Selection windows.
- **D-30:** Ranked preference allocation for oversubscribed offerings.
- **D-31:** Reduced-intensity study.
- **D-32:** Transfer credit mapping (credit transfer and RPL).
- **D-33:** Which rule types join ENROLMENT_RULE_FIELDS.
- **D-34:** Migrations.

**See it in the demo:** Open Selection windows and a ranked window's Module allocation; preview, submit and (as another person) approve a run; in the portal, check a selection against the timetable.

| Decision | Question for the institution | Software default until answered | Configuration | Reviewer response |
|---|---|---|---|---|
| D-24 | Its timetabling system and export, how often it publishes (daily is recommended during selection windows), and who uploads files. | As the decision describes | `timetabling.staleAfterHours` |  |
| D-25 | Advisory or blocking for each programme, which activity types count, and the tolerance. | As the decision describes | — |  |
| D-26 | Events, snapshots or both; how often to reconcile; the service-level agreement. | As the decision describes | — |  |
| D-27 | Its subject areas, the bounds for each combination and year, and how unassigned modules are treated. | As the decision describes | — |  |
| D-28 | Its replacement policy, any cap on repeat credit, whether repeat credit counts towards the load and towards funding, and the scope of a repeat stage. | As the decision describes | — |  |
| D-29 | Window dates for each cohort or level, the resubmission period, and who may submit late. | As the decision describes | `moduleSelection.windowEnforcement` |  |
| D-30 | Its priority tiers, whether a lottery is acceptable, how many alternatives students must give, how long allocated places are held, and who runs and who approves a run. | As the decision describes | — |  |
| D-31 | Its allowed intensities, the pro-rata rule, whether fees are recalculated mid-year, and with its HESA team how a mid-session change is returned. | As the decision describes | — |  |
| D-32 | Its RPL cap, whether final-stage credit can be recognised, and whether same-module marks carry across a transfer. | As the decision describes | — |  |
| D-33 | Who approves exceptions to each rule. | As the decision describes | — |  |

## R5: Phase 5: evidence and governed outcomes

**Processes changed:** BP-04-005, BP-05-005, BP-05-007, BP-05-009, BP-05-011, BP-06-001, BP-06-002, BP-06-003, BP-02-011.

**Decisions:** [Phase 5 decisions](../decisions/phase-5-gap-closure-decisions.md). **Commits:** e1fcca0, 7dfcdb8, 391e04f, aec92b3, a507e52.

**What changed:**

- **D-35:** Every calculation records the rule versions it used.
- **D-36:** Data pack hash, rule manifest, decisions that cite the hash, verification.
- **D-37:** Before and after version references on corrections, and the correction time fix.
- **D-41:** Exceptional-circumstances outcomes go through a governed determination (BP-04-005).
- **D-42:** Working-day calendar for statutory deadlines.
- **D-43:** Two small blockers.
- **D-44:** The independent professional review of the adjustments workflow (BP-04-004).
- **D-45:** SME review of Phases 1–4, and splitting the Phase 5 exit.
- **D-46:** The objective re-rating test.
- **D-47:** Migration.

**See it in the demo:** On a student's results, open "How this was calculated"; on an exam board, verify the data pack and ratify through a decision on it; propose an EC outcome and decide it as another person; import bank holidays on the Working-day calendar.

| Decision | Question for the institution | Software default until answered | Configuration | Reviewer response |
|---|---|---|---|---|
| D-35 | Whether built-in defaults are acceptable in production (recommended: `refuse`); its pass mark, classification boundaries and algorithm; which award-credit and discretion-zone rules apply. | As the decision describes | `rules.builtInDefaults` |  |
| D-36 | That a board must re-decide after any pack regeneration; whether rule drift should block a decision. | As the decision describes | `examBoard.pack.blockOnRuleDrift` |  |
| D-41 | Who decides EC (panel or delegated officer). | As the decision describes | — |  |
| D-42 | Its division and closure days, and the UKVI working-day interpretation. | As the decision describes | `calendar.bankHolidays.source`, `calendar.division` |  |
| D-43 | None beyond the cap value already in the plan. | As the decision describes | — |  |
| D-44 | A named disability-service practitioner and a DPO as reviewers, and their outcome. | As the decision describes | — |  |
| D-45 | Nominations for every register role, and each batch's outcome. | As the decision describes | — |  |

## R6: Phase 5: self-service audiences

**Processes changed:** BP-01-003, BP-01-004, BP-03-007, BP-04-003, BP-05-010.

**Decisions:** [Phase 5 decisions](../decisions/phase-5-gap-closure-decisions.md). **Commits:** 4ad71d8, 6029afb, d0ca934.

**What changed:**

- **D-38:** Who can sign in to the portal: binding, roles and account provisioning.
- **D-39:** Applicant portal view (BP-01-003, BP-01-004).
- **D-40:** PGR supervisor, review panel and examiner views (BP-03-007, BP-04-003, BP-05-010).

**See it in the demo:** Sign in to the portal as Dee (applicant, direct) to accept an offer and upload evidence, and as Uma (UCAS) to see the UCAS Hub notice; sign in as Helena Cross (supervisor) and David Okonkwo (external examiner) to see the Research pages.

| Decision | Question for the institution | Software default until answered | Configuration | Reviewer response |
|---|---|---|---|---|
| D-38 | That IAM will create applicant and guest accounts and set `srs_person_id`; whether federated sign-in is used for external examiners; that an HR feed creates person rows for staff. | As the decision describes | `access.applicantAccountEndDays`, `pgr.examinerAccess.graceDays` |  |
| D-39 | Whether its admissions CRM rather than the SRS is the applicant-facing channel; whether agent-channel applicants respond themselves; whether CAS numbers are shown; how long unsuccessful applicants keep accounts. | As the decision describes | `access.applicantAccountEndDays`, `admissions.applicantPortal.enabled`, `admissions.applicantPortal.readOnlyChannels` |  |
| D-40 | When reports are exchanged; whether supervisors may see examiner names; which staff hold `research-supervisor`; whether external examiners use federated or guest accounts. | As the decision describes | `pgr.examinerAccess.graceDays`, `pgr.examinerReports.exchange` |  |
