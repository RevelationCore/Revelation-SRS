# Pre-review: BP-02-006 to BP-02-009 (transfer, interruption, return and withdrawal)

> Date: 2026-11-21
> Backlog item: BL-114
> Register row: BP-02-006–BP-02-009 in the [SME review register](../sme-review-register.md)
> Status: **AI pre-review.** This is not the institutional review or sign-off the register needs. Nothing here is approved, signed off or confirmed. A named registry, UKVI-compliance, student-finance, data-protection and PGR reviewer must still review these pages.

## Header

**Items reviewed**

- [BP-02-006 Transfer programme, route or mode](../02-registration-and-student-status/bp-02-006-transfer-programme-route-or-mode.md)
- [BP-02-007 Interrupt or suspend studies](../02-registration-and-student-status/bp-02-007-interrupt-or-suspend-studies.md)
- [BP-02-008 Return from interruption](../02-registration-and-student-status/bp-02-008-return-from-interruption.md)
- [BP-02-009 Withdraw from studies](../02-registration-and-student-status/bp-02-009-withdraw-from-studies.md)
- What changed, from the [Phases 1–5 change review](../sme-change-review-phases-1-5.md) (R1 D-1 and D-2, R3 D-19, R4 D-31 and D-32) and the [Phase 1](../../decisions/phase-1-gap-closure-decisions.md), [Phase 3](../../decisions/phase-3-gap-closure-decisions.md) and [Phase 4](../../decisions/phase-4-gap-closure-decisions.md) decision records.
- What was built, from [current capabilities](../../product/current-capabilities.md) (`initial-annual-registration-and-status`), [ADR-013](../../decisions/ADR-013-bitemporal-storage.md), [ADR-016](../../decisions/ADR-016-authoritative-business-state-and-workflow-separation.md), [ADR-017](../../decisions/ADR-017-minimum-necessary-outcomes-and-restricted-evidence.md), [ADR-019](../../decisions/ADR-019-per-target-exchange-ledger-and-reconciliation.md), [ADR-022](../../decisions/ADR-022-cas-and-sponsor-compliance-evidence-boundary.md) and [core principles](../../core-principles.md) §3, §12 and §18.
- The code:
  - `apps/api/src/platform/status-cases/status-case-service.ts` and `apps/api/src/routes/status-cases.ts`;
  - `apps/api/src/platform/enrolment/service.ts` (`transitionStatus`, `changeStudyArrangement`, `getEnrolment`, `ALLOWED_TRANSITIONS`);
  - `apps/api/src/platform/workflow/trigger-rule-service.ts` and `apps/api/src/platform/regulatory/slc-service.ts`;
  - `apps/api/src/platform/regulatory/ukvi-service.ts`;
  - `apps/api/src/platform/delivery/producers/enrolment-flows.ts` and `access.ts`;
  - `apps/api/src/platform/governance/correction-service.ts`;
  - `apps/portal/src/pages/StatusChangesSection.tsx`;
  - `packages/db/src/schema/status-case.ts`, `packages/db/migrations/0000_baseline.sql` (status-case value sets);
  - `packages/domain/src/permissions.ts`.

**Roles taken:** UK HE academic registrar (student status and regulations), UKVI Student sponsor compliance officer, student-finance and fees officer, data-protection reviewer, and PGR administrator.

**Sources consulted**

| Source | Version or date read |
|---|---|
| UKVI, [Student sponsor guidance, Document 2: Sponsorship duties](https://www.gov.uk/government/publications/student-sponsor-guidance/sponsorship-duties-accessible) | Version 10/2026, for use from 8 October 2026 (page updated 6 November 2026). Paragraph 7.5, rows a, c, f, g, h and i; paragraph 5.106. |
| Student Finance Wales, [Withdrawal, suspension, resumption and overpayment factsheet 2025/26](https://studentfinancewales.co.uk/media/qcpncakk/sfw_withdrawal_suspension_resumption_and_overpayment_fs_2526_e_o.pdf) | 2025/26, read through a search summary only: provider sends withdrawal, suspension, transfer and resumption changes of circumstances. |
| HESA Data Futures coding manual: `RSNENGEND`, `ENGENDDATE`, `RSNSCSEND` | Not readable from here (DNS failure and HTTP 403). Field names and the `RSNSCSEND` values (01 withdrawn, 02 interrupted, 03 transferred within the provider, 04 ended) come from search results only. |
| OIA, [Completion of Procedures letter guidance](https://www.oiahe.org.uk/providers/completion-of-procedures-letters/completion-of-procedures-letter-guidance-note/when-should-providers-issue-a-completion-of-procedures-letter/) and the Good Practice Framework | Read through search summaries, 2026-11-21. |
| UK GDPR articles 5(1)(c), 9 and 32 | Read as at 2026-11-21. |
| [Source register](../source-register.md) | SRC-001 to SRC-003, SRC-020 to SRC-029 |

## Summary

The governed status case is real and well controlled at the point of decision: the opener cannot decide, return conditions and closure items block approval, a programme transfer needs the destination's support, credit mappings must be decided first, and a sponsored student needs compliance advice. Every direct status route has gone (D-1).

The gaps are in what happens around the decision:
- a future-dated decision takes effect in the current record at once, and the enrolment write changes a retired row's valid time;
- an approved change for a sponsored student creates no UKVI reporting task, and SLC is not told of a suspension or a return;
- Finance is not told of any status change, the expected end date is never recalculated, and a returning student gets no registration for the year;
- the reviewer gates can be satisfied by anyone holding `status-case:assess`, whatever role they record;
- health reasons are visible tenant-wide to personal tutors and others;
- a withdrawal cannot be reversed, and the student is not told the decision.

The four pages are still the July v0.1 drafts.

**Findings:** 0 Blocker, 12 Major, 8 Minor, 2 Observations.

## Findings

| # | Severity | Process | What is wrong | Evidence | What to change |
|---|---|---|---|---|---|
| F1 | Major | All four | A future-dated approval applies at once. `transitionStatus` and `changeStudyArrangement` set `recorded_until` **and** `valid_to` on the only transaction-current row, then insert the new version. `getEnrolment` reads only `recorded_until IS NULL`, so an interruption from next month, or a transfer from next year (BP-02-006 A3), is the current status and programme today in every read and snapshot. Changing `valid_to` on the retired row also rewrites what the system believed before, against principle §3 and ADR-013 ("UPDATE is never used on bitemporal rows"). | `enrolment/service.ts:587–612`, `735–760`, `376–393`; `decide()` accepts any `effectiveDate` (`status-case-service.ts:389`). | Decide with the solutions architect: either refuse future-dated approvals and apply the change on the effective date (scheduled), or keep two transaction-current rows split by valid time and read "as at today". Leave the retired row unchanged except `recorded_until`. Test both a future and a retrospective date. |
| F2 | Major | 006, 007, 009 | Approving a sponsored student's withdrawal, transfer or interruption raises no UKVI reporting task. The compliance advice only gates the decision. UKVI requires a report within 10 working days of a course withdrawal (row g), a change of course (row i) and a deferral over 60 days or one where sponsorship is withdrawn (row f). Only non-registration, right to study and attendance raise UKVI alerts. | `status-case-service.ts:412–416`; `ukviComplianceAlerts` inserts only in `non-registration-service.ts:97`, `right-to-study-service.ts:210`, `ukvi-service.ts:674`; Doc 2 7.5. | On approval of a sponsored case, raise a compliance alert of the right type (`withdrawal`, `change-of-course`, `deferral`) due 10 working days from the decision, using the D-42 calendar. For an interruption of 60 days or less with sponsorship kept, record "no report" instead. |
| F3 | Major | 007, 008 | SLC is told only of `withdrawn` and `intermitting`. A required suspension and a return (resumption) send nothing, although `slc-service.ts` maps `suspended` to `intermission`. A student who returns keeps a stopped SLC record; a suspended student may be overpaid. | `trigger-rule-service.ts:135`; `slc-service.ts:587–591`; SFW 2025/26 factsheet. | Add the suspension and resumption triggers (from `intermitting` or `suspended` to `enrolled`), with a `resumption` confirmation type. |
| F4 | Major | 007, 009 | No last date of attendance is recorded. `actual_end_date` is the effective date of the decision, and the SLC payload carries no end or attendance date. The non-registration path validates `lastEngagementDate` and then discards it. SLC entitlement and the HESA engagement end date depend on last attendance, not on the decision date. | `enrolment/service.ts:614–616`; `slc-service.ts:569–585`; `non-registration-service.ts:220–222`. | Add `last_attendance_date` to the status case (required for withdrawal and interruption), store it on the enrolment version, and send it to SLC. Keep it distinct from the effective date. |
| F5 | Major | 009, 007 | Retrospective effective dates need no extra authority and have no limit. The decider may pass any date, years back, with the same permission as a current one. BP-02-009 step 3 requires explicit authority for retrospective dates; they change fee liability and funding. | `status-case-service.ts:368–389`. | Add a tenant limit (for example 30 days). Beyond it, require a reason code and the approval of a second `status-case:decide` holder, and show the finance and SLC effect. |
| F6 | Major | All four | Finance is never told of a status change or transfer. F-SIS-FIN-01 is produced only by financial-registration changes; the status-change flows are library, CRM, accommodation, CMS, ITSM and IAM. A transfer copies the old `fee_band_code`. Liability recalculation (BP-02-006 step 7, BP-02-007 step 7, BP-02-009 step 5) rests on the finance assessment note alone. | `delivery/producers/enrolment-flows.ts` (`onEnrolmentChanged`); `registration/financial-registration-service.ts:24`; `enrolment/service.ts:753`. | Send the liability snapshot (status, effective date, last attendance, programme, mode, intensity) to Finance on every status and arrangement change. Let a transfer set the destination fee band. |
| F7 | Major | 008, 006 | The expected end date is never recalculated: a return and a reduced-intensity or programme transfer keep the original date. A student back from a year's interruption can pass their old end date, and re-registration then leaves them out silently (`expected_end_date >= year start`). CAS, SLC and HESA dates go wrong. | `enrolment/service.ts:613`, `751`; `registration-periods/service.ts` `refreshPeriod`. | Make the new expected end date part of a return or transfer decision (required), and check it against the maximum registration period (F14). Tell UKVI when the course end changes for a sponsored student (Doc 2 5.106). |
| F8 | Major | 008 | A return creates no registration for the year. Interrupted students are left out when a period opens (D-8); if they return after it closes, they have no confirmation, no fee liability for the year and no lapse. | `registration-periods/service.ts` `refreshPeriod` and `confirm`; D-8. | On approval of a return, create a pending confirmation in the year's period (opening one if needed) or require an assisted confirmation as a closure step. |
| F9 | Major | All four | The reviewer role is whatever the caller types. Anyone with `status-case:assess`, which includes `registry-administrator`, can record "compliance" advice or "destination-academic supports", and those records are the gates in `decide()`. One registry administrator can satisfy the UKVI and destination gates, and a second can approve. | `addAssessment` (`status-case-service.ts:320–329`); `permissions.ts:79–80`. | Bind assessor role codes to roles: `compliance` to `regulatory-officer`, `destination-academic` to a `programme-approver` for the destination programme, `finance` to `finance-administrator`. The decider's own assessment must not satisfy a gate. |
| F10 | Major | 007, 009 | The reason category `health` (and `fitness-to-study`) is data concerning health, special category under UK GDPR art. 9. `status-case:read` is held by `personal-tutor`, `finance-administrator`, `programme-approver`, `regulatory-officer` and `pgr-administrator`, and `GET /status-cases` lists every open case in the tenant. Notes and decision reasons are free text up to 2,000 characters. This goes beyond ADR-017 and principle §18. | `permissions.ts:76`; `routes/status-cases.ts:56–64`; value set in `0000_baseline.sql:12157–12168`. | Limit personal tutors to their tutees, or remove the permission. Show the reason category only to the registry and the decider. Read-audit case views. Add on-screen guidance that notes must not hold medical detail. Record the art. 9 condition in the data register. |
| F11 | Major | 009 | A withdrawal cannot be reversed. `withdrawn` allows no transition, no case type starts from it except leaver closure, and the correction service covers marks, results and progression only. D-1 says an error is corrected "through an institution-initiated case", but none can be opened. A withdrawal overturned on appeal or by the OIA, or a wrong non-registration decision, has no governed route back. | `ALLOWED_TRANSITIONS` (`enrolment/service.ts:150–158`); `STARTS_FROM` (`status-case-service.ts:47–54`); `AmendableEntityType` (`governance/correction-service.ts`). | Add an institution-only `reinstatement` case type from `withdrawn`. It needs the appeal or correction outcome reference and a second decider, and it keeps the withdrawal version in history. |
| F12 | Major | All four | The student is not told the decision. The status-case service sends no notification; nothing records reasons for the student, the effective date, conditions, or the review or appeal route (BP-02-007 step 8, BP-02-009 step 8, OIA practice on written outcomes and Completion of Procedures letters). | No notification call in `status-case-service.ts`; `notifications.deliver` is called only from `non-registration-service.ts:146` and `routes/notifications.ts`. | On every decision, notify the student with the outcome, reason, effective date, conditions and the configured review route. Record the route on the decision. |
| F13 | Minor | 009 | No exit-award or transcript check at withdrawal (A4). The decision does not show credit achieved or whether an interim award is due, so an entitlement can be missed. | `decide()`; no award lookup. | Show achieved credit and eligible exit awards on the withdrawal decision. Add an "exit award" closure item automatically when one may be due. |
| F14 | Minor | 007 | No maximum interruption length and no maximum registration period are checked. Sponsored students are not warned that more than 60 days away means sponsorship is withdrawn and reported (row f). | `openCase` and `decide` check only that the return date is after the effective date. | Add configurable maximum durations, and for a sponsored student a warning above 60 days. |
| F15 | Minor | 007 A3 | PGR interruption does not move milestones or the submission deadline; only a `return-from-interruption` review type exists. | `pgr/progress-review-service.ts:36`. | On a PGR interruption decision, offer the authorised deadline extension, recorded with the decision. |
| F16 | Minor | 006 | A transfer emits no domain event. `srs.student.status-changed` comes only from `transitionStatus`; `changeStudyArrangement` sends delivery flows and an SLC trigger but no event, so event subscribers miss programme and mode changes. | `enrolment/service.ts:692` (only `STUDENT_STATUS_CHANGED`). | Emit `srs.student.study-arrangement-changed` with old and new programme, mode, intensity and effective date. |
| F17 | Minor | 007, 009 | `institutional_outcome_ref` for a required suspension or institution-initiated withdrawal is free text; nothing checks that it refers to a real outcome. | `status-case-service.ts:208–209`. | Validate the reference format (`case-decision:<id>`, a misconduct or fitness outcome id) and check that it exists. |
| F18 | Minor | 006 | Students can always request a transfer; `STUDENT_REQUESTABLE` is hard-coded, although D-2 asks the institution "whether students may request a transfer at all". | `status-case-service.ts:65`. | Make the requestable types a tenant setting. |
| F19 | Minor | 007, 009 | The portal visa notice says every change is reported within 10 working days. For an interruption of 60 days or less with sponsorship kept, no report is needed (row f). | `StatusChangesSection.tsx:149`. | Reword with the compliance team (D-2 already asks the institution to confirm the wording). |
| F20 | Minor | Documentation | The pages are v0.1 of 2026-07-26 and do not describe the status cases. [Current capabilities](../../product/current-capabilities.md) says reduced intensity and transfer credit mapping are not modelled, but D-31 and D-32 are built (`destination_study_intensity_percent`, `recognised_credit` `internal-transfer`, `apps/api/test/status-case-intensity-credit.int.test.ts`), so BL-049 and BL-050 look stale. The `routes/enrolments.ts` header still lists the retired routes. SRC-002 lists version 04/2026; 10/2026 is current. | Page headers; capability row; backlog rows BL-049 and BL-050; `routes/enrolments.ts:96–100`; [source register](../source-register.md). | Update the four pages to v0.2 with the built states, permissions and gaps. Correct the capability row, close or re-scope BL-049 and BL-050, fix the route comment, and refresh SRC-002. |
| O1 | Observation | All four | The decision controls match the processes: separation of duties, return conditions, destination support, the credit-mapping gate, compliance advice before a sponsored student leaves full-time study, and the load check after a mode change. | `status-case-service.ts:368–500`. | None. |
| O2 | Observation | 008 | `fee-clearance` is a return condition type. Used for non-tuition debt, it would be the kind of academic sanction CMA182 warns about, and it bypasses `registration.financialHoldBlocks`. | Value set `status-case-condition-type-code`. | Have the institution confirm when, if ever, fee clearance may be a return condition. |

## Open questions

| ID | Question | Proposed answer | Confidence | Owner who must decide |
|---|---|---|---|---|
| BP-02-006 OQ-1 | Is a new transfer workflow or event needed, and a credit-mapping entity? | **Propose closing.** The workflow is the `transfer` status case (BPR-D04): destination support, credit mappings and the load check gate approval. The credit-mapping entity is `recognised_credit` of type `internal-transfer`, linked to the case, approved by a second `academic-exception:approve` holder (D-32). Reduced intensity is a transfer (D-31). The only remaining gap is the event (F16), which is new work, not an open question. | High | Product and data owners, to accept |
| BP-02-007 OQ-1 | Split interruption and institution-required suspension status and reason taxonomies? | **Propose closing the status split; the labels stay with the institution.** Built: separate case types (`interruption`, `suspension`), separate statuses (`intermitting`, `suspended`), and a suspension can be opened only by the institution and only with an authorising outcome. Keep one reason value set, but mark which codes each initiator may use (students cannot pick `conduct` or `fitness-to-study`), and add a crosswalk to the HESA reason fields. | Medium | Academic Registrar names the labels; the data owner approves the crosswalk |
| BP-02-008 OQ-1 | A new durable return workflow and return-plan entity? | **Propose closing the workflow part.** A return is a status case linked to the approved break (`related_case_id`); the break's conditions are the return plan and must all be met or waived before approval. The missing plan facts (restart point, new expected end date, module plan, registration for the year) are new work (F7, F8), not a new entity. | Medium | Product and data owners |
| BP-02-009 OQ-1 | Separate voluntary and institutional withdrawal workflows, and reason visibility? | **Close the workflow part; reason visibility stays open.** One `withdrawal` case type with `initiated_by` student or institution is enough. Institutional withdrawals already need an outcome reference and a second decider. Visibility: the proposed default is that the reason category is visible only to the registry and the decider, tutors see only the status and dates, and free-text notes carry no health detail (F10). | High (workflow); medium (visibility) | DPO with the Academic Registrar |

## Still needs a named person

- **Academic Registrar:**
  - the transfer, interruption and withdrawal regulations: windows, maximum durations, retrospective-date limits, return points and the review or appeal route;
  - at least two people hold `status-case:decide` (D-1), and who holds `status-case:assess` for each reviewer role (F9);
  - whether students may request transfers (D-2), and when fee clearance may be a return condition (O2).
- **Authorising Officer / Compliance lead (UKVI):** the reporting rules applied on approval (F2), the 60-day interruption treatment, and the portal notice wording (F19).
- **Head of Student Finance:** what Finance needs on each change (F6), mid-year fee recalculation on transfer (D-31), and the SLC change-of-circumstances mapping, including resumption (F3, F4).
- **DPO:** the art. 9 condition and who may see reason categories (F10, BP-02-009 OQ-1).
- **PGR lead:** how a PGR interruption moves milestones and the submission deadline (F15).
- **HESA return lead:** the crosswalk from reason codes and status changes to the Data Futures reason and end-date fields, which this review could not read.
- **Solutions architect:** how future-dated and retrospective enrolment changes are stored and read (F1).

## Not checked

- The HESA Data Futures coding manual could not be opened (DNS failure and HTTP 403), so no HESA code values are asserted beyond the field names.
- The full SLC SIS provider manual was not available; SLC points rely on the Student Finance Wales factsheet summary.
- Tests were not run. The admin and portal status screens were not exercised.
- The VLE connector module's response to status changes was not traced.
- The institution's own regulations, fee policy and appeals procedure were not available.
