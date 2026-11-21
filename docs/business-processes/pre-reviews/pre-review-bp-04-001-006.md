# Pre-review: Engagement, PGR progress and student support (BP-04-001 to BP-04-006)

> Date: 2026-11-21
> Backlog items: BL-118; BL-174 (EC decision authority, in its own section below)
> Items reviewed: [BP-04-001](../04-learning-engagement-and-support/bp-04-001-record-attendance-and-academic-engagement-evidence.md) to [BP-04-006](../04-learning-engagement-and-support/bp-04-006-distribute-an-approved-support-outcome.md); [ADR-028](../../decisions/ADR-028-exceptional-circumstances-decision-authority.md); [Phases 1–5 change review](../sme-change-review-phases-1-5.md) items D-40, D-41, D-44
> Roles taken: student engagement and UKVI sponsor-compliance officer; PGR administrator; exceptional-circumstances (additional consideration) policy lead; data protection reviewer
> Status: **AI pre-review.** This is not the institutional sign-off. Nothing here is approved, signed off or confirmed. The register row stays "Pending" until a named reviewer records an outcome in the [SME review register](../sme-review-register.md). BP-04-004 is reviewed in depth in the [D-44 pre-review](pre-review-adjustments-d-44.md); this record carries only its open questions.

## Sources consulted

| Source | Version or date | Used for |
|---|---|---|
| Process pages BP-04-001 to BP-04-006 | v0.1, 2026-07-26 (BP-04-004 v0.2, 2026-08-15) | The process under review |
| [Current capabilities](../../product/current-capabilities.md) | Evidence date 2026-11-18 | What the project says is built |
| [ADR-017](../../decisions/ADR-017-minimum-necessary-outcomes-and-restricted-evidence.md), [ADR-019](../../decisions/ADR-019-per-target-exchange-ledger-and-reconciliation.md), [ADR-022](../../decisions/ADR-022-cas-and-sponsor-compliance-evidence-boundary.md), [ADR-023](../../decisions/ADR-023-pgr-supervision-and-examination-authority.md), [ADR-028](../../decisions/ADR-028-exceptional-circumstances-decision-authority.md); [Phase 5 decisions](../../decisions/phase-5-gap-closure-decisions.md) | Accepted | The project's decided positions |
| Code on branch `phase-1-security-isolation` at 8412e9f, plus uncommitted ADR-028 work in progress (permissions, EC routes) | 2026-11-21 | Services, routes, schema and permissions named in the findings |
| UKVI, [Student sponsor guidance: Sponsorship duties](https://www.gov.uk/government/publications/student-sponsor-guidance/sponsorship-duties-accessible) | Version 10/2026, for use from 2026-10-08; page updated 2026-11-06; read 2026-11-21 | Academic engagement policy, sections 7.10 and 7.13 to 7.31 |
| OIA, [Good Practice Framework: Requests for additional consideration](https://www.oiahe.org.uk/resources-and-publications/good-practice-framework/requests-for-additional-consideration/) ("Good additional consideration processes", "Outcomes") | Published 2020-12-14, applies from 2021/22; read 2026-11-21 | Who decides, training, timescales, reasons, records, confidentiality |
| SRC-003 SLC attendance management; SRC-047 to SRC-050, SRC-055, SRC-056, SRC-058 ([source register](../source-register.md)) | As listed (accessed 2026-07-26) | Not re-fetched; see "Not checked" |

## Summary

The engagement slice (expected events, observations, policy versions, alerts, interventions, separate sponsor decisions), PGR progress review, governed EC determinations and per-target adjustment distribution are all built, but five of the six pages are July templates whose business rules say they are not. The real gaps are: no guard on the UKVI maximum non-engagement period, progress-review independence that relies on self-declaration, EC outcomes that the student never sees reasons for, the student's free-text EC narrative held in core, and source versions that have moved on. The EC decision-authority question (BL-174) has a recommended default below.

**Findings:** Blocker 0 · Major 6 · Minor 4 · Observation 1. (The Blocker in the [D-44 pre-review](pre-review-adjustments-d-44.md), F1, also stops BP-04-006 working in a deployment.)

## Findings

| # | Severity | Process | What is wrong | Evidence | What to change |
|---|---|---|---|---|---|
| F1 | Major | 04-001, 002, 003, 005, 006 | The pages contradict the code. BR-3 says: 04-001 "lacks a canonical expected-event/evidence model" (`expected_engagement_event` and observations exist); 04-002 "W009 conflates alert, support, status and sponsor decisions" (now separate, with independent authorisation); 04-003 "no review case, panel, evidence or governed outcome" (`ProgressReviewService`); 04-005 "W003 models the basic states but not assessment scope" (D-41 determination with module scope); 04-006 "a reusable per-target distribution ledger is absent" (`adjustment_distribution`, delivery ledger). Actor rows are placeholders ("Provides evidence, decision, system processing or governed support"), and the accountable owner of 04-001, 04-003 and 04-005 is the student. | Page BR tables and Actors tables; `modules/attendance/src/services/engagement-policy-service.ts`; `apps/api/src/platform/pgr/progress-review-service.ts` | Rewrite the five pages to the built state before the named review: real actors, owner roles, flows and BRs. |
| F2 | Major | 04-001, 04-002 | Source versions are out of date. SRC-001, SRC-002, SRC-003 and SRC-057 passed their review-by date (2026-10-26). SRC-002 cites Sponsorship duties 04/2026; the current version is 10/2026 (from 2026-10-08). The register cites the 2018 QAA advice; the Quality Code was revised in 2024. | [Source register](../source-register.md) | Re-read the engagement and reporting rules against 10/2026, update the register, and record what changed. |
| F3 | Major | 04-001, 04-002 | Nothing stops a sponsored-student engagement policy from allowing more non-engagement than UKVI permits. Sponsorship duties 10/2026 s.7.27 caps the maximum non-engagement period before intervention at 60 calendar days (30 for remote delivery), excluding recognised vacations and PGR; s.7.19–7.20 requires withdrawal if the student does not re-engage within 60 days (30 remote) of first contact. The policy service checks only that an evidence window fits the approved duration. | `modules/attendance/src/services/engagement-policy-service.ts:58-107` | When a policy's applicability includes the Student route, refuse approval of an intervention period over 60 days (30 for remote delivery), and record the guidance version on the policy. |
| F4 | Major | 04-003 | Panel independence depends on self-declaration. Nothing stops the student's current supervisor from being added as `independent-reviewer` or `panel-member`, and there is no minimum composition (for example, at least one independent reviewer). An outcome is blocked only by a declared, unrecused conflict. The process exists precisely so "a supervisor's own evidence is checked by a panel that is not marking its own work". | `apps/api/src/platform/pgr/progress-review-service.ts:148-208`; BP-04-003 Purpose; QAA Doctoral Characteristics Statement (SRC-056) | Refuse a panel member who holds a current `staff_assignment` as the student's supervisor. Require at least one `independent-reviewer` (configurable) before an outcome. |
| F5 | Major | 04-005 | ADR-028 item 9 says students see "the decided outcome, never the evidence reviews or the rationale". The OIA framework says outcomes should be "communicated to students in writing" with the reasons, and the right of appeal, grounds, time limit and where to get support. I disagree with item 9 as written. | [ADR-028](../../decisions/ADR-028-exceptional-circumstances-decision-authority.md) item 9; OIA GPF "Outcomes" and para 19 | Keep internal notes and evidence reviews restricted, but add a student-facing reason (reason code plus text written for the student) and the review route to every determination, shown in the portal. |
| F6 | Major | 04-005 | The student's own account of their circumstances is stored in core. `POST /exceptional-circumstances/submissions` takes a free-text `description` (up to 4,000 characters) and stores it as `notes` on core `exceptional_circumstances`, readable with `circumstances:read` (registry administrators, wellbeing advisers, EC case officers). That is often health or bereavement detail. ADR-017 keeps such evidence out of core. | `apps/api/src/routes/circumstances.ts:105, 133-141`; `packages/domain/src/permissions.ts` (`circumstances:read`) | Where the wellbeing module is the EC case system, send the narrative there and keep only the claim scope and outcome in core. Otherwise restrict core `notes` to `ec-case-officer` and `ec-decision-maker`. This also answers the review pack's EC question (see the D-44 record). |
| F7 | Minor | 04-005 | `ec-outcome-code` includes `condone`. Condonation is an exam-board academic decision; BP-04-005 step 4 says the EC decision maker decides "without deciding academic marks", and the OIA framework discourages changing marks. | `packages/db/migrations/0000_baseline.sql` (ec-outcome-code members) | Replace `condone` with "refer to board for discretion", or let only boards apply it. |
| F8 | Minor | 04-005 | No timeliness control. The OIA framework says time-sensitive decisions should normally be made within 14 days (para 32), and students should be told when to expect one. Neither the core claim nor the wellbeing claim carries a due date or an overdue view. | `apps/api/src/routes/circumstances.ts`; `modules/wellbeing/src/db/schema/circumstances.ts` (only `evidence_deadline`) | Add a decision due date (default 14 calendar days, configurable) and an overdue filter on the EC worklists. |
| F9 | Minor | 04-005 | In panel mode only a meeting reference is recorded (ADR-028 item 7). The OIA framework expects a written record of attendees, a brief outline, the reasons and the outcome (para 39). PGR reviews and exam boards already record members, conflicts and recusal. | ADR-028 item 7; BL-173 | Record panel members, attendance, conflicts and the quorum check on each panel determination (see BL-174 below). |
| F10 | Minor | 04-005 | `ec.decisionAuthority` is one value for the whole tenant. Many providers let an officer decide routine claims and send late, stage-level or contested claims to a panel. | ADR-028 item 7 | Later: route by claim category. Until then, document that an institution needing tiers should choose `panel`. |
| F11 | Observation | 04-006 | Distribution itself is sound: per-target items, fulfilment modes, manual queue, withdrawal on expiry, failures kept with reasons. Targets receive type, scope, amount and dates only (`distribution-dispatcher.ts:122-136`). Two upstream issues are in the D-44 record: the deployed wellbeing service uses a stub SRS client (F1 there), and Moodle groups may reveal adjustments to course participants (F11 there). | `apps/api/src/platform/adjustments/distribution-dispatcher.ts` | See the [D-44 pre-review](pre-review-adjustments-d-44.md). |

## BL-174: Who decides exceptional circumstances

ADR-028 asks the institution to confirm three things. Recommended defaults, with what the institution must choose:

| Question | Recommended default | Why | Institution must choose |
|---|---|---|---|
| Who holds `ec-decision-maker`: a panel or a delegated officer? | **`delegated-officer`** (the ADR default), held by at least two trained officers in a central academic-services or registry team who have had no significant prior involvement with the student. Use `panel` for an institution that sends late claims, stage- or award-level claims (repeat year, aegrotat recommendation) or contested claims to a panel, until per-category routing exists (F10). | The OIA framework allows either an individual or a panel (para 27) but expects decision makers to be "suitably trained", normally with no significant prior involvement, and decisions to be consistent across schools (paras 26, 30). A small central team gives consistency and speed (para 32: normally 14 days). Two holders are needed because separation of duties refuses anyone who recorded or assessed the claim. | Officer or panel; which team and named post-holders; whether local (school) decision makers are used and how consistency is checked; who hears a review or appeal (must not be the original decider). |
| Does `wellbeing-advisor` keep `ec-claim:manage`? | **No.** Remove `ec-claim:manage` from `wellbeing-advisor`, and also `ec-claim:read`. Staff who run EC get `ec-case-officer` explicitly. | A wellbeing adviser often supports the student in making the claim; holding the case-officer role as well mixes support and assessment, and it gives every adviser read and write access to every claim in the tenant. ADR-028's own rationale (least privilege, dedicated roles) points the same way. An adviser can still help a student submit their own claim, and staff-assisted recording can be given to named advisers through `ec-case-officer`. | Whether its wellbeing team runs EC (then assign `ec-case-officer` to those staff); whether advisers may record claims on a student's behalf. |
| Panel quorum, if `panel` is chosen | **Three voting members including the chair; at least one from outside the student's school or programme; none with a declared conflict or prior involvement; decisions by majority, chair's casting vote; a non-voting secretary may record.** Record attendees, conflicts, reasons and outcome (para 39); anonymise by student number where practicable (para 30). | Matches common sector practice and the OIA record-keeping expectation; mirrors the conflict and recusal pattern already used for PGR reviews and exam boards. | The quorum number, independence rule and voting rule; whether the student's name is withheld from the panel. |
| Removing `exam-board-chair` and `registry-administrator` from `circumstances:decide` | **Agree.** Chairs keep reading decided outcomes. | The board acts on the authorised outcome rather than the circumstances (BP-04-005 Purpose; ADR-017). | Sign-off by the academic registrar. |

Also needed for the BL-174 decision: the review or appeal route wording differs by nation. The OIA framework applies to England and Wales; Scottish providers' final stage is the Scottish Public Services Ombudsman, and Northern Ireland's is the Northern Ireland Public Services Ombudsman. The outcome notice (F5) must name the right one.

The uncommitted working tree already has `circumstances:decide` limited to `ec-decision-maker` and the new `ec-claim:determine`, with `wellbeing-advisor` still on `ec-claim:read` and `ec-claim:manage` (`packages/domain/src/permissions.ts:137-147`). That matches the ADR, not the recommendation above on `wellbeing-advisor`.

## Variants

| Variant | Position | Configuration or code |
|---|---|---|
| Student route, HEP | Band 2 policy: 60 days (30 remote), PGR excluded (s.7.24–7.28) | Code for F3; thresholds are configuration |
| Student route, non-HEP or level 5 and below | Band 1 attendance rules, 85% and 70% thresholds (s.7.22–7.23); 10 consecutive missed contacts (changes table rows d, e) | Configuration on policy versions, provided the policy model can express monthly percentages; not verified |
| Student finance | SLC attendance confirmation differs by scheme (SFE, SFW, SAAS, SFNI) | Configuration and integration (BP-07-002) |
| Distance and remote delivery | 30-day cap; mode-appropriate contact (A2.1) | Configuration plus F3 |
| PGR | Engagement through supervision contacts; progress review types and outcome sets | Configuration (value sets); F4 is code |
| EC review route | OIA (England, Wales), SPSO (Scotland), NIPSO (Northern Ireland) | Configuration: notice wording |
| Welsh language | Bilingual notices and portal text | Configuration (value-set wording, translations) |

## Data protection

- Engagement data is personal; a reason for authorised absence can be health data. Keep the reason in the attendance module as a code; send only the outcome to core (OQ-3).
- UKVI evidence snapshots are minimum necessary and immutable (ADR-022); keep them only as long as the sponsor-duties record-keeping period requires.
- EC narratives and evidence are special-category in many cases (F6). Lawful basis and Article 9 condition must be recorded by the institution; the wellbeing default `lawful_basis_code` is `gdpr-art6-e` with no Article 9 condition field.
- The OIA framework expects third-party evidence not to be kept longer than any appeal needs (para 42). No EC retention period is set.

## Open questions

| ID | Question | Proposed answer | Confidence | Owner who must decide |
|---|---|---|---|---|
| BP-04-001 OQ-1 | Owner, workflow boundary, requirement and contract mapping | **Close the boundary.** The attendance module holds expected events, observations, corrections, policy versions and alerts; core holds engagement outcomes, the UKVI evidence snapshot and sponsor decisions. The process owner is a role the institution names (student engagement lead). | High (boundary); owner is institutional | Process owner/architect; institution names the owner |
| BP-04-001 OQ-2 | National, provider-type and mode variants needing configuration | **Stay open.** Proposed: the variant table above; F3 is the one code change. | Medium | Four-nation SME; UKVI compliance lead |
| BP-04-001 OQ-3 | Evidence kept in a specialist system; minimum outcome to the SRS | **Close.** Raw capture, device and correction history stay in the capture system and attendance module; core receives the engagement outcome and, for sponsored students, the evidence snapshot. Accessibility-related alternative engagement is recorded as an evidence type, never a diagnosis. | High | DPO confirms |
| BP-04-002 OQ-1 | Owner, workflow boundary, mapping | **Close the boundary.** Intervention casework in the attendance module; status and sponsor decisions in core with independent authorisation. Welfare risk goes to wellbeing early warning, not sanction (E1.1). | High | Process owner/architect |
| BP-04-002 OQ-2 | Variants | **Stay open** (as BP-04-001 OQ-2). | Medium | Four-nation SME |
| BP-04-002 OQ-3 | Evidence and minimum outcome | **Close.** Contact notes stay on the intervention case; a welfare referral carries no narrative; core receives the outcome code and, if referred, the sponsor decision. | High | DPO confirms |
| BP-04-003 OQ-1 | Owner, workflow boundary, mapping | **Close.** Core `ProgressReviewService` on `business_case` (ADR-023); published milestones go to CRIS; an unsatisfactory outcome never changes candidature by itself (E2.1, built). | High | Process owner/architect |
| BP-04-003 OQ-2 | Variants | **Stay open.** Proposed configuration: review types and outcome sets (value sets), part-time timing, MPhil-to-PhD confirmation, professional doctorates, partner authority for collaborative provision. | Medium | PGR SME |
| BP-04-003 OQ-3 | Evidence and minimum outcome | **Close.** Student and supervisor reports are case evidence (`sensitive-academic`); core publishes the outcome and milestone. Health information raised in a review goes to wellbeing, not the case. | Medium | DPO confirms |
| BP-04-004 OQ-1 | Owner, workflow boundary, mapping | **Close the boundary.** Wellbeing module owns the case and evidence; core owns the approved outcome and its distribution (`source_case_id` links them). Owner is the head of disability services. See the D-44 record. | High | Process owner/architect; head of disability services |
| BP-04-004 OQ-2 | Variants | **Stay open.** Northern Ireland is under the Disability Discrimination Act 1995 as amended by SENDO 2005, not the Equality Act 2010; DSA bodies differ by nation. See the D-44 record. | Medium | Four-nation SME; DPO |
| BP-04-004 OQ-3 | Evidence and minimum outcome | **Already answered**; residual EDRMS question is BL-102. The D-44 record adds that approval `notes` must not reach core (D-44 F10). | High | DPO |
| BP-04-005 OQ-1 | Owner, workflow boundary, mapping | **Close the boundary** per ADR-028: one EC case system per tenant (wellbeing module or core), core holds the outcome; who decides is BL-174 above. | High (boundary) | Process owner and academic registrar (BL-174) |
| BP-04-005 OQ-2 | Variants | **Stay open.** Proposed configuration: review-route wording by nation, self-certification limits, fit-to-sit policy, late-claim rules, Welsh language. | Medium | Four-nation SME |
| BP-04-005 OQ-3 | Evidence and minimum outcome | **Close with a change (F6).** Narrative and evidence stay in the case system; core holds scope (modules, period), outcome code, decision provenance and the student-facing reason (F5). Boards see the outcome code and date only (already the case in `board-service.ts:963-978`). | High | DPO confirms |
| BP-04-006 OQ-1 | Owner, workflow boundary, mapping | **Close.** Core `reasonable_adjustment` and `adjustment_distribution` with per-tenant target modes; the delivery ledger for other flows. Owner: the disability service, with the integration administrator for failures. | High | Process owner/architect |
| BP-04-006 OQ-2 | Variants | **Close.** No national variant beyond target configuration; partner-delivered provision is a target-mode and owner setting. | Medium | Four-nation SME confirms |
| BP-04-006 OQ-3 | Evidence and minimum outcome | **Close.** Targets get type, scope, amount and dates only; no notes, diagnosis or case content. | High | DPO confirms |

## Still needs a named person

- **Process owner and academic registrar:** BL-174 (the section above), F5 and the EC review route.
- **Student support reviewer (register role):** BP-04-004 to BP-04-006, with the D-44 reviewers.
- **UKVI compliance lead:** F3 and the 10/2026 re-read (F2); the institution's academic-engagement policy.
- **PGR administration reviewer:** F4 and BP-04-003 OQ-2.
- **DPO:** every OQ-3 above, F6, EC retention, and the Article 9 condition.
- **Scotland, Wales and Northern Ireland reviewers:** variant table, review-route wording.

## Not checked

- Sections of Sponsorship duties 10/2026 beyond 7.10 and 7.13 to 7.31, and what changed since 04/2026.
- SLC attendance guidance (SRC-003) and SRC-047 to SRC-058, not re-fetched.
- The OIA "Appeals" and "Evidence and self-certification" subsections were not read.
- Whether the policy model can express Band 1 monthly percentage thresholds.
- The attendance module's UKVI snapshot and sponsor-decision code beyond the capability row and tests named there.
- The EC routes and permissions are being changed on this branch by another engineer; the state described is the working tree on 2026-11-21.
- No screen or demo walkthrough was run.

## New work (backlog-ready)

| Title | Type | Area | Priority | Size |
|---|---|---|---|---|
| Refresh BP-04-001, 002, 003, 005 and 006 to the built state | Docs | Documentation | P1 | M |
| Update the source register: Sponsorship duties 10/2026, QAA Quality Code 2024, overdue review-by rows | Docs | Documentation | P1 | S |
| Engagement policy guard: 60-day (30 remote) maximum for Student-route policies | Improvement | Engagement | P1 | S |
| PGR progress review: refuse the student's supervisors on the panel; require an independent reviewer | Improvement | PGR | P1 | S |
| EC outcome notice with a student-facing reason and review route, shown in the portal | Feature | Adjustments & EC | P1 | S |
| Move the student's EC narrative out of core when the wellbeing module is the EC system | Improvement | Adjustments & EC | P1 | M |
| EC decision due date (default 14 days) and overdue view | Feature | Adjustments & EC | P2 | S |
| EC panel determinations record members, attendance, conflicts and quorum | Feature | Adjustments & EC | P2 | M |
| Replace or restrict the `condone` EC outcome | Improvement | Adjustments & EC | P3 | S |
| Route EC claims to officer or panel by category | Feature | Adjustments & EC | P3 | M |
| Remove `ec-claim:read` and `ec-claim:manage` from `wellbeing-advisor` if the institution accepts the BL-174 default | Decision | Adjustments & EC | P1 | S |
