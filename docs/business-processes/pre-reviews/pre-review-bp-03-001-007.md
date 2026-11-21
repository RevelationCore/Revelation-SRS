# Pre-review: Curriculum, module registration and PGR supervision (BP-03-001 to BP-03-007)

> Date: 2026-11-21
> Backlog item: BL-117
> Items reviewed: [BP-03-001](../03-curriculum-and-module-registration/bp-03-001-import-and-publish-curriculum-data.md) to [BP-03-007](../03-curriculum-and-module-registration/bp-03-007-establish-pgr-supervision.md); [Phases 1–5 change review](../sme-change-review-phases-1-5.md) items D-7, D-11, D-22 to D-34, D-40
> Roles taken: UK HE curriculum and academic-regulations officer (registry); module-registration operations lead; PGR administrator (graduate school)
> Status: **AI pre-review.** This is not the institutional sign-off. Nothing here is approved, signed off or confirmed. The register row stays "Pending" until a named reviewer records an outcome in the [SME review register](../sme-review-register.md).

## Sources consulted

| Source | Version or date | Used for |
|---|---|---|
| Process pages BP-03-001 to BP-03-007 | v0.1, 2026-07-26 (OQ rows on BP-03-002 to BP-03-004 and BP-03-006 updated since) | The process under review |
| [Current capabilities](../../product/current-capabilities.md) | Evidence date 2026-11-18 | What the project says is built |
| [Phase 1](../../decisions/phase-1-gap-closure-decisions.md), [Phase 2](../../decisions/phase-2-gap-closure-decisions.md), [Phase 3](../../decisions/phase-3-gap-closure-decisions.md), [Phase 4](../../decisions/phase-4-gap-closure-decisions.md), [Phase 5](../../decisions/phase-5-gap-closure-decisions.md) decisions; [ADR-019](../../decisions/ADR-019-per-target-exchange-ledger-and-reconciliation.md), [ADR-023](../../decisions/ADR-023-pgr-supervision-and-examination-authority.md), [ADR-025](../../decisions/ADR-025-self-service-audiences-and-identity-binding.md) | Accepted | The project's decided positions |
| Code on branch `phase-1-security-isolation` at 8412e9f, plus uncommitted work in progress | 2026-11-21 | Services, routes and schema named in the findings |
| SRC-038 to SRC-050 ([source register](../source-register.md)): QAA course approval; institutional comparators (Edinburgh, Heriot-Watt, University of Wales, QUB, UCL, Glasgow, Swansea, Ulster, Leicester) | As listed (accessed 2026-07-26) | Sector practice. Not re-fetched; see "Not checked" |
| QAA UK Quality Code for Higher Education (2024 edition); QAA Doctoral Degree Characteristics Statement (SRC-056) | From reviewer knowledge, not re-fetched | Sector baseline for course design, supervision and PGR support |

## Summary

Most of what the July pages call gaps is now built: curriculum publications applied atomically, explicit curriculum bindings, the selection proposal lifecycle with seven rule types, windows, ranked allocation, timetable clashes, recognised credit and rule exceptions, a registration-change approval workflow, and PGR supervision as a governed case (ADR-023). The pages have not caught up, so a human reviewer would be reviewing stale text. The real gaps that remain are change provenance and substitution in BP-03-005, a supervisor "eligibility check" that records only that a check happened, VLE reconciliation that never compares with the authoritative registration set, and curriculum rules that can still be edited directly rather than published.

**Findings:** Blocker 0 · Major 6 · Minor 3 · Observation 2.

## Findings

| # | Severity | Process | What is wrong | Evidence | What to change |
|---|---|---|---|---|---|
| F1 | Major | All | The pages are v0.1 (2026-07-26) and still say "Gap" where work is built. BP-03-001 Traceability: "no durable publication workflow" (curriculum publications exist). BP-03-005: "no durable add/drop approval workflow" (`module-registration-change-approval` exists). BP-03-007: "no durable supervision-establishment workflow" (`SupervisionService`). BR-4 of BP-03-001 and BP-03-005, and BR-3/BR-4 of BP-03-006, are still `PROPOSED`. | Page headers and Traceability tables; [current capabilities](../../product/current-capabilities.md) rows `curriculum-and-catalogue`, `module-selection-and-registration`, `pgr-lifecycle` | Refresh the seven pages to the built state (version 0.2) before the named review, so the reviewer judges what exists. |
| F2 | Major | 03-001, 03-002 | Assessment patterns, academic rules and module relationships are not in curriculum publications, and academic rules are edited directly (`POST /academic-rules`; Phase 5 risk 1). Cohort protection (A5) and teach-out binding (A5b) therefore depend on rules that no approval route governs. D-35 proves which rule version was used, not that it was approved. | [Phase 5 risks](../../decisions/phase-5-gap-closure-decisions.md#risks-raised-for-later-phases) item 1; BL-052 | Raise BL-052 to P1, or put direct rule edits behind a second-person approval until publications carry rules. |
| F3 | Major | 03-005 | `module_registration` holds only status and `registration_date`. It has no requested date, no effective date separate from valid time, no reason code and no authority. The reason exists only on the change-request `workflow_instance`. A direct staff change carries none of it. | `packages/db/src/schema/registration.ts:17-24`; `apps/api/src/platform/registration/service.ts:392-430` | Add `change_reason_code` (value set), `requested_at`, `effective_from` and a decision reference (workflow instance or case decision) to each registration version. |
| F4 | Major | 03-005 | There is no substitution. A swap is a separate add and drop, so a student can lose the old module before the new one is approved, or pass through an invalid credit set. No check stops a withdrawal from a module where marks or submissions exist (E3.1). | `RegistrationService.requestRegistration` and `requestWithdrawal` are separate; no mark or submission lookup in the withdrawal path | Add one change request with several items, validated as a complete set (step 3) and applied in one transaction. Refuse withdrawal, or route it to records governance, when marks, submissions or exam entries exist. |
| F5 | Major | 03-007 | The HR "eligibility check" records only that a check took place. `recordEligibilityCheck` writes an exchange with the case and person IDs and stamps `eligibility_checked_at`. There is no result (eligible or not), no basis (employment status, supervisor-register status, training, capacity), and no as-at date for the HR data. Approval then needs only the timestamp, so an ineligible nominee who was "checked" can be approved. | `apps/api/src/platform/pgr/supervision-service.ts:165-195, 227-228`; `packages/db/src/schema/pgr.ts:52` | Record `eligibility_result_code` and the facts checked (with HR as-at time and source reference). Approval needs `eligible` for every nominee, or a recorded exception by the PGR Director. |
| F6 | Major | 03-006 | VLE roster reconciliation does not reconcile. `reconcileRoster` re-sends only rows in the adapter's own ledger that have no VLE enrolment ID. It does not compare with the SRS's current registrations, and it does not read the VLE's actual membership, so a missed removal, a manual VLE edit or a lost event is never found (E5.1, BR-3). | `adapters/vle/src/reliability/reconciliation-service.ts:41-68` | Add a snapshot reconciliation: SRS effective registrations per offering against VLE membership per course, with corrective add and remove and a drift report. The timetabling flow already has roster snapshots with count reconciliation (D-26); use the same shape. |
| F7 | Minor | 03-007 | The supervisor role set is `principal`, `additional` and `external`. Many providers also require an independent adviser, thesis committee member or progress-review assessor named at the start, and some require a minimum team of two. Neither is configurable as a team rule. | `packages/db/src/schema/pgr.ts:46` | Allow institutions to add roles to `pgr-supervisor-role-code` and to set the minimum team (count and required roles) as configuration checked at approval. |
| F8 | Minor | All | The source register cites the 2018 QAA advice and guidance. The UK Quality Code was revised in 2024. The register has no primary source for PGR supervision beyond institutional comparators. | [Source register](../source-register.md) SRC-038, SRC-053, SRC-055 | Add the 2024 Quality Code and the QAA Doctoral Characteristics Statement as primary sources for BP-03-007. |
| F9 | Minor | 03-002 to 03-004 | Level rules are described as "FHEQ-level aware". Scottish providers use SCQF levels 7 to 12 and SCQF credit. I could not confirm in the time available whether level codes are mapped or hard-wired to FHEQ. | [Current capabilities](../../product/current-capabilities.md) `module-selection-and-registration`; BP-03-004 BR-3 | Confirm that level codes come from a value set an institution can map to SCQF (and CQFW in Wales). If not, make them configuration. |
| F10 | Observation | 03-004 | Known limits are already on the backlog: pairwise clash detection (BL-055), year-level checks with unregistered periods (BL-056), no allocation precedence for diet modules (BL-057). They are reasonable scope bounds for Alpha. | [Backlog](../../product/backlog.md) | None now. Review BL-057 before an institution with oversubscribed compulsory options goes live. |
| F11 | Observation | 03-002 | The binding is created automatically on the first selection proposal and prefers the route- and year-agnostic default rule set. That is a default, which E3.1 and the unsuccessful postcondition say must not be used silently when more than one or no rule set matches. | BP-03-002 BR-4; `apps/api/src/platform/module-selection/service.ts` (`resolveCurriculumBinding`) | Confirm that an ambiguous match stops and raises a data-quality task, and add a test for it. |

## Variants

| Variant | Position | Configuration or code |
|---|---|---|
| Scotland | "Course" for module, adviser-led course enrolment, SCQF credit and levels, four-year honours | Configuration: labels, level mapping (F9), adviser approval routing |
| Wales | CQFW levels; Welsh-language module information; validated and collaborative provision | Configuration: labels, translations (value-set wording table), awarding-body ownership |
| Northern Ireland | Provider change windows and fee and mode consequences (Ulster) | Configuration: windows (D-29), approval routing; fee consequences need F3/F4 |
| Part-time and reduced intensity | Pro-rata credit (D-31) | Configuration; HESA treatment of a mid-session change is an institutional question (D-31) |
| PGR | Supervision, external and collaborative supervisors | Code for F5 and F7; role names and team rules as configuration |
| Collaborative and partner provision | Awarding versus teaching responsibility | Configuration on curriculum publications (`curriculum.masteredBy.<type>`); partner supervision authority needs a recorded partner on the case |

## Data protection

- Selection proposals and registrations are personal data under the contract or public task basis; no special-category data is involved, except that an adjustment may drive a timetable or venue choice. That stays in BP-04-004.
- Supervision conflict-of-interest declarations and HR eligibility facts are personal data about staff. Record only the result and basis (F5), and do not show them to the student (OQ-3 below).
- Supervision working arrangements may include location and health-related contact needs. Keep them as restricted case evidence.

## Open questions

| ID | Question | Proposed answer | Confidence | Owner who must decide |
|---|---|---|---|---|
| BP-03-001 OQ-1 | Are route, rule, assessment and offering imports complete in F-CM-SIS-01? | **Close, answered "partly".** Programmes, modules, routes, rule sets with groups and members, learning outcomes and offerings are published (D-22). Assessment patterns, academic rules and module relationships are not (BL-052; F2). | High | Integration/product owner confirms |
| BP-03-001 OQ-2 | Add a publication/version entity and atomic reconciliation report? | **Close, done.** `curriculum_publication` is versioned, idempotent per source reference, classified item by item, rejected whole on any invalid item and applied in one transaction by a different person (BPR-D05, D-7, D-22). | High | Data architect confirms |
| BP-03-002 OQ-2 | How are recognised credit and diet exceptions represented? | **Close, built.** Recognised credit and rule exceptions per enrolment, proposed and approved by different people, applied at selection and progression (D-32, D-33). The RPL cap and final-stage credit policy remain D-32 institution items. | High | Product/data owner confirms; academic registrar sets the RPL policy |
| BP-03-005 OQ-1 | Add reason, authority and request date to module-registration history? | **Close as "yes, build" (F3).** | High | Data architect confirms |
| BP-03-005 OQ-2 | Implement atomic substitution and an assessment-impact guard? | **Close as "yes, build" (F4).** What happens to marks on a late withdrawal is policy: default "refuse and route to records governance". | High for the build; policy is institutional | Product owner; academic registrar for the withdrawal policy |
| BP-03-006 OQ-2 | Does the VLE adapter persist complete add/remove reconciliation for every target? | **Close, answered "no" (F6).** Per-target delivery state exists; reconciliation against an authoritative snapshot does not. | High | Integration owner confirms |
| BP-03-007 OQ-1 | Which service owns nomination and approval before `staff_assignment` is created? | **Close.** Core SRS, `SupervisionService` on `business_case`; nominations are working data and only approval creates `staff_assignment` rows (ADR-023). | High | Product/data architect confirms |
| BP-03-007 OQ-2 | Is HR authoritative for supervisor eligibility, or only employment/affiliate status? | **Stay open.** Proposed default: HR is authoritative for employment or affiliate status, contract end date and HR-held training records. Eligibility to supervise (supervisor register, experience, workload cap) is an academic decision by the graduate school, recorded on the case (F5). | Medium | PGR owner (Dean of graduate school) and HR owner |
| BP-03-007 OQ-3 | Where are working arrangements stored, and which parts are student-visible? | **Stay open.** Proposed default: a versioned supervision agreement held as case evidence on the supervision case, classified `sensitive-academic`. The student and the team see all of it, since it is their agreement. HR, capacity and conflict data are not part of it and are not student-visible. | Medium | PGR owner and DPO |
| BP-03-007 OQ-4 | Which national and provider team and adviser variants must be configuration rather than extensions? | **Stay open.** Proposed: configuration for role names and labels (including Welsh), minimum team size and required roles, independent adviser, external-supervisor rules and approval authority. Extension only for joint or cotutelle awards where another institution also confers. | Medium | PGR SME |

## Still needs a named person

- **Curriculum reviewer (register role "Curriculum"):** the whole BP-03-001 to BP-03-006 batch, and the D-11, D-22, D-24 to D-33 "institution must confirm" items in the [change review pack](../sme-change-review-phases-1-5.md#r4-phase-4-rule-depth-in-module-selection-and-status).
- **Academic registrar:** the late-withdrawal policy (BP-03-005 OQ-2), RPL cap (D-32), who approves exceptions to each rule (D-33).
- **PGR administration reviewer:** BP-03-007 and OQ-2 to OQ-4; which staff hold `research-supervisor` (D-40).
- **HR owner:** what the HR feed supplies for eligibility (OQ-2) and that it creates staff person rows (ADR-025).
- **Scotland, Wales and Northern Ireland reviewers:** the variant table above, especially SCQF level mapping (F9).
- **DPO:** supervision agreement visibility (OQ-3).

## Not checked

- Institutional regulations: none are in the repository, so window dates, credit loads and approval routes were reviewed against comparators only.
- Sources SRC-038 to SRC-050 and the 2024 Quality Code were not re-fetched in this session.
- Whether a curriculum publication is acknowledged back to Curriculum Management (step 8); I did not trace the acknowledgement path.
- Fee and funding consequences of an add or drop (BP-03-005 step 7, F-SIS-FIN-01); not traced.
- Level-code mapping (F9) and the ambiguous-binding path (F11) were not read in full.
- The demo walkthroughs and screens; nothing was run in a browser.

## New work (backlog-ready)

| Title | Type | Area | Priority | Size |
|---|---|---|---|---|
| Refresh BP-03-001 to BP-03-007 to the built state (v0.2) | Docs | Documentation | P1 | M |
| Module-registration change provenance: reason code, requested and effective dates, decision reference | Feature | Module selection | P2 | M |
| Atomic module substitution and an assessment-impact guard on withdrawal | Feature | Module selection | P2 | M |
| Supervisor eligibility check records a result, the facts checked and the HR as-at time | Improvement | PGR | P1 | S |
| VLE roster snapshot reconciliation against SRS registrations and VLE membership | Integration | Integrations | P2 | M |
| Configurable PGR supervisory team rules (required roles, minimum size) | Feature | PGR | P3 | S |
| Confirm level codes map to SCQF and CQFW | Question | Curriculum | P3 | S |
| Test that an ambiguous curriculum binding stops with a data-quality task | Test | Curriculum | P3 | S |
