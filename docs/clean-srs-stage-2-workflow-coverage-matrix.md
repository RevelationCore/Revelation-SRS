# Clean SRS Convergence Plan — Stage 2: Workflow Coverage Matrix

Migration: `0013_workflow_coverage_matrix.sql`  
Test file: `apps/api/test/workflow-coverage.int.test.ts`

## Purpose

Stage 2 proves that every process-bearing domain in the platform has a workflow definition seeded at the platform level, with an active version, typed steps, typed decision gateways, assignment rules for all human-task steps, and a controlling feature flag.

Admissions workflows (5 definitions) were seeded in migration 0009. Stage 2 adds 12 more, covering the remaining domains.

---

## Coverage Matrix

| Domain | Workflow Code | Controlling Flag | Flag Default | Human-Task Steps | Decision Gateways |
|---|---|---|---|---|---|
| Enrolment | `enrolment-change-approval` | `enrolment.change-approval.required` | off | registrar-review | G01 approve/reject |
| Module Registration | `module-registration-change` | `module-registration.approval.required` | off | approval-review | G01 approve/reject |
| Assessment | `assessment-mark-review` | `assessment.moderation.workflow.enabled` | off | moderation-review, late-penalty-review, result-review | — |
| Progression | `progression-review` | `progression.board-review.enabled` | off | board-review, outcome-decided | G01 complexity |
| Awards | `award-classification` | `award.discretionary-review.enabled` | off | discretionary-review, award-approved | G01 discretionary |
| Exam Governance | `exam-board-governance` | `exam-board.external-examiner.required` | **on** | data-pack-prepared, external-examiner-review, concerns-resolved, chair-ratification | G01 concerns |
| Corrections | `correction-case` | `correction.panel-review.enabled` | off | eligibility-assessed, evidence-gathered, panel-review, outcome-decided | G01 admissible, G02 panel, G03 upheld |
| Appeals | `appeal-case` | `appeal.panel-hearing.enabled` | off | grounds-assessed, evidence-gathered, panel-hearing, outcome-decided | G01 admissible, G02 hearing, G03 upheld |
| Regulatory | `regulatory-submission-approval` | `regulatory.submission.manual-approval.required` | off | submission-approved | G01 manual-approval, G02 response |
| Finance | `finance-fee-handoff` | `finance.fee-handoff.enabled` | off | payment-confirmed | G01 external-system |
| Identity | `identity-provisioning` | `identity.deduplication.enabled` | off | merge-review | G01 duplicate |
| Communications | `communication-dispatch` | `communications.locale-aware.enabled` | **on** | — (fully automated) | G01 delivery-confirm |

---

## Flag Defaults Rationale

| Flag | Default | Reason |
|---|---|---|
| `exam-board.external-examiner.required` | **on** | UK statutory requirement (QAA Quality Code). External examiner sign-off is non-bypassable by default. |
| `communications.locale-aware.enabled` | **on** | Globalisation foundation (Stage 1) makes locale resolution available; enabling by default ensures Welsh-medium and international communications work immediately. |
| All others | off | Opt-in: existing tenants continue on the legacy path until explicitly enabled per domain. |

---

## Assignment Rules

Every human-task step has a platform-level default assignment rule mapping to the appropriate role. Tenant-level overrides can be added via `POST /api/v1/workflow-assignment-rules` without touching the platform defaults.

| Workflow | Step | Assignee Role |
|---|---|---|
| enrolment-change-approval | registrar-review | registry-administrator |
| module-registration-change | approval-review | registry-administrator |
| assessment-mark-review | moderation-review | module-tutor |
| assessment-mark-review | late-penalty-review | registry-administrator |
| assessment-mark-review | result-review | exam-board-chair |
| progression-review | board-review | exam-board-chair |
| progression-review | outcome-decided | exam-board-chair |
| award-classification | discretionary-review | exam-board-chair |
| award-classification | award-approved | exam-board-chair |
| exam-board-governance | data-pack-prepared | registry-administrator |
| exam-board-governance | external-examiner-review | external-examiner |
| exam-board-governance | concerns-resolved | exam-board-chair |
| exam-board-governance | chair-ratification | exam-board-chair |
| correction-case | eligibility-assessed | registry-administrator |
| correction-case | evidence-gathered | registry-administrator |
| correction-case | panel-review | exam-board-chair |
| correction-case | outcome-decided | registry-administrator |
| appeal-case | grounds-assessed | registry-administrator |
| appeal-case | evidence-gathered | registry-administrator |
| appeal-case | panel-hearing | exam-board-chair |
| appeal-case | outcome-decided | registry-administrator |
| regulatory-submission-approval | submission-approved | regulatory-officer |
| finance-fee-handoff | payment-confirmed | finance-administrator |
| identity-provisioning | merge-review | registry-administrator |
| communication-dispatch | — | (no human-task steps) |

---

## Integration Test Coverage

`apps/api/test/workflow-coverage.int.test.ts` verifies (27 tests):

1. **Definition listing** — all 17 workflow codes (5 admissions + 12 Stage 2) appear in `GET /api/v1/workflow-definitions?statusCode=active`.
2. **Version metadata** — each Stage 2 workflow has an active v1 with `startEvent`, `flagSnapshot`, `serviceInvariants`, and `escalationPolicy` in `definitionJson`.
3. **Step structure** — each Stage 2 workflow has a `start` step, an `end` step, and at least one process step (via DB query on `workflow_step`).
4. **Domain-specific steps** — spot-checks for `external-examiner-review` (exam-board-governance), `moderation-review` / `late-penalty-review` / `result-review` (assessment-mark-review), `grounds-assessed` / `panel-hearing` / `outcome-decided` (appeal-case).
5. **Decision gateways** — `correction-case` and `appeal-case` each have exactly 3 gateways (via DB query on `workflow_decision_gateway`).
6. **Feature flags** — all 12 Stage 2 flags exist, are `active`, and have the correct `defaultVariantKey` (on/off).
7. **Assignment rules** — no human-task step in any Stage 2 workflow lacks an assignment rule (DB aggregate query).
8. **API route coverage** — the `GET /api/v1/workflow-assignment-rules?workflowDefinitionVersionId=<id>` route returns rules for `exam-board-governance` including the `external-examiner-review` step rule.
