# Phase 2 Gap-Closure Decisions

> Status: Accepted
> Date: 2026-11-16
> Context: [Academic journey gap-closure plan](../product/academic-journey-gap-closure-plan.md), Phase 2 (build the missing processes)
> Made by: the project's solutions-architect agent (`.claude/agents/solutions-architect.md`), adopted for implementation. Numbering continues from [Phase 1](phase-1-gap-closure-decisions.md).

Each decision lists what an institution must confirm before go-live.

## D-8: Annual re-registration (BP-02-010)

**Decision.** Registry administrators (`registration-period:manage`) open a re-registration period for a year, optionally for one programme. Opening creates a pending confirmation for each `enrolled` enrolment that entered before that year, has not passed its expected end, and has none yet; it is idempotent, and re-running it adds students who became eligible. Intermitting and suspended students are excluded: their return case handles it.

In the portal the student sees their programme, route and mode (with a link to request a transfer if wrong), checks their personal details, and accepts the current terms, whose version (tenant setting `registration.terms-version`) is stored on the confirmation. They cannot confirm while their latest progression decision is unratified. There is no fee-debt block: the SRS holds no debt facts, so a pluggable registration-blocker provider (default: none) lets a finance connector add one under the institution's policy.

Registry may confirm on a student's behalf (`registration:confirm:assisted`), recording the channel, a reason from a value set and the terms version. Confirming does not change the enrolment status: the confirmation is the record of registration for the year. It creates the year's fee liability (at most one per enrolment and year) and publishes `srs.student.re-enrolled`. Registry closes the period explicitly after it ends; closing lapses every pending confirmation and opens a non-registration case (D-9). It never changes an enrolment.

**Institution must confirm.** Whether a financial hold blocks academic registration (the CMA's 2015 guidance warns against academic sanctions for non-tuition debts); the wording of the terms.

## D-9: Failure to register (BP-02-011)

**Decision.** Each lapsed confirmation opens a business case (`BP-02-011`, subject: the enrolment). Opening checks for an unratified progression decision, an open status case, an approved interruption or sponsorship, and marks the case for review if any applies. Contact attempts are recorded as evidence pointing at the communication sent.

It resolves one of three ways: a late assisted confirmation (`registered-late`); the student's own interruption or withdrawal request (`referred`); or a non-registration decision with a reason, policy version and effective date (defaulting to the period's close, never before the last recorded engagement). A non-registration decision opens an institution-initiated withdrawal status case, decided by someone else, so non-registration always takes two people. It is refused until at least two contact attempts are recorded and 14 days have passed since the first notice (both configurable), unless the student has confirmed in writing that they will not continue.

For a sponsored student, a lapse raises a regulatory-officer task at once, showing the deadline: UKVI requires a non-enrolment report within 10 working days of the enrolment period ending.

**Institution must confirm.** The contact period and channels, the review or appeal route, and what its regulations call the outcome.

**Implementation note (D-9).** No new table: the case is a `business_case` with process `BP-02-011` and the enrolment as subject. The lapsed confirmation, contact attempts and any written statement are `case_evidence_reference` rows (distinguished by `source_reference`), and the outcome is a `case_decision` (`registered-late`, `referred` or `non-registration`). The withdrawal status case points back at the decision through `institutional_outcome_ref = case-decision:<id>`. The "regulatory-officer task" is a UKVI compliance alert of type `non-enrolment`, the existing regulatory-officer worklist; the case shows the 10-working-day deadline. Bank holidays are not counted. Because engagement data lives in the attendance module, staff enter the last engagement date with the decision.

## D-10: Initial registration and applicant conversion (BP-02-001, BP-01-007)

**Decision.** The enrolment is created when registry completes the admissions hand-off task, not at offer confirmation, so identity, CAS and fee-status problems are caught first. The task shows the values derived from the confirmed offer and creates the enrolment in one action: the programme (or the alternative programme), mode, academic year of entry and start date from the intake. Completing it again returns the same enrolment.

The enrolment starts in a new status, `pre-registration`, which can move only to `enrolled` or `withdrawn`. It creates no fee liability, regulatory triggers or `srs.student.enrolled` event, and is excluded from HESA, SLC, delivery flows and "active student" logic until the student registers. The student registers through the same portal confirmation as D-8, in an initial registration period; confirming moves them to `enrolled`. A student who does not register follows D-9; one who never arrives can be withdrawn through a status case.

**Institution must confirm.** The declarations required at registration, and anything that must be completed in person.

## D-11: Changing one student's curriculum binding (BP-03-002)

**Decision.** A change of programme or mode goes only through a transfer status case. A route or rule-set change within the same programme needs a reason code and an effective date. A registry administrator makes it alone if nothing yet depends on the binding in the current year (no module registrations, no pending or approved selection proposal, no marks); otherwise a programme approver (`curriculum-binding:approve`) decides it, and never the proposer. Replacing a binding happens in one transaction.

Implementation note: the proposal and its decision are held in a `curriculum_binding_change` row (proposed, approved, rejected or applied directly), following the rule-exception pattern, because a business case has nowhere to hold the proposed binding.

**Institution must confirm.** Who approves pathway changes.

## D-12: Reassessment plans at ratification (BP-06-002)

**Decision.** Plans are created in the same transaction that ratifies the board and locks progression decisions. A resit decision gets one plan per failed module (the tenant's default type, default `referral`; a deferred result gets `deferral`); a repeat-year decision gets one `repeat-stage` plan. The mark cap comes from the resit-mark-cap rule, never for a deferral. Due date and period come from a reassessment period in the calendar if one exists; otherwise they stay empty and the plan is flagged as needing a date. A plan that would exceed the attempt limit is not created and is listed for the board instead. Ratification never creates a second plan for the same decision and module. Staff change a plan by cancelling it and creating a replacement.

**Institution must confirm.** Referral or resit terminology, whether a repeated stage is capped, and attempt limits.

## D-13: Clearing (BP-01-006)

**Decision.** A Clearing call creates a channel-neutral application on the `clearing` channel; a UCAS Clearing choice for the same applicant reconciles with it rather than creating a second one. While the tenant's Clearing window is open, and only for programmes listed as open in Clearing, a holder of `clearing:decide` (programme approvers and registry administrators) may assess, recommend and decide in one audited step, provided there is no safeguarding, conviction or fitness-to-practise concern, no CAS is needed, and a reason and call reference are recorded. Verbal offers are recorded as offers that expire after a set time (default 48 hours). Every fast-path decision is reviewed by a different programme approver the next working day; corrections go through an offer change with a reason.

**Institution must confirm.** Who holds `clearing:decide`, the published Clearing criteria, and the verbal-offer hold period.

## Risks recorded

1. `pre-registration` must not reach code that treats any non-withdrawn enrolment as a current student (regulatory returns, delivery, engagement, the portal): every status check is reviewed.
2. A pre-registration student logs in as a student; their portal access is limited to registration until they are enrolled.
3. The UKVI 10-working-day deadline is shorter than the default contact period, so the regulatory task shows the deadline.
4. The binding replacement was not atomic; it is fixed regardless of the screen.
5. Component weightings must not change once marks are locked after ratification.
6. A UCAS confirmation reversed after the enrolment exists is handled by an institution-initiated withdrawal from `pre-registration`, never by deleting the enrolment.
