# Pre-review: BP-02-011 and BP-02-012 (non-registration decision and leaver closure)

> Date: 2026-11-21
> Backlog item: BL-116
> Register row: BP-02-011–BP-02-012 in the [SME review register](../sme-review-register.md)
> Status: **AI pre-review.** This is not the institutional review or sign-off the register needs. Nothing here is approved, signed off or confirmed. A named registry, UKVI-compliance, records-management and data-protection reviewer must still review these pages.

## Header

**Items reviewed**

- [BP-02-011 Resolve failure to register or re-register](../02-registration-and-student-status/bp-02-011-resolve-failure-to-register.md)
- [BP-02-012 Close a leaver record](../02-registration-and-student-status/bp-02-012-close-leaver-record.md)
- What changed, from the [Phases 1–5 change review](../sme-change-review-phases-1-5.md) (R2 D-9, R3 D-19, R5 D-42) and the [Phase 2](../../decisions/phase-2-gap-closure-decisions.md), [Phase 3](../../decisions/phase-3-gap-closure-decisions.md) and [Phase 5](../../decisions/phase-5-gap-closure-decisions.md) decision records.
- What was built, from [current capabilities](../../product/current-capabilities.md) (`initial-annual-registration-and-status`), [ADR-016](../../decisions/ADR-016-authoritative-business-state-and-workflow-separation.md), [ADR-017](../../decisions/ADR-017-minimum-necessary-outcomes-and-restricted-evidence.md), [ADR-021](../../decisions/ADR-021-governed-identity-rights-retention-and-audit.md) and [core principles](../../core-principles.md) §18.
- The code:
  - `apps/api/src/platform/registration-periods/non-registration-service.ts` and `service.ts`;
  - `apps/api/src/platform/status-cases/status-case-service.ts` (leaver closure);
  - `apps/api/src/platform/delivery/producers/access.ts` and `apps/api/src/app.ts` (leaver-closure listener);
  - `apps/api/src/platform/privacy/rights-request-service.ts`;
  - `packages/db/src/schema/rights.ts` (`retention_schedule`, `retention_assignment`, `record_hold`);
  - `packages/db/migrations/0000_baseline.sql` (non-registration and status-case value sets);
  - `packages/domain/src/permissions.ts`.

**Roles taken:** UK HE academic registrar (registration and student status), UKVI Student sponsor compliance officer, records manager, and data-protection reviewer.

**Sources consulted**

| Source | Version or date read |
|---|---|
| UKVI, [Student sponsor guidance, Document 2: Sponsorship duties](https://www.gov.uk/government/publications/student-sponsor-guidance/sponsorship-duties-accessible) | Version 10/2026, for use from 8 October 2026. Paragraph 7.5, rows c, e, g, h and k. |
| OIA, [Completion of Procedures letter guidance](https://www.oiahe.org.uk/providers/completion-of-procedures-letters/completion-of-procedures-letter-guidance-note/when-should-providers-issue-a-completion-of-procedures-letter/) | Read through a search summary, 2026-11-21. |
| UK GDPR articles 5(1)(c) and 5(1)(e) | Read as at 2026-11-21. |
| [Source register](../source-register.md) | SRC-001 to SRC-003, SRC-010, SRC-013, SRC-020 to SRC-025, SRC-030 |

## Summary

BP-02-011 is built as D-9 describes and the core control is sound: every lapse opens a case, review flags hold back premature action, a sponsored student gets a UKVI task due in 10 working days (bank holidays excluded), a decision needs contact attempts and a notice period unless the student confirmed in writing, and it only opens a withdrawal case that someone else decides. The gaps are the outcome notice to the student and the last engagement date.

BP-02-012 is thinner. A leaver closure is a status case whose approval ends the IAM account after the grace period (D-19), but nothing opens it, its worklist is typed in by hand, and it assigns no retention class or hold.

**Findings:** 0 Blocker, 5 Major, 6 Minor, 3 Observations.

## Findings

| # | Severity | Process | What is wrong | Evidence | What to change |
|---|---|---|---|---|---|
| F1 | Major | 011 | The student is not told the non-registration decision, its reasons, effective date or review route (step 8); only contact attempts send portal notifications. The withdrawal that follows is not notified either (see the BP-02-006–009 pre-review, F12). | `decideNonRegistration` sends nothing; `notifications.deliver` only in `recordContact`. | Notify the student when the withdrawal is decided, with the reason, effective date, consequences and the configured review route; record the route on the decision. |
| F2 | Major | 011 | The last engagement date is optional and is thrown away after a check. The effective date defaults to the period close. For a continuing student who never came back, the funding and HESA end dates should reflect the last engagement, usually in the previous year. | `decideNonRegistration` (`non-registration-service.ts:208–232`). | Make `lastEngagementDate` required, store it on the decision, and pass it to the withdrawal case (see the BP-02-006–009 pre-review, F4). |
| F3 | Major | 012 | Nothing opens a leaver closure. No code creates a `leaver-closure` case after an approved withdrawal or an award conferment, so a withdrawn or graduated student keeps the limited account "until leaver closure" indefinitely, and no closure work is owned. | `leaver-closure` appears only in `status-case-service.ts`, `routes/status-cases.ts` and the `app.ts:536` listener. | Open a leaver-closure case automatically on approved withdrawal and on conferment. Add an ageing view of withdrawn and graduated enrolments with no closure. |
| F4 | Major | 012 | The closure worklist is not generated (step 1). Closure items are free-text conditions added by hand. Nothing derives items from funding (SLC), sponsorship (UKVI row g or h), open cases, pending assessments or exit awards, documents, debt, or active delivery flows. | `addCondition`; no derivation code. | When the case opens, generate closure items from these facts, each with an owner, and let the registry add more. |
| F5 | Major | 012 | Closure assigns no retention class and no hold (step 8). `retention_assignment` is written only by the rights-request service, and `record_hold` reasons (`litigation`, `foi-request`, `dsar-in-progress`, `audit`) have no appeal, complaint or OIA reason. UK GDPR art. 5(1)(e) and principle §18 need a defined retention period from the end of study. | `rights-request-service.ts:206`; `packages/db/src/schema/rights.ts:79–113`. | On closure approval, assign the `end-of-study` or `award-conferred` schedule to the student record and add appeal, complaint and OIA hold reasons. The records manager sets the schedules. |
| F6 | Minor | 011 | Two portal notifications satisfy the contact minimum. A student who has stopped signing in may never see them, and no off-portal channel is required. The address or endpoint used is not recorded. | `recordContact`; `policy()` counts attempts of any channel. | Add a setting requiring at least one off-portal channel (personal email or letter), and record the endpoint category used. |
| F7 | Minor | 011 | The notice period runs in calendar days from the first contact of any kind, not from a notice that states the deadline and the consequence. The default portal text says studies "may be ended" but gives no date. | `decisionAllowedFrom`; default message in `recordContact`. | Add a "final notice" contact type with a stated deadline, count the notice period from it, and put the date in the default text. |
| F8 | Minor | 011 | The review flags cover pending results, open status requests, approved interruption and sponsorship. They do not cover a disability-related barrier or a provider or system failure (step 2, A2), and there is no "provider-caused extension" outcome. | `#flags`; outcomes `registered-late`, `referred`, `non-registration`. | Add a flag for an active adjustment plan (yes or no only, ADR-017) and an extension outcome that reopens the registration without counting as late. |
| F9 | Minor | 011 | A non-registration decision that turns out to be wrong cannot be undone once the withdrawal is approved, because `withdrawn` is terminal (see the BP-02-006–009 pre-review, F11). | `ALLOWED_TRANSITIONS`. | Covered by the reinstatement case proposed there. |
| F10 | Minor | 012 | Whether an open complaint, appeal or OIA case keeps the account (D-19) is not modelled, and the grace period counts from the closure decision rather than the leaving date, so a late closure gives a longer grace. | `access.ts:115–129`. | Hold the account end while a flagged case is open; decide with the institution whether grace counts from the decision or the effective date. |
| F11 | Minor | 012 | Final documents (step 6) and a pending exit award (A2) are not prompted or linked from the closure. | No link from leaver closure to documents or awards. | Include them as generated closure items (F4). |
| O1 | Observation | 011 | For a continuing student the 10-working-day deadline is taken from row c (non-enrolment in the enrolment period). For continuing students, rows e (stopped engaging) or g (withdrawal) may be the better fit. | `ukviReportDueBy`; Doc 2 7.5. | The compliance lead confirms which row applies. |
| O2 | Observation | 011 | A referral to the student's own interruption or withdrawal request closes the case but leaves the UKVI `non-enrolment` alert open. That is safer than resolving it, but the compliance officer must close it by hand. | `refer()`; `#resolveUkviAlert` only on late registration. | None, or link the alert to the referred case. |
| O3 | Observation | 012 | The account sent to IAM is the most generous level across the person's current enrolments, so closing one enrolment does not lock out a student on another. Closure has separation of duties and is blocked while items are open. | `access.ts:78–88`; `decide()`. | None. |

## Open questions

| ID | Question | Proposed answer | Confidence | Owner who must decide |
|---|---|---|---|---|
| BP-02-011 OQ-1 | Add a durable non-registration investigation workflow between W010 and W007? | **Propose closing: built.** Each lapse opens a `business_case` with process BP-02-011 (D-9). Contact attempts and written statements are case evidence, the outcome is a `case_decision`, and a non-registration decision opens an institution-initiated withdrawal case for a second person. It is business state, not a Temporal workflow (ADR-016). The admin worklist exists. | High | Registry product owner |
| BP-02-011 OQ-2 | Canonical status taxonomy for lapsed, non-registered, excluded and presumed withdrawn? | **Close the model; the labels stay with the institution.** Keep one terminal enrolment status, `withdrawn`, and distinguish the outcome by reason code: `non-registration` (seeded), `non-engagement` for presumed withdrawal, `conduct` or `academic` for exclusion. The confirmation's `lapsed` is a registration state, not an enrolment status. The institution's regulations name each outcome (D-9 asks this), and the codes need a crosswalk to the HESA reason field. | Medium | Academic Registrar (labels) with the data owner |
| BP-02-011 OQ-3 | Which communication evidence must Revelation retain? | **Stays open.** Proposed default: for each attempt, the channel, the endpoint category (personal email, term address, phone, portal), the date and time, the sender, the template and version or the text sent, and any delivery outcome. Keep it with the status decision under the student-record retention class (F5). Do not keep call recordings or the student's wider correspondence. | Medium | DPO with the Academic Registrar |
| BP-02-012 OQ-1 | Introduce a durable closure workflow and entitlement policy matrix? | **Close the matrix part; the closure workflow part becomes new work.** The matrix is decided and built (D-19: study access follows status; the account ends at closure plus `access.graceDays`, 30 days after withdrawal and 90 after graduation). Closure is a `leaver-closure` status case rather than a new workflow, which is adequate, but it must open automatically, generate its items and assign retention (F3 to F5). | Medium | Integration owner with the Registry product owner |

## Still needs a named person

- **Academic Registrar:**
  - the contact period, channels and what the regulations call each outcome (D-9);
  - the review or appeal route after a non-registration withdrawal (F1);
  - whether an off-portal contact is required (F6).
- **Authorising Officer / Compliance lead (UKVI):** which Doc 2 row and deadline apply to a continuing sponsored student who does not register (O1), and the sponsorship-end reports at leaving (rows g, h and k).
- **Records manager:** the retention schedules for the student record at end of study and at conferment, and the hold reasons for appeals, complaints and OIA cases (F5).
- **DPO:** BP-02-011 OQ-3, and the retention of contact evidence.
- **IT services or integration owner:** grace periods, the alumni email policy, and whether open complaints or OIA cases keep access (D-19, F10).

## Not checked

- Tests were not run; the admin Failure to register worklist and status-case screens were not exercised.
- Wording of notices for accessibility and plain English was not reviewed.
- The institution's regulations, retention schedule and complaints procedure were not available.
- HESA leaver fields could not be read (see the BP-02-006–009 pre-review).
