# Clean SRS Convergence — Stage 3: Assessment, Grade, and Progression Refactor

## Exit criterion

> Grade and progression calculations are reproducible from rules, workflow decision evidence, and source marks.

## Summary of changes

Stage 3 makes assessment policy (late-penalty, resit-cap) and board governance model (registry-led, school-led, departmental-staged) tenant-configurable via feature flags, and establishes three append-only calculation evidence tables that allow any grade or progression decision to be reproduced offline from the stored rule snapshot, source marks, and workflow decision evidence.

---

## 1. Feature flags introduced

| Flag key | Type | Default | Purpose |
|---|---|---|---|
| `assessment.late-penalty.enabled` | boolean | `on` | When `off`, late penalty calculation is suppressed for all mark ingestion in the tenant. Backward-compatible default preserves existing behaviour. |
| `assessment.resit-cap.enabled` | boolean | `off` | When `on`, marks for attempt ≥ 2 are capped at the `resit-mark-cap` rule value (default 40 per UK HE convention). Must be opted into explicitly. |
| `exam-board.operating-model` | selection | `registry-led` | Selects the workflow definition used for board governance. See Section 3. |

Migration: `0014_stage3_assessment_grade_progression.sql` (Section 1).

---

## 2. Calculation evidence tables

Three append-only tables. No bitemporal columns — each row is a snapshot of what was calculated, when, and with which rule values.

### `mark_calculation_evidence`

Written after every `MarkService.ingestMark()` call.

| Column | Description |
|---|---|
| `mark_id` | FK to the ingested mark |
| `attempt_number` | Attempt number at the time of ingestion |
| `raw_mark` | Raw mark as submitted |
| `late_penalty_enabled` | Value of `assessment.late-penalty.enabled` flag at calculation time |
| `late_penalty_percent` | Penalty applied (null if no penalty) |
| `late_penalty_cap_applied` | Whether the late-penalty-cap rule capped the deduction |
| `late_penalty_cap_percent` | Cap value if applied |
| `resit_cap_applied` | Whether `assessment.resit-cap.enabled` triggered a cap |
| `resit_cap_mark` | Cap value if applied (null otherwise) |
| `adjusted_mark` | Final mark stored on the mark record |
| `rule_snapshot` | JSONB snapshot of rule values at calculation time |
| `calculated_at` | Timestamp |

### `progression_calculation_evidence`

Written after every `ProgressionService.evaluateProgression()` call.

| Column | Description |
|---|---|
| `progression_decision_id` | FK to the progression decision |
| `academic_year` | Academic year the decision covers |
| `required_credits` | Credits required to progress (from rules engine) |
| `compensation_threshold` | Mark below which compensation applies (null if not configured) |
| `compensation_credit_limit` | Maximum credits that may be compensated |
| `condonement_threshold` | Mark below which condonement applies (null if not configured) |
| `earned_credits` | Credits fully passed |
| `compensation_credits` | Credits compensated |
| `unresolved_credits` | Credits neither passed nor resolved |
| `decision_code` | `progress`, `resit`, or `repeat-year` |
| `rule_snapshot` | JSONB snapshot |
| `calculated_at` | Timestamp |

### `award_calculation_evidence`

Written after every `AwardService.conferAward()` call.

| Column | Description |
|---|---|
| `award_id` | FK to the conferred award |
| `algorithm` | Classification algorithm used (`weighted-average`, `best-of-two-years`, etc.) |
| `aggregate_mark` | Computed aggregate before classification boundary mapping |
| `classification_code` | Resulting classification |
| `boundaries_applied` | JSONB array of `{ code, minimumMark }` used for boundary lookup |
| `outcome_count` | Number of module results included in the aggregate |
| `total_credit_value` | Total credit weight of included results |
| `rule_snapshot` | JSONB snapshot |
| `calculated_at` | Timestamp |

Evidence write failures are silenced (empty `catch`) — a failure to write evidence must never block the domain operation.

---

## 3. Board operating-model workflow definitions

Two new system-seeded workflow definitions for large-institution board governance, selectable via the `exam-board.operating-model` flag.

### `exam-board-school-led`

School-initiated model. Department chair owns the data pack; school director provides approval before registry finalises.

| Step key | Type | Owner role |
|---|---|---|
| `board-constituted` | start | — |
| `data-pack-prepared` | human-task | `department-chair` |
| `school-director-review` | human-task | `school-director` |
| `external-examiner-review` | human-task | `external-examiner` |
| `gateway-concerns` | decision | — |
| `concerns-resolved` | human-task | `school-director` |
| `registry-finalisation` | human-task | `registry-administrator` |
| `record-locked` | integration | — |
| `end` | end | — |

Assignment rules: 5 rules (one per human-task step, defaulting to the step's owner role).

### `exam-board-departmental-staged`

Three-stage model: departmental committee → school executive → external examiner → central registry. For large multi-faculty institutions where both departmental and school levels must sign off before registry finalises.

| Step key | Type | Owner role |
|---|---|---|
| `board-constituted` | start | — |
| `departmental-committee-review` | human-task | `department-chair` |
| `school-executive-approval` | human-task | `school-director` |
| `external-examiner-review` | human-task | `external-examiner` |
| `gateway-concerns` | decision | — |
| `concerns-resolved` | human-task | `exam-board-chair` |
| `central-registry-lock` | human-task | `registry-administrator` |
| `record-locked` | integration | — |
| `end` | end | — |

Assignment rules: 5 rules.

---

## 4. MarkService changes

`MarkService.#applyLatePenalty()` now:

1. Evaluates `assessment.late-penalty.enabled` → skips all penalty logic if `false`
2. Applies late-penalty-rate rule (per-day percentage deduction)
3. Applies late-penalty-cap rule (caps total deduction)
4. Calls `#applyResitCap()` for attempt ≥ 2 when `assessment.resit-cap.enabled` is `true`
5. Writes to `mark_calculation_evidence` (failure silenced)

`MarkService` constructor now accepts an optional fifth parameter `FeatureFlagService`.

---

## 5. Service guard invariants (unchanged)

The following hard guards remain enforced in code and are not affected by Stage 3 flags:

- Locked records (marks, module results, progression decisions) cannot be modified
- Mark range: 0–100
- Ratification authority: only `exam-board-chair` may ratify a board
- Award conferral: classification must match the calculated recommendation; board must be ratified; enrolment must not already have an award

---

## 6. Integration tests

File: `apps/api/test/stage3-assessment-grade-progression.int.test.ts`

13 tests across 7 describe blocks:

| Describe block | Test | Assertion |
|---|---|---|
| Stage 3 feature flags | `assessment.late-penalty.enabled` exists, status active, default on | `GET /api/v1/feature-flags` |
| Stage 3 feature flags | `assessment.resit-cap.enabled` exists, default off | `GET /api/v1/feature-flags` |
| Stage 3 feature flags | `exam-board.operating-model` exists with 3 variants | `GET /api/v1/feature-flags/:id` |
| Board operating model definitions | `exam-board-school-led` active with 4 key steps | DB query on `workflow_step` |
| Board operating model definitions | `exam-board-departmental-staged` active with 3 key steps | DB query on `workflow_step` |
| Late-penalty flag | Flag off → no penalty on 9-day-late submission | `GET /marks` response: `penaltyApplied=false`, `adjustedMark=60` |
| Late-penalty flag | Flag on (default) → 5%/day penalty applied | `GET /marks` response: `penaltyApplied=true`, `adjustedMark=50` |
| Resit mark cap | Flag on → attempt-2 mark of 75 capped at 40 | `GET /marks` response: `adjustedMark=40` |
| Resit mark cap | Flag off (default) → attempt-2 mark of 75 uncapped | `GET /marks` response: `adjustedMark=75` |
| mark_calculation_evidence | Row written after mark ingestion with correct fields | SQL query on `mark_calculation_evidence` |
| mark_calculation_evidence | Penalty details recorded when penalty applied | SQL query on `mark_calculation_evidence` |
| progression_calculation_evidence | Row written after progression decision | SQL query on `progression_calculation_evidence` |
| award_calculation_evidence | Row written after award conferral | SQL query on `award_calculation_evidence` |

All 252 integration tests pass.
