# Phase 5 Implementation Plan — Assessment, Progression, and Awards

> Date: 2026-06-05
> Status: In progress — Stage 7 progression engine implemented; integration verification pending
> Prerequisite: Phase 4 complete (all exit criteria passing)

---

## Overview

Phase 5 delivers the full academic lifecycle from mark ingestion through to ratified awards and locked records. It is the most complex phase in the roadmap: it introduces record locking (a new data invariant that must be enforced everywhere), a configuration-driven progression and classification engine, and the exam board governance workflow that is the authority for all final academic decisions.

The phase is decomposed into thirteen stages. Stages flow in sequence with explicit dependency constraints noted per stage. Each stage must typecheck, lint, and pass all tests (unit and integration) before the next begins.

**Exit criteria (from roadmap)**:
- All Phase 5 functional requirements passing
- Record lock integrity proven — locked records cannot be mutated outside the correction workflow
- Board data preparation verified against known test cohorts
- Configuration-driven rules verified against multiple institutional rule sets

---

## Stage dependency graph

```
Stage 0  (foundation)
    │
Stage 1  (assessment structure)
    │
Stage 2  (mark ingestion)
    │
Stage 2b (module result aggregation)  ◄── feeds board pack in Stage 5
    │
Stage 3  (reasonable adjustments) ── feeds penalty suppression into Stage 2 marks
    │
Stage 4  (exceptional circumstances and misconduct)
    │
Stage 5  (exam board and data pack)
    │
Stage 6  (ratification and record locking)  ◄── GOV-004 enforcement begins here
    │
Stage 7  (progression engine)
    │
Stage 8  (classification and awards)
    │
Stage 9  (post-ratification governance)
    │
Stage 10 (HEAR generation)
    │
Stage 11 (event consumer tests and OpenAPI)
```

**Stage 3 note**: `reasonable_adjustment` records are needed by Stage 2's late-penalty suppression logic. Stage 2 is implemented with a null-safe adjustment lookup so it compiles and tests clean without adjustments; Stage 3 then fills in the real records and adds integration tests verifying suppression.

**Stage 2b note**: `module_result` rows are required by the Stage 5 board data pack. Stage 2b is implemented immediately after mark ingestion; Stage 2's mark service calls `ModuleResultService.recalculate` after every mark write so results are always current.

---

## Stage 0 — Foundation: Schema, Domain Events, Value Sets

**Scope**: All Phase 5 tables created in one migration, RLS enabled, value sets seeded, and domain event payload contracts defined. No service or API code; only the structural substrate. This mirrors the Phase 4 migration approach and lets all subsequent stages build on a stable schema.

### Database migration (`0004_phase5_assessment_schema.sql`)

Tables to create (all tenant-scoped unless noted):

**Assessment:**
- `assessment_component` — components per module offering (weighting, pass mark, type)
- `assessment_submission` — append-only intake record from source systems; one row per submission event. A `mark` row is created (or updated) from a submission; `mark.assessment_submission_id` is the FK linking the two. Superseded submissions keep their row; the active mark always reflects the latest non-superseded submission.
- `mark` — bitemporal; raw mark, adjusted mark, attempt number, penalty flag, lock flag, `assessment_submission_id` (nullable FK to `assessment_submission`)
- `module_result` — bitemporal; aggregate mark, result code, lock flag

**Adjustments:**
- `reasonable_adjustment` — bitemporal; adjustment type, scope, valid period
- `adjustment_distribution` — append-only; per-target-system distribution status ledger

**Exceptional circumstances and misconduct:**
- `exceptional_circumstances` — bitemporal; outcome code, module offering, determination date
- `exceptional_circumstances_board_visibility` — append-only; links EC flags to board packs
- `misconduct_case_reference` — bitemporal; external AI case reference
- `misconduct_outcome` — bitemporal; penalty code, effective date
- `misconduct_penalty_effect` — bitemporal; structured penalty impact per mark/registration

**Exam board:**
- `exam_board` — board definition (type, period, meeting date, ratification timestamp)
- `exam_board_data_pack` — point-in-time snapshot artefact; snapshot payload is immutable, while `superseded_by_id` is the only mutable metadata field and is set when a newer pack is generated. Columns: `pack_id`, `exam_board_id`, `pack_version` (integer, incremented per regeneration), `superseded_by_id` (nullable self-FK), `source_transaction_time` (for exact reproduction), `generated_at`, `candidate_count`
- `exam_board_candidate_profile` — append-only per pack; JSONB snapshot, `pack_id` FK
- `exam_board_member_attendance` — append-only
- `external_examiner_signoff` — append-only

**Progression and awards:**
- `progression_decision` — bitemporal; decision code, year of study, lock flag
- `award` — bitemporal; qualification, classification, award date, HEAR and certificate timestamps

**Post-ratification:**
- `post_ratification_case` — bitemporal; appeal/correction case
- `post_ratification_amendment` — append-only; entity type, entity id, before/after JSONB, authorising actor

**RLS**: all tables above that carry `tenant_id` must have `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` with the standard `app.current_tenant_id` policy.

### Drizzle schema files

New schema files under `packages/db/src/schema/`:
- `assessment.ts` — assessment_component, assessment_submission, mark, module_result
- `adjustment.ts` — reasonable_adjustment, adjustment_distribution
- `circumstances.ts` — exceptional_circumstances, exceptional_circumstances_board_visibility, misconduct_case_reference, misconduct_outcome, misconduct_penalty_effect
- `governance.ts` — exam_board, exam_board_data_pack, exam_board_candidate_profile, exam_board_member_attendance, external_examiner_signoff
- `progression.ts` — progression_decision, award, post_ratification_case, post_ratification_amendment

Export all from `packages/db/src/schema/index.ts`.

### Value set seeds (`0005_seed_phase5_field_mappings.sql`)

New value sets required:
- `result-code` — `pass`, `fail`, `compensated`, `condoned`, `deferred`, `resit-required`
- `adjustment-type-code` — `extra-time`, `separate-room`, `deadline-extension`, `reader`, `scribe`, `rest-breaks`
- `adjustment-scope-code` — `all`, `exam`, `coursework`, `attendance`
- `board-type-code` — `module`, `award`
- `decision-code` — `progress`, `resit`, `repeat-year`, `withdraw`
- `penalty-code` — `mark-reduction`, `mark-cap`, `module-fail`, `progression-block`, `exclusion`
- `assessment-component-type` — `exam`, `coursework`, `practical`, `portfolio`, `presentation`
- `distribution-status-code` — `pending`, `distributed`, `failed`, `superseded`
- `case-type-code` — `appeal`, `administrative-correction`
- `post-ratification-case-status-code` — `submitted`, `under-review`, `upheld`, `dismissed`, `not-eligible`
- Field mappings for all new entities

### Domain event contracts (`packages/domain/src/events/`)

New event payload files:

**Assessment:**
- `assessment/mark-received.v1.ts` — `markId`, `moduleRegistrationId`, `assessmentComponentId`, `rawMark`, `attemptNumber`, `sourceSystem`
- `assessment/mark-updated.v1.ts` — `markId`, `previousMark`, `newMark`, `reason`
- `assessment/module-result-calculated.v1.ts` — `moduleRegistrationId`, `moduleResultId`, `aggregateMark`, `resultCode`
- `assessment/module-result-ratified.v1.ts` — extends calculated with `examBoardId`, `ratifiedAt`

**Adjustment:**
- `adjustment/approved.v1.ts` — `enrolmentId`, `personId`, `adjustmentId`, `adjustmentTypeCode`, `scopeCode`, `validFrom`, `validTo`
- `adjustment/distributed.v1.ts` — `adjustmentId`, `targetSystem`, `distributedAt`
- `adjustment/expired.v1.ts` — `adjustmentId`, `enrolmentId`, `expiredAt`

**Exceptional circumstances:**
- `circumstances/exceptional-circumstances-flagged.v1.ts` — `enrolmentId`, `personId`, `moduleOfferingId`, `outcomeCode`, `determinationDate`
- `circumstances/exceptional-circumstances-updated.v1.ts` — `exceptionalCircumstancesId`, `previousOutcomeCode`, `newOutcomeCode`

**Exam board:**
- `governance/exam-board-data-pack-ready.v1.ts` — `examBoardId`, `boardType`, `academicPeriod`, `candidateCount`, `packVersion`
- `governance/exam-board-ratified.v1.ts` — `examBoardId`, `boardType`, `academicPeriod`, `ratifiedAt`, `externalExaminerConfirmedAt`
- `governance/record-locked.v1.ts` — `examBoardId`, `lockedEntityTypes`, `lockedCount`
- `governance/record-amended-post-ratification.v1.ts` — `entityType`, `entityId`, `appealReference`, `amendedBy`, `amendedAt`

**Progression and awards:**
- `progression/decided.v1.ts` — `enrolmentId`, `personId`, `academicYear`, `yearOfStudy`, `decisionCode`, `examBoardId`
- `award/conferred.v1.ts` — `enrolmentId`, `personId`, `awardId`, `qualificationCode`, `classificationCode`, `awardDate`

Register all new subjects in `EVENT_TYPES` in `packages/domain/src/events/index.ts`. All subjects **must** carry the `srs.` prefix so they are captured by the `SRS_EVENTS` JetStream stream (`srs.>`):

```typescript
ASSESSMENT_MARK_RECEIVED:                 'srs.assessment.mark-received',
ASSESSMENT_MARK_UPDATED:                  'srs.assessment.mark-updated',
ASSESSMENT_MODULE_RESULT_CALCULATED:      'srs.assessment.module-result-calculated',
ASSESSMENT_MODULE_RESULT_RATIFIED:        'srs.assessment.module-result-ratified',
ADJUSTMENT_APPROVED:                      'srs.adjustment.approved',
ADJUSTMENT_DISTRIBUTED:                   'srs.adjustment.distributed',
ADJUSTMENT_EXPIRED:                       'srs.adjustment.expired',
CIRCUMSTANCES_EC_FLAGGED:                 'srs.circumstances.exceptional-circumstances-flagged',
CIRCUMSTANCES_EC_UPDATED:                 'srs.circumstances.exceptional-circumstances-updated',
GOVERNANCE_EXAM_BOARD_DATA_PACK_READY:    'srs.governance.exam-board-data-pack-ready',
GOVERNANCE_EXAM_BOARD_RATIFIED:           'srs.governance.exam-board-ratified',
GOVERNANCE_RECORD_LOCKED:                 'srs.governance.record-locked',
GOVERNANCE_RECORD_AMENDED:                'srs.governance.record-amended-post-ratification',
PROGRESSION_DECIDED:                      'srs.progression.decided',
AWARD_CONFERRED:                          'srs.award.conferred',
```

### New permissions (`packages/domain/src/permissions.ts`)

Add the following to `PERMISSION_ROLES` before implementation begins. Subsequent stages reference these permissions; they must exist from Stage 0.

```typescript
'exam-board:write':    ['registry-administrator'] as Role[],
'circumstances:write': ['registry-administrator'] as Role[],
'circumstances:read':  ['registry-administrator', 'wellbeing-advisor'] as Role[],
'progression:write':   ['registry-administrator'] as Role[],
'progression:read':    ['registry-administrator', 'exam-board-chair', 'exam-board-member'] as Role[],
```

### Rules engine additions

Add new `RuleTypeCode` entries to `apps/api/src/platform/rules-engine/engine.ts`:
- `late-penalty-rate` — percentage deducted per day/period
- `late-penalty-cap` — maximum total penalty
- `resit-mark-cap` — maximum mark achievable on resit
- `compensation-threshold` — minimum mark for compensation eligibility
- `compensation-credit-limit` — maximum compensatable credit per level
- `condonement-threshold` — minimum mark for condonement
- `progression-credit-requirement` — credits required to progress
- `classification-boundary` — mark boundaries per classification band
- `classification-algorithm` — algorithm variant (best-of, weighted average, etc.)

### Verification

- `pnpm typecheck`
- `pnpm test` (migration tests for all new tables, RLS, bitemporal constraints)

---

## Stage 1 — Assessment Structure (ASS-008)

**Scope**: Assessment components defined per module offering. This is the structural configuration that drives mark aggregation in Stage 2b. Components carry weightings, pass marks, and type codes, and are versioned against academic year via the module offering's temporal context.

### Implementation

**Service** `apps/api/src/platform/assessment/component-service.ts`:
- `createAssessmentComponent(tenantId, moduleOfferingId, input)` — validates weightings, inserts component
- `listAssessmentComponents(moduleOfferingId, tenantId)` — returns all components for an offering
- `updateAssessmentComponent(componentId, tenantId, input)` — corrects component definition; throws `ValidationError` (422) if any `mark` row already references this component (`mark.assessment_component_id = componentId` with `recorded_until IS NULL`). Components are immutable once marks have been ingested.
- Validation: total weighting across all components for a module offering must equal 100

**Routes** `/api/v1/module-offerings/:moduleOfferingId/components`:
- `POST` — create assessment component (`catalogue:write`)
- `GET` — list assessment components (`catalogue:read`)
- `PATCH /:componentId` — update component (`catalogue:write`; blocked when marks exist)

**Audit**: all write operations.

**OpenAPI tag**: `assessment`

### Verification

- Creating components with total weighting over 100 returns 422
- Component list scoped to tenant
- `updateAssessmentComponent` returns 422 when marks already exist for the component
- Component updates validated pre-mark-ingestion

### Stage 1 Execution Status

Stage 1 is complete.

Implemented:
- Assessment component service and routes for create, list, and update.
- Component type validation via `assessment-component-type`.
- Tenant-scoped module-offering ownership checks.
- Weighting validation so an offering cannot exceed 100 total component weighting.
- Update blocking once current marks reference a component.
- Audit writes for component create/update.
- OpenAPI `assessment` tag wiring.

Verification passed:
- `pnpm typecheck`
- Targeted ESLint on Stage 1 files
- `pnpm --filter @revelation-srs/api exec vitest run --config vitest.int.config.ts test/assessment-components.int.test.ts --reporter=verbose`
- `pnpm --filter @revelation-srs/api test`
- `pnpm test:int`

---

## Stage 2 — Mark Ingestion and Management (ASS-001, ASS-003, ASS-004, ASS-006)

**Scope**: Mark records are the foundation of the assessment pipeline. This stage implements mark receipt from source systems, late penalty application, resit mark tracking, and mark correction. Late penalty suppression via adjustments is implemented as a null-safe hook — it correctly suppresses penalties when an active adjustment exists (populated in Stage 3), and applies penalties unconditionally otherwise.

### Implementation

**Service** `apps/api/src/platform/assessment/mark-service.ts`:
- `ingestMark(tenantId, moduleRegistrationId, input, actorId)` — creates a bitemporal mark record; derives `adjusted_mark` after applying any late penalty; stores `assessment_submission_id` if the call originates from a source-system submission; publishes `srs.assessment.mark-received`
- `updateMark(markId, tenantId, input, actorId)` — calls `assertNotLocked(mark)` first; closes current version, inserts corrected version; publishes `srs.assessment.mark-updated`
- `listMarks(moduleRegistrationId, tenantId)` — returns current marks per registration
- `#applyLatePenalty(mark, tenantId)` — queries the rules engine for `late-penalty-rate`; queries `reasonable_adjustment` for an active deadline-extension covering the student; suppresses penalty if found

**Routes**:
- `POST /api/v1/module-registrations/:id/marks` — ingest mark (`mark:write`)
- `GET /api/v1/module-registrations/:id/marks` — list marks (`mark:read:all`)
- `PATCH /api/v1/marks/:markId` — correct mark (`mark:write`; blocked when `locked = true`)
- `GET /api/v1/marks/:markId/history` — bitemporal mark history (`mark:read:all`)

**Lock enforcement**: `updateMark` calls `assertNotLocked(mark)` (see Key Decisions) and throws `ForbiddenError` (403) if `mark.locked = true`.

**Events**: `srs.assessment.mark-received` (personal classification), `srs.assessment.mark-updated` (personal classification).

**OpenAPI tag**: `assessment`

### Verification

- Mark ingestion creates bitemporal record with correct penalty calculation
- Late penalty suppressed when active deadline-extension adjustment in force
- Locked mark rejects mutation with 403
- Cross-tenant isolation
- Both events published with correct payload

### Stage 2 Execution Status

**Status**: Complete — 2026-06-05

Implemented:
- `MarkService` with mark ingestion, listing, bitemporal correction, history retrieval, source submission capture, late penalty calculation, and deadline-extension suppression
- Shared `assertNotLocked` guard for mark mutation, returning 403 for locked current marks
- Mark REST routes under `/api/v1/module-registrations/:moduleRegistrationId/marks` and `/api/v1/marks/:markId`
- Audit records for user-initiated mark create/update operations
- Personal-classification events `srs.assessment.mark-received` and `srs.assessment.mark-updated`
- OpenAPI assessment tagging for mark routes

Verification passed:
- `pnpm typecheck`
- `pnpm exec eslint apps/api/src/platform/assessment/lock.ts apps/api/src/platform/assessment/mark-service.ts apps/api/src/routes/marks.ts apps/api/src/app.ts apps/api/test/marks.int.test.ts`
- `pnpm --filter @revelation-srs/api test`
- `pnpm --filter @revelation-srs/api exec vitest run --config vitest.int.config.ts test/marks.int.test.ts --reporter=verbose`
- `pnpm --filter @revelation-srs/api exec vitest run --config vitest.int.config.ts --reporter=verbose`

---

## Stage 2b — Module Result Aggregation (ASS-002, ASS-007)

**Scope**: After each mark is ingested or corrected, the aggregate module result for that registration is recalculated and stored bitemporally. This ensures `module_result` rows are always current and available for the board data pack (Stage 5). Module results are also the unit that the ratification workflow locks (Stage 6).

### Implementation

**Service** `apps/api/src/platform/assessment/module-result-service.ts`:
- `recalculate(moduleRegistrationId, tenantId)` — fetches all current marks for the registration; applies component weightings from `assessment_component`; derives `aggregate_mark` and `result_code` (pass/fail/deferred based on rules engine `pass-mark` rule); closes any existing current `module_result` version and inserts new version; publishes `srs.assessment.module-result-calculated`. No-ops if no marks exist yet.
- `getResult(moduleRegistrationId, tenantId)` — returns current module result
- `getResultHistory(moduleRegistrationId, tenantId)` — full bitemporal history

**Integration with Stage 2**: `MarkService.ingestMark` and `MarkService.updateMark` both call `ModuleResultService.recalculate` after a successful mark write. This is the only path that creates or updates module results — there is no separate API endpoint for triggering recalculation.

**Routes**:
- `GET /api/v1/module-registrations/:id/result` — current module result (`mark:read:all`)
- `GET /api/v1/module-registrations/:id/result/history` — bitemporal history (`mark:read:all`)

There is no `POST` or `PATCH` route for module results — they are derived exclusively from marks.

**Audit**: result writes are system-initiated (not user-initiated); no audit record needed beyond the mark audit trail.

**Events**: `srs.assessment.module-result-calculated` (personal classification).

**OpenAPI tag**: `assessment`

### Verification

- Ingesting a mark triggers recalculation; module result row exists
- Result reflects correct weighted aggregate across all components
- Correcting a mark triggers recalculation; new result version created
- Cross-tenant isolation
- `module-result-calculated` event published with correct payload

### Stage 2b Execution Status

**Status**: Complete — 2026-06-05

Implemented:
- `ModuleResultService` with weighted aggregation from current adjusted marks, bitemporal result replacement, current result retrieval, and result history retrieval
- Automatic recalculation after `MarkService.ingestMark` and `MarkService.updateMark`
- Deferred results while some configured components have no current mark; pass/fail results once all components are marked
- Component pass mark override support with tenant/programme pass-mark rule fallback; default pass mark of 40 when no rule is configured
- Shared `assertNotLocked` guard for current module result recalculation
- Read-only result routes under `/api/v1/module-registrations/:moduleRegistrationId/result` and `/api/v1/module-registrations/:moduleRegistrationId/result/history`
- Personal-classification event `srs.assessment.module-result-calculated`
- OpenAPI assessment tagging for module result routes

Verification passed:
- `pnpm typecheck`
- `pnpm exec eslint apps/api/src/platform/assessment/module-result-service.ts apps/api/src/platform/assessment/mark-service.ts apps/api/src/routes/module-results.ts apps/api/src/app.ts apps/api/test/module-results.int.test.ts`
- `pnpm --filter @revelation-srs/api test`
- `pnpm --filter @revelation-srs/api exec vitest run --config vitest.int.config.ts test/module-results.int.test.ts --reporter=verbose`
- `pnpm --filter @revelation-srs/api exec vitest run --config vitest.int.config.ts test/marks.int.test.ts --reporter=verbose`
- `pnpm --filter @revelation-srs/api exec vitest run --config vitest.int.config.ts --reporter=verbose`

---

## Stage 3 — Reasonable Adjustments (ADJ-001 through ADJ-006)

**Scope**: Reasonable adjustment outcomes received from the Wellbeing and Disability system are recorded bitemporally and distributed to downstream systems. The distribution ledger follows the same append-only trigger pattern established for UCAS/SLC/UKVI downstream triggers in Phase 4. This stage also completes the late-penalty suppression hook in Stage 2.

### Implementation

**Service** `apps/api/src/platform/adjustments/adjustment-service.ts`:
- `recordAdjustment(tenantId, input, actorId)` — stores adjustment bitemporally; creates `adjustment_distribution` rows for each applicable target system (`vle`, `attendance`, `exams`); publishes `srs.adjustment.approved`
- `listAdjustments(enrolmentId, tenantId)` — returns current adjustments
- `listDistributions(adjustmentId, tenantId)` — returns distribution ledger
- `acknowledgeDistribution(adjustmentId, distributionId, tenantId, targetSystem)` — advances the named distribution row to `distributed` status; publishes `srs.adjustment.distributed`. This is called by integration services after they have applied the adjustment in the downstream system.
- `expireAdjustment(adjustmentId, tenantId, actorId)` — closes current version; sets all `pending` distribution rows to `superseded`; publishes `srs.adjustment.expired`

**Distribution ledger**: one `adjustment_distribution` row per target system per adjustment, status `pending` on creation. When a downstream system applies the adjustment it calls `POST /api/v1/adjustments/:id/distributions/:distributionId/acknowledge`. The `adjustment.distributed` event is published per acknowledgement.

**Routes**:
- `POST /api/v1/students/:personId/adjustments` — record adjustment (`adjustment:write`)
- `GET /api/v1/students/:personId/adjustments` — list current adjustments (`adjustment:read:all`)
- `GET /api/v1/adjustments/:adjustmentId/distributions` — distribution status (`adjustment:read:all`)
- `POST /api/v1/adjustments/:adjustmentId/distributions/:distributionId/acknowledge` — mark as distributed (`integration:manage`)
- `POST /api/v1/adjustments/:adjustmentId/expire` — expire adjustment (`adjustment:write`)

**Events**: `srs.adjustment.approved` (sensitive classification), `srs.adjustment.distributed` (sensitive), `srs.adjustment.expired` (sensitive).

**Stage 2 integration**: after Stage 3 is in place, add an integration test to Stage 2's test file verifying that penalty suppression fires correctly when an active adjustment with `scope: coursework` exists.

**OpenAPI tag**: `adjustments`

### Verification

- Adjustment creation generates distribution ledger rows for all applicable systems
- `acknowledge` endpoint advances status to `distributed` and publishes event
- Adjustment list scoped to tenant
- Adjustment expiry closes bitemporal version and supersedes pending distributions
- ADJ-004: verify that adjustments received via this API (not directly in downstream system) is the only path
- All events published with correct payload and classification

### Stage 3 Execution Status

**Status**: Complete — 2026-06-05

Implemented:
- `AdjustmentService` with bitemporal adjustment recording, current adjustment listing, distribution ledger listing, distribution acknowledgement, and adjustment expiry
- Value-set validation for `reasonable_adjustment.adjustment_type_code` and `reasonable_adjustment.scope_code`
- Distribution target derivation by scope: `all` to VLE/attendance/exams, `coursework` to VLE, `exam` to exams, and `attendance` to attendance
- Adjustment REST routes under `/api/v1/students/:personId/adjustments` and `/api/v1/adjustments/:adjustmentId/...`
- Audit records for user-initiated adjustment create/expire operations
- Sensitive-classification events `srs.adjustment.approved`, `srs.adjustment.distributed`, and `srs.adjustment.expired`
- Stage 2 mark suppression test now creates the deadline-extension adjustment through the adjustment API
- OpenAPI `adjustments` tag and URL tagging

Verification passed:
- `pnpm typecheck`
- `pnpm exec eslint apps/api/src/platform/adjustments/adjustment-service.ts apps/api/src/routes/adjustments.ts apps/api/src/app.ts apps/api/test/adjustments.int.test.ts apps/api/test/marks.int.test.ts`
- `pnpm --filter @revelation-srs/api test`
- `pnpm --filter @revelation-srs/api exec vitest run --config vitest.int.config.ts test/adjustments.int.test.ts --reporter=verbose`
- `pnpm --filter @revelation-srs/api exec vitest run --config vitest.int.config.ts test/marks.int.test.ts --reporter=verbose`
- `pnpm --filter @revelation-srs/api exec vitest run --config vitest.int.config.ts --reporter=verbose`

---

## Stage 4 — Exceptional Circumstances and Misconduct (EXC-001 to EXC-004, ASS-009, ASS-010)

**Scope**: EC outcomes and misconduct outcomes are recorded against students and modules. Both are surfaced in the exam board data pack (Stage 5). EC and misconduct are distinct: EC flags are ad-hoc, time-bound, and for board consideration only; adjustments (Stage 3) are ongoing operational accommodations. They must not share an access-control boundary.

### Implementation

**EC service** `apps/api/src/platform/circumstances/ec-service.ts`:
- `recordExceptionalCircumstances(tenantId, input, actorId)` — stores EC flag bitemporally; publishes `srs.circumstances.exceptional-circumstances-flagged`
- `updateExceptionalCircumstances(ecId, tenantId, input, actorId)` — closes/re-inserts; publishes `srs.circumstances.exceptional-circumstances-updated`
- `listExceptionalCircumstances(enrolmentId, tenantId)` — returns current EC flags

**Misconduct service** `apps/api/src/platform/circumstances/misconduct-service.ts`:
- `recordMisconductOutcome(tenantId, input, actorId)` — stores misconduct case reference and outcome; creates penalty effect rows; publishes corresponding events
- `listMisconductOutcomes(enrolmentId, tenantId)` — returns current outcomes

**Routes**:
- `POST /api/v1/students/:personId/exceptional-circumstances` — record EC (`circumstances:write`)
- `GET /api/v1/students/:personId/exceptional-circumstances` — list EC (`circumstances:read`)
- `PATCH /api/v1/exceptional-circumstances/:ecId` — update EC flag (`circumstances:write`)
- `POST /api/v1/students/:personId/misconduct-outcomes` — record misconduct (`mark:write`)
- `GET /api/v1/students/:personId/misconduct-outcomes` — list outcomes (`mark:read:all`)

Note: EC routes use `circumstances:write`/`circumstances:read` (not `adjustment:write`) to preserve the EC/adjustment separation required by EXC-004.

**Events**: `srs.circumstances.exceptional-circumstances-flagged` (sensitive), `srs.circumstances.exceptional-circumstances-updated` (sensitive).

**OpenAPI tag**: `circumstances`

### Verification

- EC and misconduct records scoped to tenant
- EC flags correctly associated with module offerings
- EXC-004: confirm no route accepts both adjustment and EC data in the same call; EC routes require `circumstances:write`, adjustment routes require `adjustment:write`
- Events published with correct classification

### Stage 4 Execution Status

**Status**: Complete — 2026-06-05

Implemented:
- `ExceptionalCircumstancesService` with bitemporal EC recording, current EC listing, bitemporal EC update, module offering association, and sensitive EC events
- `MisconductService` with misconduct case reference creation, misconduct outcome creation, penalty-code validation, structured penalty effects, and current misconduct listing
- Circumstances REST routes for exceptional circumstances and misconduct outcomes
- EC routes use `circumstances:read`/`circumstances:write`; adjustment routes remain on `adjustment:*`, preserving the EXC-004 access-control separation
- Misconduct routes use `mark:write` and `mark:read:all`, matching their impact on assessment/board workflows
- Audit records for EC create/update and misconduct outcome create
- OpenAPI `circumstances` tag and URL tagging

Verification passed:
- `pnpm typecheck`
- `pnpm exec eslint apps/api/src/platform/circumstances/ec-service.ts apps/api/src/platform/circumstances/misconduct-service.ts apps/api/src/routes/circumstances.ts apps/api/src/app.ts apps/api/test/circumstances.int.test.ts`
- `pnpm --filter @revelation-srs/api test`
- `pnpm --filter @revelation-srs/api exec vitest run --config vitest.int.config.ts test/circumstances.int.test.ts --reporter=verbose`
- `pnpm --filter @revelation-srs/api exec vitest run --config vitest.int.config.ts --reporter=verbose`

---

## Stage 5 — Exam Board and Data Pack (GOV-001, GOV-002, GOV-005, GOV-006)

**Scope**: Exam boards are created and their data packs generated. A data pack captures an immutable, point-in-time snapshot of all candidate information for a board: module marks, component breakdowns, module results, adjustment indicators, EC flags, misconduct outcomes, and pre-board classification calculations. The `source_transaction_time` field allows exact reproduction of any historical pack. Regeneration supersedes the previous pack via the previous pack's `superseded_by_id` metadata field.

### Implementation

**Service** `apps/api/src/platform/governance/board-service.ts`:
- `createExamBoard(tenantId, input, actorId)` — creates board record
- `generateDataPack(examBoardId, tenantId, actorId)`:
  1. Queries all candidate data as of `NOW()` (the `source_transaction_time`)
  2. Computes pre-board classification recommendations using the rules engine
  3. Determines the next `pack_version` (previous max + 1, starting at 1)
  4. Writes `exam_board_data_pack` with `source_transaction_time`, `pack_version`, and `superseded_by_id = null`
  5. Updates the previous current pack row to set `superseded_by_id` = new pack id
  6. Writes one `exam_board_candidate_profile` JSONB row per candidate, linked to the new pack
  7. Publishes `srs.governance.exam-board-data-pack-ready`
- `getDataPack(examBoardId, tenantId)` — returns the current (non-superseded) data pack summary and candidate count
- `getCandidateProfile(dataPackId, enrolmentId, tenantId)` — returns individual candidate snapshot
- `recordMemberAttendance(examBoardId, tenantId, actor, roleCode)` — appends attendance record
- `recordExternalExaminerSignoff(examBoardId, tenantId, actor, commentary)` — appends sign-off record

**Data pack candidate profile** includes for each enrolled candidate:
- Module registrations and current module results
- Per-component marks and adjusted marks
- Active adjustment indicators (type and scope only — minimised payload)
- EC flags for the relevant assessment period
- Misconduct outcome flags
- Pre-board classification recommendation (rules-engine output, labelled as recommendation only)

**Routes**:
- `POST /api/v1/exam-boards` — create board (`exam-board:write`)
- `GET /api/v1/exam-boards/:boardId` — read board (`exam-board:read`)
- `POST /api/v1/exam-boards/:boardId/data-pack` — generate pack (`exam-board:write`)
- `GET /api/v1/exam-boards/:boardId/data-pack` — read current pack summary (`exam-board:read`)
- `GET /api/v1/exam-boards/:boardId/candidates/:enrolmentId` — candidate profile (`exam-board:read`)
- `POST /api/v1/exam-boards/:boardId/attendance` — record attendance (`exam-board:write`)
- `POST /api/v1/exam-boards/:boardId/external-examiner-signoff` — record sign-off (`exam-board:ratify`)

**Permissions**: `exam-board:write` is held by `registry-administrator` (defined in Stage 0). `exam-board:ratify` is held by `exam-board-chair` (already in `permissions.ts`).

**Events**: `srs.governance.exam-board-data-pack-ready` (standard classification).

**OpenAPI tag**: `governance`

### Verification

- Data pack generation captures correct candidate profiles at point-in-time
- EC flags and adjustment indicators surface in candidate profiles
- GOV-002: board members with `exam-board:read` can access candidate profiles; others cannot
- Re-generating a pack sets `superseded_by_id` on the previous pack and increments `pack_version`
- Event published with correct candidate count and `packVersion`

### Stage 5 Execution Status

**Status**: Complete — 2026-06-05

Implemented:
- `BoardService` with exam board creation/read, data pack generation/regeneration, current data pack read, candidate profile read, member attendance, and external examiner signoff
- Candidate profile snapshots containing module registrations, current module results, component marks, active adjustment indicators with distribution statuses, EC flags, misconduct flags/effects, and a labelled pre-board recommendation placeholder for later progression/classification stages
- Pack regeneration semantics: new immutable pack row, incremented `pack_version`, and previous current pack updated with `superseded_by_id`
- Governance REST routes for boards, data packs, candidate profiles, attendance, and signoff
- Audit records for board and data pack creation
- Standard-classification event `srs.governance.exam-board-data-pack-ready`
- OpenAPI `governance` tag and URL tagging

Verification passed:
- `pnpm typecheck`
- `pnpm exec eslint apps/api/src/platform/governance/board-service.ts apps/api/src/routes/exam-boards.ts apps/api/src/app.ts apps/api/test/exam-boards.int.test.ts`
- `pnpm --filter @revelation-srs/api test`
- `pnpm --filter @revelation-srs/api exec vitest run --config vitest.int.config.ts test/exam-boards.int.test.ts --reporter=verbose`
- `pnpm --filter @revelation-srs/api exec vitest run --config vitest.int.config.ts --reporter=verbose`

---

## Stage 6 — Ratification and Record Locking (GOV-003, GOV-004, GOV-005, GOV-010, ASS-005)

**Scope**: This is the most consequential stage. The exam board chair ratifies outcomes; the system locks all covered records. From this point on, any attempt to mutate a locked mark, module result, or progression decision is rejected with 403 unless routed through the appeal/correction workflow (Stage 9). GOV-010's `locked` flag is exposed on all affected read endpoints.

### Implementation

**Service additions to `BoardService`**:
- `ratifyBoard(examBoardId, tenantId, actorId)`:
  1. Validates external examiner sign-off is recorded; throws `ValidationError` (422) if absent
  2. **All steps 3–5 execute inside a single database transaction.** If any step fails, the entire operation rolls back — partial locks are not permitted.
  3. Sets `exam_board.ratified_at = NOW()` within the transaction
  4. Updates all `module_result` rows covered by this board to `locked = true` within the transaction
  5. Updates all `mark` rows under covered module results to `locked = true` within the transaction
  6. After the transaction commits: publishes `srs.governance.exam-board-ratified`, `srs.governance.record-locked`, and `srs.assessment.module-result-ratified` for each module result

  "Covered by this board" is determined by `module_result` rows whose `module_registration_id` belongs to enrolments with `academic_year_of_entry` matching the board's configured academic year and whose associated `module_offering` falls within the board's academic period scope.

**Lock enforcement** — extend existing service methods:
- `MarkService.updateMark` — already enforces (Stage 2)
- `ModuleResultService` — there is no direct update route; results are recalculated from marks. Lock enforcement on marks is sufficient.
- `ProgressionService.updateDecision` — enforces (relevant in Stage 7 and beyond)

**Read endpoint additions**: all GET endpoints for marks, module results, and progression decisions add `locked: boolean` to their response schema.

**Routes**:
- `POST /api/v1/exam-boards/:boardId/ratification` — ratify board (`exam-board:ratify`)

**Events**: `srs.governance.exam-board-ratified` (standard), `srs.governance.record-locked` (standard), `srs.assessment.module-result-ratified` (personal) — one per module result covered by the board.

**OpenAPI tag**: `governance`

### Verification (critical)

- Ratification without external examiner sign-off returns 422
- After ratification:
  - `PATCH /marks/:id` returns 403
  - All affected GET responses include `locked: true`
- Records outside the board's scope remain mutable
- If the database update for marks fails after module results are updated, the whole operation rolls back (no partial lock state)
- All three events published with correct payloads

### Stage 6 Execution Status

**Status**: Complete — 2026-06-05

Implemented:
- `BoardService.ratifyBoard` with external examiner signoff validation, duplicate-ratification protection, covered-module-result discovery, and transactional board/module-result/mark locking
- `POST /api/v1/exam-boards/:boardId/ratification` guarded by `exam-board:ratify`
- Current `module_result` and `mark` rows covered by the board are locked in the same transaction as `exam_board.ratified_at`
- Lock scope follows board academic year and optional academic period
- Existing mark update lock guard now blocks post-ratification mark correction outside the correction workflow
- Ratification events: `srs.governance.exam-board-ratified`, `srs.governance.record-locked`, and per-result `srs.assessment.module-result-ratified`

Verification passed:
- `pnpm typecheck`
- `pnpm exec eslint apps/api/src/platform/governance/board-service.ts apps/api/src/routes/exam-boards.ts apps/api/test/exam-boards.int.test.ts`
- `pnpm --filter @revelation-srs/api test`
- `pnpm --filter @revelation-srs/api exec vitest run --config vitest.int.config.ts test/exam-boards.int.test.ts --reporter=verbose`
- `pnpm --filter @revelation-srs/api exec vitest run --config vitest.int.config.ts --reporter=verbose`

---

## Stage 7 — Progression Rules Engine (PRG-001, PRG-002, PRG-006)

**Scope**: At year end, progression is evaluated per enrolment using the configured academic rules. This stage reuses the rules engine established in Phase 3 and extended in Phase 4, adding new rule types: progression credit requirement, compensation threshold, condonement threshold. The output is a `progression_decision` record which is locked on ratification.

### Implementation

**Service** `apps/api/src/platform/progression/progression-service.ts`:
- `evaluateProgression(enrolmentId, tenantId, academicYear, actorId)`:
  1. Fetches all module results for the enrolment in the given academic year
  2. Queries rules engine for credit requirements, compensation/condonement thresholds, passing `asOfDate = academicYearEndDate(academicYear)` so historical decisions reconstruct against rules in force at the time (PRG-006)
  3. Applies compensation: identifies fails within threshold, checks credit limit not exceeded
  4. Applies condonement: for remaining borderline fails
  5. Determines outcome: `progress` / `resit` / `repeat-year` / `withdraw`
  6. Records `progression_decision` (bitemporal); calls `assertNotLocked` if a prior decision exists
  7. Publishes `srs.progression.decided`
- `getProgressionDecision(enrolmentId, tenantId, academicYear)` — read current decision
- `getProgressionHistory(enrolmentId, tenantId)` — full bitemporal history

**Routes**:
- `POST /api/v1/enrolments/:enrolmentId/progression` — evaluate and record progression (`progression:write`)
- `GET /api/v1/enrolments/:enrolmentId/progression` — current progression decision (`progression:read`)
- `GET /api/v1/enrolments/:enrolmentId/progression/history` — full history (`progression:read`)

**Events**: `srs.progression.decided` (personal classification).

**OpenAPI tag**: `progression`

### Verification

- Progression decisions evaluate correctly against multiple institutional rule configurations
- Compensation applied correctly within configured credit limits
- Condonement applied at or above the configured threshold
- Locked progression decisions reject mutations with 403
- PRG-006: decision reconstructable under rules in force at the time (bitemporal rule lookup with `asOfDate = academicYearEndDate`)

### Stage 7 Execution Status

**Status**: Implemented — 2026-06-05; focused integration verification pending Docker/Testcontainers access

Implemented:
- `ProgressionService` with progression evaluation, bitemporal decision replacement, current decision read, and decision history
- Rule-driven credit requirement, compensation threshold, compensation credit limit, and condonement threshold lookup using `asOfDate = academicYearEndDate(academicYear)`
- Locked current progression decisions reject re-evaluation outside the later post-ratification correction workflow
- Progression REST routes under `/api/v1/enrolments/:enrolmentId/progression`
- Audit records for progression decision evaluation
- Personal-classification event `srs.progression.decided`
- OpenAPI `progression` tag and URL tagging

Verification passed:
- `pnpm typecheck`
- `pnpm exec eslint apps/api/src/platform/progression/progression-service.ts apps/api/src/routes/progression.ts apps/api/src/app.ts apps/api/test/progression.int.test.ts`
- `pnpm --filter @revelation-srs/api test`

Verification pending:
- `pnpm --filter @revelation-srs/api exec vitest run --config vitest.int.config.ts test/progression.int.test.ts --reporter=verbose`
- `pnpm --filter @revelation-srs/api exec vitest run --config vitest.int.config.ts --reporter=verbose`

The pending integration runs require Docker/Testcontainers access; the escalation request was blocked by the environment usage limit during this implementation pass.

---

## Stage 8 — Classification and Awards (PRG-003, PRG-004, PRG-005)

**Scope**: For students meeting award requirements, a degree classification recommendation is computed and the award is formally recorded on board ratification. A HEAR record is generated for each award.

### Implementation

**Service** `apps/api/src/platform/progression/award-service.ts`:
- `calculateClassification(enrolmentId, tenantId, academicYear)` — applies the configured classification algorithm (rules engine `classification-algorithm` key) to the student's full credit portfolio; returns a recommendation
- `conferAward(enrolmentId, tenantId, examBoardId, classification, actorId)`:
  1. Creates `award` record bitemporally
  2. Sets `hear_generated_at` to now (stub: HEAR generation is a placeholder for Stage 10's full structured HEAR)
  3. If the enrolment is not already `graduated`, calls `EnrolmentService.transitionStatus(enrolmentId, tenantId, 'graduated', now, actorId, {})` to perform the bitemporal status transition through the standard path (preserving the transition ledger, bitemporal close/insert, and person status cascade to `alumnus`)
  4. Publishes `srs.award.conferred`

  Note: step 3 triggers the existing `STUDENT_STATUS_CHANGED` event (with `statusCode: 'graduated'`) via the enrolment service. There is no separate `student.graduated` event — `STUDENT_STATUS_CHANGED` is the canonical graduation signal.

**Routes**:
- `GET /api/v1/enrolments/:enrolmentId/classification` — classification recommendation (`exam-board:read`)
- `POST /api/v1/enrolments/:enrolmentId/award` — confer award (`exam-board:ratify`)
- `GET /api/v1/enrolments/:enrolmentId/award` — read current award (`exam-board:read`)

**Events**: `srs.award.conferred` (personal classification). Enrolment graduation also triggers `srs.student.status-changed` via `EnrolmentService.transitionStatus`.

**OpenAPI tag**: `progression`

### Verification

- Classification recommendations computed correctly against at least two institutional boundary configurations
- Award conferral calls `transitionStatus` (not a direct update); transition ledger row is created; person status advances to `alumnus`
- PRG-005: HEAR timestamp recorded (stub; full generation in Stage 10)
- All events published

---

## Stage 9 — Post-Ratification Governance (GOV-007)

**Scope**: After ratification, the only authorised path to amend locked records is through an explicit appeal or administrative correction case. This stage implements the workflow state machine, the authorised lock override, and the append-only amendment ledger.

### Implementation

**Service** `apps/api/src/platform/governance/correction-service.ts`:
- `openCase(tenantId, input, actorId)` — creates `post_ratification_case` in `submitted` status
- `advanceCaseStatus(caseId, tenantId, newStatus, actorId)` — updates case status bitemporally
- `applyAmendment(caseId, tenantId, entityType, entityId, afterValue, actorId)`:
  1. Fetches the case and validates it is in `upheld` status; throws `ValidationError` (422) if not
  2. Dispatches to the correct table based on `entityType`:
     - `'mark'` → `MarkService.#applyLockedAmendment(markId, tenantId, afterValue)` — an internal method that bypasses the `assertNotLocked` guard, performs the bitemporal close/insert, and re-sets `locked = true` on the new version
     - `'module_result'` → `ModuleResultService.#applyLockedAmendment(...)` — same pattern
     - `'progression_decision'` → `ProgressionService.#applyLockedAmendment(...)` — same pattern
     - Any other `entityType` throws `ValidationError`
  3. Fetches the before-value of the entity (from the closed version) and records a `post_ratification_amendment` row with `before_value`, `after_value`, `entity_type`, `entity_id`, `case_id`, and `actor_id`
  4. Publishes `srs.governance.record-amended-post-ratification`

  The `#applyLockedAmendment` private methods are the only code paths that may write a new version of a locked entity. They are not accessible via any route; all external mutations must pass through `applyAmendment`.

- `listCases(enrolmentId, tenantId)` — current and historical cases

**Routes**:
- `POST /api/v1/enrolments/:enrolmentId/correction-cases` — open case (`exam-board:ratify`)
- `PATCH /api/v1/correction-cases/:caseId/status` — advance status (`exam-board:ratify`)
- `POST /api/v1/correction-cases/:caseId/amendments` — apply amendment (`exam-board:ratify`)
- `GET /api/v1/enrolments/:enrolmentId/correction-cases` — list cases (`exam-board:read`)

**Events**: `srs.governance.record-amended-post-ratification` (personal classification, includes appeal reference).

**OpenAPI tag**: `governance`

### Verification (critical — lock integrity)

- Amendment attempt without an `upheld` case returns 422
- Amendment on a case in `submitted` or `under-review` status is rejected
- Unsupported `entityType` returns 422
- Successfully applied amendment:
  - Records before/after values in amendment ledger
  - The targeted entity's new value is visible via its normal GET endpoint
  - The new version has `locked = true`
  - Subsequent unauthorised mutations (via the normal PATCH route) still return 403
- End-to-end test: mark → ratify → lock verified → open case → uphold → amend → verify new value → verify still locked

---

## Stage 10 — HEAR Generation (PRG-005)

**Scope**: PRG-005 is a Should priority. This stage replaces the Stage 8 HEAR stub with a structured HEAR record that captures all academic achievements, co-curricular activities (from linked records), and award details. It serves as the canonical HEAR data source for integration with EDRMS in Phase 7.

### Implementation

**Service** `apps/api/src/platform/progression/hear-service.ts`:
- `generateHear(enrolmentId, tenantId, actorId)`:
  1. Collects all ratified module results, award, and co-curricular activity stubs
  2. Assembles a structured HEAR JSONB document conforming to the HEAR schema
  3. Updates `award.hear_generated_at`
  4. Stores the document reference (in-DB for Phase 5; EDRMS in Phase 7)
- `getHear(enrolmentId, tenantId)` — returns the HEAR document

**Routes**:
- `POST /api/v1/enrolments/:enrolmentId/hear` — generate HEAR (`exam-board:ratify`)
- `GET /api/v1/enrolments/:enrolmentId/hear` — read HEAR (`student:read:own`, `exam-board:read`)

**OpenAPI tag**: `progression`

### Verification

- HEAR document contains all ratified module results
- HEAR document is only generated for awarded enrolments
- Student can read their own HEAR via `student:read:own`

---

## Stage 11 — Event Consumer Tests and OpenAPI

**Scope**: Event consumer tests for all Phase 5 domain events (using the spy bus pattern from Phase 4). Confirm OpenAPI spec is complete — tags have been added per-stage so this stage is a verification pass, not a tagging exercise.

### Event consumer tests

Create `apps/api/test/events/phase5-event-consumer-tests.int.test.ts` covering all events introduced in Stages 1–9:

| Describe block | Events covered |
|---|---|
| Assessment events | `srs.assessment.mark-received`, `srs.assessment.mark-updated`, `srs.assessment.module-result-calculated`, `srs.assessment.module-result-ratified` |
| Adjustment events | `srs.adjustment.approved`, `srs.adjustment.distributed`, `srs.adjustment.expired` |
| EC and misconduct events | `srs.circumstances.exceptional-circumstances-flagged`, `srs.circumstances.exceptional-circumstances-updated` |
| Exam board events | `srs.governance.exam-board-data-pack-ready`, `srs.governance.exam-board-ratified`, `srs.governance.record-locked` |
| Progression and award events | `srs.progression.decided`, `srs.award.conferred` |
| Post-ratification events | `srs.governance.record-amended-post-ratification` |

Each test verifies: event subject, data classification, payload shape (at minimum: all UUID fields are UUIDs, all required string fields are present).

### OpenAPI

- Confirm `GET /api/v1/openapi.json` renders without schema gaps
- Tags added per-stage: `assessment`, `adjustments`, `circumstances`, `governance`, `progression`

### Verification

All event consumer tests pass. OpenAPI spec covers all Phase 5 resources with correct tags.

---

## Requirements coverage summary

| Requirement | Stage |
|---|---|
| ASS-001 (mark ingestion) | 2 |
| ASS-002 (mark aggregation) | 2b |
| ASS-003 (late penalty) | 2 + 3 |
| ASS-004 (mark audit trail) | 2 |
| ASS-005 (lock enforcement) | 6 |
| ASS-006 (resit marks) | 2 |
| ASS-007 (module result) | 2b |
| ASS-008 (assessment structure) | 1 |
| ASS-009 (integrity context) | 4 |
| ASS-010 (misconduct outcomes) | 4 |
| PRG-001 (progression evaluation) | 7 |
| PRG-002 (compensation/condonement) | 7 |
| PRG-003 (degree classification) | 8 |
| PRG-004 (award recording) | 8 |
| PRG-005 (HEAR) | 10 |
| PRG-006 (bitemporal rules) | 7 |
| GOV-001 (data pack) | 5 |
| GOV-002 (controlled access) | 5 |
| GOV-003 (ratification) | 6 |
| GOV-004 (record lock) | 6 |
| GOV-005 (board member attendance) | 5 |
| GOV-006 (external examiner access) | 5 |
| GOV-007 (post-ratification appeal) | 9 |
| GOV-008 (exam scheduling data) | Stage 11 note: exam entry creation — GOV-008/009 integration delivery deferred to Phase 6 (regulatory) |
| GOV-009 (timetable from EXAMS) | Phase 6 |
| GOV-010 (lock status field) | 6 |
| ADJ-001 to ADJ-006 | 3 |
| EXC-001 to EXC-004 | 4 |

---

## Key implementation decisions

**Record locking is a cross-cutting concern, not a flag.** Every service method that mutates an entity with a `locked` column must call `assertNotLocked(entity)` at the start of the mutation and throw `ForbiddenError` if set. This helper lives in the API's assessment platform layer at `apps/api/src/platform/assessment/lock.ts` (not in the domain package, which is reserved for pure types, event contracts, and RBAC). The helper signature:

```typescript
// apps/api/src/platform/assessment/lock.ts
export function assertNotLocked(entity: { locked: boolean }, entityType: string, id: string): void {
  if (entity.locked) {
    throw new ForbiddenError(`${entityType} '${id}' is locked and cannot be mutated outside the correction workflow`);
  }
}
```

**Bitemporal rule reconstruction (PRG-006).** Progression decisions must be reconstructable under the rules that were in force at the time of the original decision. The rules engine already supports `asOfDate` (included in the cache key, queried against `valid_from`/`valid_to` on the rule row). Progression evaluation must pass `asOfDate = academicYearEndDate(academicYear)`, not `new Date()`, so historical decisions can be audited against the correct rules.

**Data pack payload immutability.** Once generated, a data pack's snapshot payload and candidate profiles must never be mutated. Regeneration creates a new row with an incremented `pack_version`, sets only the previous pack's `superseded_by_id` metadata field to the new pack id, and links all new candidate profiles to the new pack id. The `source_transaction_time` allows exact reconstruction of any historical pack for audit.

**Classification algorithm as configuration.** Phase 5 must ship with at least two fully-tested classification algorithm configurations (e.g. best-of-two-years and final-year-weighted) to satisfy the exit criterion "verified against multiple institutional rule sets". Seed these as named rule fixtures in the test helper under `packages/testing/`.

**External examiner sign-off is a prerequisite for ratification.** `ratifyBoard` enforces this via a service-layer guard (not a database constraint) because the sign-off timestamp can be recorded separately by a different actor close to (but before) ratification.

**HEAR is a Should priority.** Stage 10 produces a structured HEAR document stored in-database. Full EDRMS integration (emitting the document to an external archive) is deferred to Phase 7 (Integration Layer) when outbound file exchange is implemented.

**Graduation via `transitionStatus`.** `conferAward` must never directly update an enrolment row. It must call `EnrolmentService.transitionStatus` to perform the graduation, so the transition ledger, bitemporal close/insert, and person status cascade are all maintained through the standard path.

**EC and adjustment separation.** Exceptional circumstances and reasonable adjustments are governed by separate permissions (`circumstances:write` vs `adjustment:write`) and handled by separate services. No route or service method mixes the two. This enforces EXC-004 at the access-control layer.
