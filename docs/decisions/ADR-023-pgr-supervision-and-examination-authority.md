# ADR-023: Govern PGR Supervision and Examination as Business Cases, Not a Bespoke Workflow

**Status**: Accepted for generic product implementation
**Date**: 2026-08-03

## Context

The business-process review (BP-03-007, BP-04-003, BP-05-010, BP-06-006) describes the full postgraduate-research (PGR) lifecycle — supervisory-team nomination and approval, periodic progress review by an independent panel, thesis submission and examiner-panel viva, and completion/award — none of which is implemented (`docs/product/current-capabilities.md` lists PGR lifecycle as Proposed target). ADR-020 already establishes a staged-authority, immutable-ratification-lock pattern for W005 (taught assessment), but is scoped to taught assessment only and does not cover PGR. Building PGR's four processes as independent, bespoke case models would duplicate machinery (`business_case`, `case_decision`, evidence references) that BPR-D01–D19 already share as a common root, per `docs/architecture/business-process-target-data-model.md`.

## Decision

PGR supervision and examination shall be modelled as governed cases rooted on the existing shared `business_case`/`case_decision` primitives (`packages/db/src/schema/business-case.ts`), the same primitive already used by identity resolution, rights requests, corrections, support outcomes and audit review — not as a new bespoke workflow engine or a standalone module.

- A **supervision case** records nomination, HR eligibility/capacity/conflict checks, and the PGR Director/Committee's approve/return/reject decision. Only an approved case may publish an effective-dated `staff_assignment` as current; incomplete or unapproved teams are never represented as current. Changes to an existing team end-date the superseded assignment and create a new one — history is never overwritten.
- A **progress review case** (initial, annual, upgrade/confirmation, return-from-interruption) records panel composition, member conflict declarations/recusal (mirroring the exam-board conflict/quorum pattern already implemented for BPR-D11), evidence considered, and the panel's authorised outcome. An unsatisfactory outcome does not alter candidature until the case is decided under regulations.
- A **thesis examination case** follows ADR-020's staged-authority pattern explicitly: immutable submitted thesis version → examiner nomination and independent-chair approval (independence/conflict checked before distribution) → examiner reports → viva outcome → panel decision → **ratified, immutable outcome lock**. Corrections/revisions are tracked as deadlined requirements linked to the locked outcome; only a linked correction case may amend a ratified examination outcome, never an in-place edit.
- **Completion** verifies the ratified outcome and any required corrections are complete, confirms final thesis deposit, and confers the research award through the same award-conferral authority used for taught awards (`AwardService`), as an explicit, non-automatic step — never a side effect of examination ratification. Supervision and milestone records are closed/end-dated on completion, never deleted.
- HR and CRIS remain the systems of record for staff employment status and researcher-profile/publication activity respectively; SRS is the system of record for the supervision assignment, progress/milestone, and examination outcome facts, exchanged with HR/CRIS via the existing regulator/external-system exchange-ledger pattern (`RegulatoryExchangeService`), not a new integration mechanism.

## Rationale

- Reuses proven primitives instead of building a fourth parallel case/decision/evidence model in the same codebase.
- Keeps academic authority (director approval, panel ratification) distinct from and prior to any downstream system publication (CRIS) or side effect (award conferral).
- Preserves full history of supervisory teams and examination outcomes, matching the bitemporal/append-only conventions already used everywhere else in this codebase.
- Extends ADR-020's staged-authority/ratification-lock reasoning to PGR examination, which has the same premature-publication and unauthorised-post-decision-change risks as taught assessment.

## Consequences

- New `staff_assignment`, `pgr_progress_review`/`pgr_review_member`, `research_milestone`, `pgr_examination_case`/`thesis_submission`/`examiner_appointment`/`examiner_report`/`viva_event`/`pgr_examination_outcome`/`thesis_correction_requirement`/`final_thesis_deposit` entities are required (BPR-D07, BPR-D12).
- `AwardService` requires an additive, PGR-specific conferral path, since the existing `conferAward` is hard-coded to an exam-board-ratified taught classification and cannot represent a pass/fail research-degree outcome without a schema change (`award.exam_board_id` must become nullable, with a new source-case reference added alongside it).
- HEAR generation, which reads `award.exam_board_id` directly, does not extend to PGR awards in this iteration — research awards do not produce a HEAR-equivalent document.
- CRIS/HR integration contracts (`hr-staff-assignments.v1`, `cris-pgr-profile.v1`, `cris-pgr-milestones.v1`) must be added to the existing contract registry and used via the existing exchange-recording path, not a new integration boundary.

## Alternatives Considered

| Alternative | Reason rejected |
|---|---|
| Bespoke PGR-specific workflow/case engine | Duplicates `business_case`/`case_decision` for no benefit; every other governed process in this codebase already shares that root |
| Separate pluggable module (`modules/pgr`), consuming core via events/HTTP | Contradicts the project's own target-architecture docs, which classify PGR (BPR-D07/D12) as core aggregates alongside admissions/offers/module-selection; would require reinventing case/decision/evidence machinery behind a network boundary purely to look at data core already owns |
| Treat examination ratification as directly conferring the award | Removes the explicit, separately-authorised conferral step BP-06-006 requires; risks a conflicted/under-qualified panel's decision alone determining the formal award |
| Reuse `AwardService.conferAward` unmodified, passing a placeholder exam board | Misrepresents PGR examination panels as exam boards; couples an unrelated taught-degree classification check to a pass/fail research outcome |

## Traceability

- Requirements: HRP-002–HRP-006
- Backlog: BPR-D07, D12
- Processes: BP-03-007, BP-04-003, BP-05-010, BP-06-006
