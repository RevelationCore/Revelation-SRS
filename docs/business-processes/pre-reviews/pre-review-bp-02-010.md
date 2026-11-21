# Pre-review: BP-02-010 (complete annual re-registration)

> Date: 2026-11-21
> Backlog item: BL-115
> Register row: BP-02-010 in the [SME review register](../sme-review-register.md)
> Status: **AI pre-review.** This is not the institutional review or sign-off the register needs. Nothing here is approved, signed off or confirmed. The page lists nine review roles; each still needs a named reviewer.

## Header

**Items reviewed**

- [BP-02-010 Complete annual re-registration](../02-registration-and-student-status/bp-02-010-complete-annual-re-registration.md), the documentation-system pilot page, including its seven open questions.
- What changed, from the [Phases 1–5 change review](../sme-change-review-phases-1-5.md) (R2 D-8 and D-9, R3 D-17 to D-19) and the [Phase 2](../../decisions/phase-2-gap-closure-decisions.md) and [Phase 3](../../decisions/phase-3-gap-closure-decisions.md) decision records.
- What was built, from [current capabilities](../../product/current-capabilities.md) (`initial-annual-registration-and-status`), [ADR-016](../../decisions/ADR-016-authoritative-business-state-and-workflow-separation.md), [ADR-019](../../decisions/ADR-019-per-target-exchange-ledger-and-reconciliation.md), [domain events](../../architecture/domain-events.md), the [workflow catalogue](../../requirements/workflow-catalogue.md) (W010) and [core principles](../../core-principles.md) §3 and §12.
- The code:
  - `apps/api/src/platform/registration-periods/service.ts` and `non-registration-service.ts`;
  - `apps/api/src/platform/registration/right-to-study-service.ts` and `financial-registration-service.ts`;
  - `apps/api/src/app.ts` (blocker composition and lapse wiring);
  - `apps/api/src/platform/enrolment/service.ts`;
  - `packages/db/src/schema/enrolment.ts` (`reenrolment_period`, `reenrolment_confirmation`);
  - `packages/domain/src/permissions.ts`.

**Roles taken:** UK HE academic registrar (registration and matriculation), student-finance officer, UKVI Student sponsor compliance officer, data architect and integration architect.

**Sources consulted**

| Source | Version or date read |
|---|---|
| UKVI, [Student sponsor guidance, Document 2: Sponsorship duties](https://www.gov.uk/government/publications/student-sponsor-guidance/sponsorship-duties-accessible) | Version 10/2026, for use from 8 October 2026. Paragraph 7.5, rows c, e and g. |
| SLC, Attendance Management guidance (SRC-003) | Not re-read; relied on the source register entry. |
| CMA, [UK higher education providers: advice on consumer protection law (CMA182)](https://www.gov.uk/government/publications/higher-education-consumer-law-advice-for-providers) | May 2023 edition, as cited by the sibling pre-review; not re-read. |
| [Source register](../source-register.md) | SRC-001 to SRC-019 |

## Summary

Annual re-registration is built and matches most of the page: registry opens a period, eligible students get a pending confirmation, students confirm in the portal against the current terms version, the registry can confirm on a student's behalf with a reason, confirmation creates the year's fee liability and publishes `srs.student.re-enrolled`, and closing the period lapses the rest into BP-02-011. Five of the seven open questions are answered by what was built.

The gaps that matter: the page itself is stale on four Revelation rules, and students coming back from interruption, or past their original end date, can fall out of re-registration without anyone noticing.

**Findings:** 0 Blocker, 2 Major, 7 Minor, 3 Observations.

## Findings

| # | Severity | What is wrong | Evidence | What to change |
|---|---|---|---|---|
| F1 | Major | The page is v0.1 of 2026-07-26 and four Revelation rows are wrong now. BR-7 says W010 routes lapse to W007; it opens a BP-02-011 case (D-9). BR-8 says terms version, channel and assisted authority are not stored; they are. BR-9 says `srs.student.re-enrolled` is not implemented; it is published. Steps 8–9 send entitlements on confirmation; under D-19, access follows enrolment status, not the annual confirmation. Step 10 places an SLC item on a worklist; confirmation raises no SLC trigger for an annual period. The [workflow catalogue](../../requirements/workflow-catalogue.md) W010 still says `lapsed` → W007. | `registration-periods/service.ts` `confirm` and `closePeriod`; `app.ts:628`; `workflow-catalogue.md:394`. | Rewrite the page as v0.2 from the built behaviour, keeping the institutional variants. Update W010 in the workflow catalogue. |
| F2 | Major | Students can drop out of re-registration silently. A period includes only `enrolled` students whose expected end date is on or after 1 August of the year. Interrupted students are excluded (D-8), a return does not add them after the period closes, and the expected end date is not extended on return (see the BP-02-006–009 pre-review, F7 and F8). Such a student gets no confirmation, no lapse and no BP-02-011 case. | `refreshPeriod` (`registration-periods/service.ts`); `enrolment/service.ts:613`. | On closing a period, list enrolled students with no confirmation for the year as an exception. Fix the return and end-date gaps at source. |
| F3 | Minor | The academic year is assumed to start on 1 August (`yearStart = <year>-08-01`). January and other intakes, and PGR continuous registration, are judged against the wrong date. | `refreshPeriod`. | Use the academic period start for the student's programme or intake. |
| F4 | Minor | One tenant-wide `registrationTermsVersion`, so terms cannot vary by programme group, audience or language (Welsh-language terms in Wales). D-8 calls the setting `registration.terms-version`; the code reads `registrationTermsVersion`. | `termsVersion()`; [Phase 2 decisions](../../decisions/phase-2-gap-closure-decisions.md) D-8. | Allow a terms bundle per period or programme group, with language versions. Correct the key name in D-8. |
| F5 | Minor | An assisted confirmation stores the terms version as if the student accepted it, and records only a reason code. A6.2 asks for how identity was verified, the evidence and the declarations presented. | `confirm()` with `channel: 'assisted'`. | Record the identity-check method and an evidence reference, and mark the terms as "presented by registry" rather than accepted online. |
| F6 | Minor | Step 3–4 (review personal and contact details) is shown in the portal but not recorded; the confirmation does not say the details were reviewed or changed. | `reenrolment_confirmation` columns; `confirm()`. | Record a "details reviewed" flag and link changed fields' versions to the confirmation. |
| F7 | Minor | PGR, placement, distance and partner-delivered evidence (A5c) is not modelled: there is no supervisor or partner confirmation before the student can confirm. | No such blocker in `composeBlockers(rightToStudy, financialRegistration)` (`app.ts:443`). | Add an optional blocker provider for third-party confirmations, configured per programme (see OQ-5). |
| F8 | Minor | `srs.student.re-enrolled` is published only when the bus is connected, after the transaction, with no outbox. Nothing in the API subscribes to it, though [domain events](../../architecture/domain-events.md) lists finance and VLE adapters as consumers. An event lost while the bus is down is not replayed. The same pattern is used elsewhere in the platform. | `confirm()` (`if (this.eventBus.isConnected())`); no other reference to `STUDENT_RE_ENROLLED` in `apps/api/src`. | Decide platform-wide whether domain events need a transactional outbox (principle §12 says events are durable). Until then, do not make adapters depend on this event alone. |
| F9 | Minor | The page's Data impact table and entity list name `student_hold`, `student_obligation` and `reenrolment_confirmation` fields that do not exist, and omit `fee_liability.financial_status_code` and `right_to_study_check`, which do the blocking. | Page Traceability; `packages/db/src/schema/enrolment.ts`. | Correct the entity list in v0.2. |
| O1 | Observation | A lapsed student stays `enrolled` with full study access while BP-02-011 runs (D-19 follows status). That matches BR-10 (no inferred status change), but the institution should confirm it is acceptable for the length of its contact period. | `access.ts` matrix. | Institution confirms. |
| O2 | Observation | Fee debt does not block by default; only a tuition hold blocks, and only when `registration.financialHoldBlocks` is `tuition-hold`. This is in line with CMA182 on non-tuition debt. | `financial-registration-service.ts`; D-18. | None. |
| O3 | Observation | Confirmation and lapse are bitemporal versions of `reenrolment_confirmation`, a period cannot be closed before its end, and a lapsed confirmation can be confirmed only by the registry as a late registration. | `confirm()`, `closePeriod()`. | None. |

## Open questions

| ID | Question | Proposed answer | Confidence | Owner who must decide |
|---|---|---|---|---|
| BP-02-010 OQ-1 | Split W010 into academic confirmation, financial registration and downstream confirmation tasks, or configure institutional variants? | **Propose closing: configure, do not split.** As built, academic confirmation is the `reenrolment_confirmation`; financial registration is a separate status on the year's `fee_liability` (D-18) and blocks only if `registration.financialHoldBlocks` says so; right to study is a blocker (D-17); further checks plug in as blocker providers; each downstream exchange has its own ledger entry (ADR-019). An institution that wants financial registration to block sets the configuration. | High | Registration product owner |
| BP-02-010 OQ-2 | Which canonical status codes replace or supplement `pending`, `confirmed` and `lapsed` for action-required or manual-review cases? | **Propose closing: keep the three.** "Action required" is the list of computed blockers with codes (`results-pending`, `terms-not-set`, right-to-study and finance codes), shown to the student. "Manual review" is the BP-02-011 case status (`open`, `under-review`) with its flags. Adding confirmation statuses would duplicate both. | Medium | Data architect |
| BP-02-010 OQ-3 | Add accepted terms version, channel and confirming actor to `reenrolment_confirmation`? | **Propose closing: done.** `terms_version`, `channel_code` (`portal` or `assisted`), `confirmed_by`, `confirmed_at` and `assisted_reason_code` are stored. The remaining work is F4 (per-programme and language versions) and F5 (assisted identity and evidence). | High | Data architect with the DPO |
| BP-02-010 OQ-4 | Which SLC confirmation messages occur at annual re-registration versus later attendance points, for each scheme, course and mode? | **Stays open.** Proposed default, which the code follows: annual re-registration sends nothing to SLC; attendance confirmation is a separate BP-07-002 worklist after each scheme's attendance point; an initial registration sends the first confirmation when the enrolment becomes `enrolled`. The per-scheme mapping (SFE, SFW, SFNI, SAAS, part-time, distance) needs the current SLC provider manual. | Low | Student finance SME (Head of Student Finance) |
| BP-02-010 OQ-5 | What minimum evidence should partner providers supply where the tenant keeps registration responsibility? | **Stays open.** Proposed default: by the period close, the partner sends a per-student confirmation of continued registration and attendance, from a named partner contact, held as an evidence reference on the confirmation; a missing confirmation is a blocker, and a conflict opens a data-quality task (E5). The agreement sets the format and timing. Not built (F7). | Medium | Collaborative provision SME, under each partnership agreement |
| BP-02-010 OQ-6 | Should failure to re-register trigger W007 automatically, or always require a BP-02-011 decision? | **Propose closing: always a BP-02-011 decision.** Built (D-9): closing a period lapses pending confirmations and opens a case; a non-registration decision needs the contact minimums and opens an institution-initiated withdrawal case that a second person decides. Nothing changes the enrolment automatically. Update BR-7 and the workflow catalogue (F1). | High | Registry product owner |
| BP-02-010 OQ-7 | `srs.student.re-enrolled` is documented but not implemented: implement it, or replace it with a more general registration event? | **Propose closing: implemented, keep the name.** It is published on every confirmation, annual or initial, with `periodType`, `channel`, `academicYear` and `confirmedAt`; it already serves as the general registration event. An initial registration also emits `srs.student.enrolled` when the enrolment becomes `enrolled`. Durability is a separate point (F8). | High | Integration architect |

## Still needs a named person

- **Academic Registrar:** period dates and reminders; the terms wording and whether they vary by programme or language (D-8, F4); what an assisted confirmation must record (F5); whether a lapsed student keeps study access during the contact period (O1).
- **Head of Student Finance:** OQ-4, and whether any tuition hold blocks registration (D-18).
- **Authorising Officer / Compliance lead (UKVI):** which Doc 2 row applies when a continuing sponsored student does not re-register (row c's 10 working days is applied today; rows e or g may fit better).
- **Collaborative provision lead:** OQ-5.
- **Integration architect:** whether domain events need an outbox (F8).
- **Four-nation reviewers:** matriculation components (Scotland), Welsh-language terms, and SFNI attendance points.

## Not checked

- The SLC provider manual and per-scheme attendance rules were not available.
- Tests were not run; the portal and admin Registration screens were not exercised.
- How the blocker messages read to students, and their accessibility, were not reviewed.
- The institution's registration regulations and terms were not available.
