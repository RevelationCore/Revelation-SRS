# ADR-033: Authority for Recording a Core Reasonable Adjustment

**Status**: Accepted. The defaults below fail closed, so engineering can proceed. The policy confirmations were decided by the AI SME delegate on 2026-11-23, under the product owner's delegation ([SME delegate decisions, 2026-11-23](sme-delegate-decisions-2026-11-23.md)): who may hold `adjustment-approver`, with `adjustment:propose` moved from `wellbeing-advisor` to a new `adjustment-proposer` role (SME-6); the manual path off by default, the four reason codes, and a go-live check that some route exists (SME-7); the migration release reconciliation (SME-8). Ratifiable by the head of disability services and the academic registrar (SME-6, SME-7) and the data migration lead (SME-8). Which people hold the roles, and the migration figures, are the institution's to supply ([adoption checklist](../product/institution-adoption-checklist.md)). Items 6 and 8 amended by [ADR-034](ADR-034-authority-for-withdrawing-a-core-adjustment.md) (2026-11-23): `adjustment:write` no longer covers expiry, which is retired, and `adjustment-approver` also decides withdrawals.
**Date**: 2026-11-22
**Amends**: [ADR-029](ADR-029-tenant-bound-service-identity-for-wellbeing-hand-offs.md) item 3 (`POST /students/:personId/adjustments` no longer accepts `adjustment:write`)
**Follows**: [ADR-017](ADR-017-minimum-necessary-outcomes-and-restricted-evidence.md) (minimum-necessary outcomes with a source decision reference); [ADR-019](ADR-019-per-target-exchange-ledger-and-reconciliation.md) (per-target distribution); [ADR-024](ADR-024-live-temporal-execution.md) (`GovernedReview`); [ADR-028](ADR-028-exceptional-circumstances-decision-authority.md) (separate decide permission, separation of duties in the service)
**Backlog**: BL-238; pre-review [D-44 adjustments](../business-processes/pre-reviews/pre-review-adjustments-d-44.md) F5
**Patterns**: P-22 (separation of duties in the service), P-23 (acting user from the token), P-03 (deny by default), P-16 (coded values from value sets), P-10 (transactional outbox), P-15 (migration discipline), P-07 (contract on every route), P-08 (one error format), P-12 (paginate every list)

## Context

What the code shows:

- **Staff can create a distributed adjustment alone, with no case.** `POST /api/v1/students/:personId/adjustments` (`apps/api/src/routes/adjustments.ts`) has the preHandler `requireAnyPermission('adjustment:write', 'adjustment:record-approved')`. `sourceCaseId` is required only when the caller lacks `adjustment:write`. `adjustment:write` is held by `registry-administrator` and `wellbeing-advisor` (`packages/domain/src/permissions.ts:67`).
- **Every recorded adjustment is treated as approved.** `AdjustmentService.recordAdjustment` (`apps/api/src/platform/adjustments/adjustment-service.ts:154`) in one transaction:
  - writes the `reasonable_adjustment` version;
  - writes one `adjustment_distribution` per target (`pending`, issued at once for manual and file targets).

  It then publishes `srs.adjustment.approved` and dispatches. The route refreshes exam entries (`applyExamAdditions`).
- **Other services read `reasonable_adjustment` directly, with no status filter:**
  - `MarkService.#hasActiveDeadlineExtension` (`apps/api/src/platform/assessment/mark-service.ts:663`) waives late penalties;
  - `BoardService.#getAdjustmentIndicators` (`apps/api/src/platform/governance/board-service.ts:919`) shows board indicators;
  - the portal and the admin student record list them.

  An "unapproved" row in that table would leak into all of them unless every reader learned a new filter.
- **No screen creates a core adjustment.** `apps/admin/src` calls only `GET /students/:personId/adjustments`, the outcome-document routes and the task-queue replies (`apps/admin/src/api/students.ts`, `adjustmentTasks.ts`). `adjustment:write` in the admin app gates only the outcome-document upload (`StudentDetailPage.tsx:131`).
- **Tests use the staff path.** About 20 `POST .../adjustments` call sites in 12 files under `apps/api/test` use a staff token. Examples: `adjustments.int.test.ts`, `adjustment-distribution-instructions.int.test.ts`, `exam-entry-adjustments.int.test.ts`, `document-scanning.int.test.ts`, `vle-connector-service.int.test.ts`, `marks.int.test.ts`. The helper `ctx.makeJwt` already accepts `azp` (`apps/api/test/helpers/test-app.ts:126`), so a test can mint a `wellbeing-service` token.
- **Demo data bypasses the route.** `packages/demo-data/src/scenarios/{assessment-marks,institution-year,exam-board}.ts` insert `reasonable_adjustment` rows directly, each with a `sourceCaseId` from a demo wellbeing case.
- **Legacy migration bypasses the route.** `importAdjustments` (`packages/migration-tools/src/importer/phases.ts:400`) inserts rows directly:
  - the actor is `migration-import` and `sourceCaseId` is null;
  - it creates no distributions, so a migrated adjustment never reaches the VLE or exam entries;
  - it drops the import contract's `externalId` (`contracts/adjustment.ts`).
- **The governed-review machinery exists.** `EcDeterminationService` (`apps/api/src/platform/circumstances/ec-determination-service.ts`) is a model to copy:
  - a proposal table (`ec_determination`), a `GovernedReview` decision and an idempotent effect;
  - a workflow definition seeded by migration;
  - a separation check.

  Tenant booleans use `feature_flag` (pattern in `MarkService.#evaluateBooleanFlag`).
- **Legitimate cases with no wellbeing case exist:**
  - migration of current adjustments from a previous SRS at cut-over;
  - institutions whose disability service keeps its cases elsewhere (its own system, or a signed paper support plan) and does not run the wellbeing module.
- **Stage.** Alpha and pre-production, so breaking the route and the table is acceptable now.

## Decision

1. **The existing route becomes service-only.**
   - `POST /api/v1/students/:personId/adjustments` changes its preHandler to `requirePermission('adjustment:record-approved')`, held only by `wellbeing-service` (ADR-029).
   - A staff token gets 403 (`https://srs.example.com/errors/forbidden`).
   - `sourceCaseId` stays required, with the existing 422 (`https://srs.example.com/errors/unprocessable`, title "Source case required"), so ADR-029's guard still holds.
   - The OpenAPI operation stays classified `integration` (`stage6-contract-tests.int.test.ts`).

2. **A manual adjustment is a proposal until a second person approves it.** It is stored apart from `reasonable_adjustment` and is never distributed before approval.
   - **New table `adjustment_proposal`.** It is not bitemporal: a governed decision record, like `ec_determination`. It has RLS `tenant_isolation`, `FORCE ROW LEVEL SECURITY` and the app-role grants. Columns:

     | Column | Type | Notes |
     |---|---|---|
     | `id` | uuid PK | |
     | `tenant_id` | uuid not null | |
     | `person_id`, `enrolment_id` | uuid not null | The enrolment must belong to the person, checked as in `recordAdjustment` |
     | `adjustment_type_code`, `scope_code` | text not null | Existing value sets `adjustment-type-code`, `adjustment-scope-code` |
     | `amount_value` numeric(8,2), `amount_unit_code` text | nullable | Both or neither (CHECK), as on `reasonable_adjustment` |
     | `valid_from` timestamptz not null, `valid_to` timestamptz | | `valid_to` > `valid_from` |
     | `manual_reason_code` | text not null | Value set `adjustment-manual-reason-code` (item 4) |
     | `external_reference` | text not null, 1–100 chars | Where the decision is held, for example the disability service's case number or paper file reference. It satisfies ADR-017's "source decision reference". It is an identifier, never narrative |
     | `status_code` | text not null default `proposed` | Value set `adjustment-proposal-status-code`: `proposed`, `approved`, `rejected` |
     | `proposed_by` text not null, `proposed_by_person_id` uuid | | From the token (`sub`, `srsPersonId`), never the body (P-23) |
     | `proposed_at` | timestamptz not null default now() | |
     | `workflow_instance_id` | uuid | |
     | `decided_by`, `decided_by_person_id`, `decided_at`, `decision_reason` | nullable | `decision_reason` is required for `rejected`, max 500 |
     | `adjustment_id` | uuid | Set when approved |

   - **There is no `notes` field.** Free text must not travel to targets (pre-review F10, BL-243). Equipment or room detail goes in the outcome document after approval.
   - **Until approval there is nothing to distribute.** A `proposed` or `rejected` proposal has:
     - no `reasonable_adjustment` row and no `adjustment_distribution`;
     - no `srs.adjustment.approved` event and no exam-entry refresh;
     - no portal visibility, and no effect on late penalties or board indicators.

     Readers need no new filter, because the unapproved record is in a table they never read.
   - **Approval runs through `GovernedReview`.** A new workflow definition `adjustment-manual-approval` is seeded by migration, copying `ec-determination`:

     | Step key | Type | Owner role |
     |---|---|---|
     | `manual-adjustment-proposed` | start | |
     | `decide-manual-adjustment` | human-task | `adjustment-approver` |
     | `decision-gateway` (gateway `G01`, "Approve the manual adjustment?") | decision | `adjustment-approver` |
     | `manual-adjustment-closed` | end | |

     The `GovernedReview` spec is: `subjectEntityType: 'adjustment_proposal'`, `assigneeRoleCode: 'adjustment-approver'` and `effectDecisionCodes: ['approved', 'rejected']`. As built (BL-378), a rejection is an effect too: it changes the proposal, and on Temporal only effect decisions reach the service. Decision codes are `approved` and `rejected`.
   - **The approval effect** is a new `AdjustmentProposalService` (`apps/api/src/platform/adjustments/adjustment-proposal-service.ts`). It calls the shared recording path with `authority: { kind: 'manual-proposal', proposalId }` and idempotency key `adjustment-proposal:<proposalId>`, so a retried activity finds the same adjustment. In the same transaction it sets `status_code = 'approved'`, `adjustment_id`, `decided_by` and `decided_at`. It then:
     - creates the distributions;
     - publishes `srs.adjustment.approved`;
     - refreshes exam entries.

     The `actor_id` on the new `reasonable_adjustment` version is the approver.
   - **The effect re-validates** the value-set codes, the enrolment and `valid_to` not in the past. On failure it returns 422 and the proposal stays `proposed`.

3. **Separation of duties, enforced in the service (P-22).** The decision returns 403 `https://srs.example.com/errors/separation-of-duties` when the acting user is either of these:
   - the proposer, compared by `sub`, and also by `srsPersonId` when both carry it;
   - the subject student (`srsPersonId === person_id`).

   A proposal about the proposer's own record is refused the same way. The deciding user comes from the token.

4. **Why there is no case: a value set, and the path is off by default.**
   - **Value set `adjustment-manual-reason-code`** (`srs-internal`, extensible, bound to `adjustment_proposal.manual_reason_code`). Its seed values:

     | Code | Meaning |
     |---|---|
     | `external-case-system` | The disability service decided it in its own case system, not the wellbeing module |
     | `paper-record` | The decision is a signed paper support plan |
     | `prior-provider-plan` | A plan from a previous or partner provider, adopted by the disability service |
     | `migration-correction` | Re-entering a legacy adjustment that failed or was wrong in the migration import |

     Codes have NULL `activeFrom`/`activeTo` (open bitemporal ends).
   - **Feature flag `adjustments.manual-proposals.enabled`** (boolean, default `false`, owner module `adjustments`). Evaluation falls back to `false` on error.
     - When it is off, `POST .../adjustment-proposals` and an `approved` decision return 403 `https://srs.example.com/errors/manual-adjustments-disabled`.
     - A `rejected` decision is still allowed, so a backlog can be cleared after the flag is turned off.
     - A tenant running the wellbeing module leaves it off: every adjustment then has a case. A tenant whose disability service works elsewhere turns it on.

5. **Routes.**

   | Method and path | Permission | Responses |
   |---|---|---|
   | `POST /api/v1/students/:personId/adjustments` | `adjustment:record-approved` | 201, 200 (replay), 403, 404, 409, 422 (as today) |
   | `POST /api/v1/students/:personId/adjustment-proposals` | `adjustment:propose` | 201 `{ proposalId, statusCode }`; 400 for unknown fields (`notes` and `sourceCaseId` included, `additionalProperties: false`); 403 `manual-adjustments-disabled` or `separation-of-duties`; 404; 422 for an unknown code |
   | `GET /api/v1/adjustment-proposals?statusCode=&personId=` | `adjustment:propose` or `adjustment:approve-manual` | 200, paginated with the project's list convention (P-12) |
   | `GET /api/v1/adjustment-proposals/:proposalId` | as above | 200, 404 |
   | `POST /api/v1/adjustment-proposals/:proposalId/decision`, body `{ decisionCode: 'approved' \| 'rejected', reason?: string }` | `adjustment:approve-manual` | 200 `{ proposalId, statusCode, adjustmentId, decisionStatus }`; 403 `separation-of-duties` or `manual-adjustments-disabled`; 404; 409 `https://srs.example.com/errors/conflict` when already decided; 422 when `reason` is missing for `rejected`, or the effect's validation fails |
   | `GET /api/v1/adjustment-migration-batches/:batchId` | `adjustment:release-migrated` | 200 `{ batchId, total, current, released, unreleased }`; 404 |
   | `POST /api/v1/adjustment-migration-batches/:batchId/release`, body `{ expectedCount: integer }` | `adjustment:release-migrated` | 200 `{ released, alreadyReleased, ended }`; 404; 409 `https://srs.example.com/errors/migration-count-mismatch` |

   - **Audit rows** (actor from the token):
     - `adjustment_proposal` create;
     - `adjustment_proposal` update on decision, with `reasonText` set to the decision code;
     - `reasonable_adjustment` create, with `reasonText` "Manual adjustment approved (proposal <id>)";
     - `adjustment_migration_batch` update on release, with the counts.

6. **Provenance is recorded on every core adjustment, and the database enforces it.**
   - **New columns on `reasonable_adjustment`:**
     - `provenance_code text not null`, with no default, so every writer must choose one;
     - `manual_proposal_id uuid`, a foreign key to `adjustment_proposal(id)`;
     - `migration_batch_id uuid`;
     - `migration_source_reference text`.
   - **Value set `adjustment-provenance-code`** (not extensible): `wellbeing-case`, `manual-approved`, `migrated`, `legacy-direct`. The last has `activeTo` set to the migration date, so no new write validates it.
   - **CHECK `reasonable_adjustment_provenance_ck`:**
     - `provenance_code` is in those four;
     - `wellbeing-case` requires `source_case_id`;
     - `manual-approved` requires `manual_proposal_id`;
     - `migrated` requires `migration_batch_id` and `migration_source_reference`.
   - **Backfill in the same migration** (Alpha; only development and demo databases hold rows):
     - rows with `source_case_id` become `wellbeing-case`;
     - rows with `actor_id = 'migration-import'` become `migrated`, with `migration_batch_id` set to a single deterministic UUID and `migration_source_reference = 'unknown'`;
     - any other row becomes `legacy-direct`.

     Update `_journal.json` (`when` after every earlier entry).
   - **New versions copy the provenance columns.** `expireAdjustment` and `attachOutcomeDocument` write new versions, and must carry all four columns forward.
   - **The API wire shape gains `provenanceCode` and `manualProposalId`.**
   - **The recording path takes a typed authority.** Rename the internal method to `recordAuthorisedAdjustment(tenantId, personId, input, authority, actorId, idempotencyKey?)`, where `authority` is `{ kind: 'wellbeing-case'; sourceCaseId: string } | { kind: 'manual-proposal'; proposalId: string }`. There is no overload without an authority.

7. **Legacy migration: imported as decided, distributed only after a separate release.**
   - **The legacy SRS was the authority for its adjustments,** so they are not re-decided one by one.
   - **The importer:**
     - takes `--batch-id <uuid>`, or generates one and prints it;
     - writes `provenance_code = 'migrated'`, `migration_batch_id`, and `migration_source_reference = '<source>:<externalId>'` (for example `sits:ADJ-00123`);
     - still writes no distributions.

     The rows are live for late penalties and board indicators at once, which is correct for decisions already in force.
   - **Release.** An `adjustment-approver`, who is not the operator who ran the import (the import has no person identity), reconciles the batch against the legacy system's report. They then call `release` with `expectedCount` equal to the number of current rows in the batch. If the counts differ, the response is 409 `migration-count-mismatch`. The release:
     - creates distributions, through the same per-target logic as `recordAuthorisedAdjustment`, for each current row whose `valid_to` is null or in the future and which has none;
     - publishes `srs.adjustment.approved` for each one;
     - dispatches and refreshes exam entries;
     - skips ended rows (counted as `ended`);
     - is idempotent: a repeat returns `released: 0`.
   - **Legacy adjustments the import cannot express** are re-entered through item 2 with reason `migration-correction`.

8. **Roles and permissions** (`packages/domain/src/permissions.ts`):

   | Permission | Roles | Change |
   |---|---|---|
   | `adjustment:record-approved` | `wellbeing-service` | unchanged; now the only way into `POST .../adjustments` |
   | `adjustment:propose` | `registry-administrator`, `adjustment-proposer` | new. Amended by SME-6 (2026-11-23): not `wellbeing-advisor`, who has the governed case; a new `adjustment-proposer` role holds it and nothing else |
   | `adjustment:approve-manual` | `adjustment-approver` | new |
   | `adjustment:release-migrated` | `adjustment-approver` | new |
   | `adjustment:read:all` | adds `adjustment-approver` | changed |
   | `adjustment:write` | `registry-administrator`, `wellbeing-advisor` | unchanged; now covers only `POST /adjustments/:id/expire` and the outcome-document upload |

   - **New realm role `adjustment-approver`**, named for BP-04-004's approval under delegated authority. It holds the three permissions above and nothing else.
   - **New realm role `adjustment-proposer`** (SME-6), for disability-service administrators in a tenant that does not run the wellbeing module. It holds `adjustment:propose` only.
   - **No role holds both `adjustment:propose` and `adjustment:approve-manual`.** The permissions test asserts it. This is separation at the role level as well as in the service, because the proposer here is usually registry, who is not the decision authority.

## Rationale

- **The unapproved record cannot leak, because readers never see it.** Holding proposals in their own table, rather than adding a status to `reasonable_adjustment`, means:
  - the mark service, board pack, exam entries, dispatcher and portal stay correct without change;
  - a future reader cannot forget a filter.

  This fails closed by construction (core principle 6; P-03). It follows BP-04-004: "No unapproved outcome is represented as final".
- **One write path per authority.** The decided record is written only by:
  - the authenticated hand-off of a decision taken in the case service (ADR-029);
  - the effect of a decision recorded here;
  - a migration of decisions already in force, distributed only after a second person releases it.

  The same lesson drove ADR-028 (a status route that could set `upheld`) and ADR-031 (a links route that could merge without a decision).
- **Proportionate.** It reuses `GovernedReview`, the workflow-definition seeding, `feature_flag`, value sets and the existing distribution logic. It adds one table, four columns and three permissions, and no infrastructure. A tenant running the wellbeing module gets the strictest setting by default.
- **Institutions without the wellbeing module still have a lawful, auditable path.** Every manual adjustment names where its decision is held (ADR-017) and why there is no case, and was seen by two people.

## Options considered

| Option | Verdict |
|---|---|
| Do nothing | Rejected. One registry administrator or adviser can grant extra time in the VLE and exams with no decision behind it (F5, Major) |
| (a) Service-only, with no manual path | Rejected as the whole answer. It leaves institutions whose disability service works outside the wellbeing module with no way to record adjustments, and gives migration corrections no route. It is kept as the default: the flag is off |
| Add `status_code = 'pending'` to `reasonable_adjustment`, approved in place | Rejected. Every reader (mark service, board pack, exam entries, dispatcher, portal, and future ones) would need a filter. One missed filter waives late penalties or shows board indicators for an unapproved adjustment |
| Create the distributions on proposal, but hold them unpublished | Rejected. Manual and file targets are issued on insert (`requestPublishedAt = now`), so tasks would reach the queue before approval. It also needs the same reader filters |
| (b) Two-person manual path: a separate proposal, `GovernedReview` approval, reason code and external reference; behind a flag, off by default | **Chosen**, together with (a) for the existing route |
| Each external case system integrates as a service client, as wellbeing does | Deferred. It is right for a system that can call an API, and ADR-029's client model allows it. It does not cover paper records or a first release |
| Migrated adjustments re-decided one by one through proposals | Rejected. They are decisions already in force. Thousands of proposals would invite rubber-stamping; batch reconciliation and release by a second person is the real control |

## Consequences

- **Breaking changes, acceptable at Alpha:**
  - staff tokens lose the create route;
  - `reasonable_adjustment` gains a NOT NULL column, so each direct writer fails to compile until it sets `provenance_code`. The writers are the three demo scenarios and the importer;
  - the internal `recordAdjustment` signature changes.
- **Tests.** A new helper, `recordApprovedAdjustment(ctx, personId, body, opts?)` in `apps/api/test/helpers/adjustments.ts`:
  - mints a `wellbeing-service` token with `azp = wellbeingServiceClientId(tenantId)`;
  - supplies a random `sourceCaseId` unless one is given;
  - returns `{ adjustmentId }`.

  The roughly 20 staff-token call sites in 12 files move to it. Tests that rely on outcome-document upload or expiry keep their staff token (`adjustment:write`).
- **Demo data** sets `provenanceCode: 'wellbeing-case'` in its three scenarios. Demo personas need an `adjustment-approver`, distinct from the registry persona.
- **Until IAM assigns `adjustment-approver`, no manual adjustment can be approved and no migration batch can be released.** This fails closed.
- **Small institutions need two people.** One where a single officer would enter and approve must involve a second person. This is deliberate, as in ADR-028.
- **ADR-029's status line** notes "item 3 amended by ADR-033".
- **To confirm, without blocking:**
  - **who holds `adjustment-approver`** (expected: the head of the disability service or a delegated disability adviser), and whether `wellbeing-advisor` should keep `adjustment:propose`. The disability service lead and the academic registrar confirm, through the BP-04-004 review;
  - **whether the tenant enables `adjustments.manual-proposals.enabled`,** and its reason-code list. The same people confirm;
  - **the migration release reconciliation** (counts against the legacy report). The data migration lead confirms, in the cut-over plan.

## Guard

- **`apps/api/test/adjustment-authority.int.test.ts`, a route matrix.** Expected responses:

  | Caller and request | Response |
  |---|---|
  | `registry-administrator` or `wellbeing-advisor` on `POST .../adjustments` | 403 |
  | `wellbeing-service` with a matching `azp` and a `sourceCaseId` | 201, `provenanceCode: 'wellbeing-case'` |
  | propose with the flag off | 403 `manual-adjustments-disabled` |
  | propose with `notes` or `sourceCaseId` in the body | 400 |
  | propose with an unknown `manualReasonCode` | 422 |
  | after a proposal: adjustments list, distributions, task queue, exam entries | none for that student |
  | the proposer decides | 403 `separation-of-duties` |
  | an `adjustment-approver` who is the subject student decides | 403 `separation-of-duties` |
  | `registry-administrator` decides | 403 |
  | a second person approves | 200; one adjustment with `provenanceCode: 'manual-approved'`, distributions created, one `srs.adjustment.approved` |
  | the approval effect is repeated | the same `adjustmentId` |
  | a second decision | 409 |
  | rejection without a reason | 422 |
  | rejection | no adjustment |
  | migration release with the wrong `expectedCount` | 409 `migration-count-mismatch` |
  | migration release, then repeated | distributions for current rows only, none for ended rows; the repeat releases 0 |
- **`packages/domain` permissions test:**
  - `adjustment:record-approved` is held only by `wellbeing-service`;
  - `adjustment:approve-manual` and `adjustment:release-migrated` are held only by `adjustment-approver`;
  - no role holds both `adjustment:propose` and `adjustment:approve-manual`.
- **Database test** (`packages/db` int test). The CHECK rejects:
  - `wellbeing-case` without `source_case_id`;
  - `manual-approved` without `manual_proposal_id`;
  - `migrated` without a batch.
- **Writer allow-list test (`apps/api/test/architecture/adjustment-writers.test.ts`).** It scans the source trees for inserts into `reasonableAdjustments` or `adjustmentDistributions`. It fails if any file other than these does so:
  - `adjustment-service.ts`;
  - `adjustment-proposal-service.ts`;
  - `packages/migration-tools/src/importer/phases.ts`;
  - `packages/demo-data/src/scenarios/*`.
- **The TypeScript compiler.** `provenance_code` is NOT NULL with no default, and `authority` is a required discriminated union, so a new writer that names no authority does not compile.
- **The P-22 governed-steps table** gains `adjustment-proposal / decide / differs from proposer and subject student` and `adjustment-migration-batch / release / a person, not the import`, each pointing at the matrix test.
- **The ADR-029 matrix stays green:** the service caller without `sourceCaseId` still gets 422.

## Follow-up work

| ID | Title | Type | Area | Priority | Size |
|---|---|---|---|---|---|
| BL-376 | `POST /students/:personId/adjustments` accepts only `adjustment:record-approved`; test helper `recordApprovedAdjustment`; move the existing call sites | Defect | Adjustments & EC | P1 | S |
| BL-377 | `reasonable_adjustment` provenance columns, value set `adjustment-provenance-code`, CHECK, backfill; typed `authority` in the recording path; new versions copy provenance; demo data sets provenance | Defect | Adjustments & EC | P1 | S |
| BL-378 | Manual adjustment proposals: `adjustment_proposal` table, `adjustment-manual-approval` workflow, `AdjustmentProposalService`, routes, `adjustment-approver` role, value sets `adjustment-manual-reason-code` and `adjustment-proposal-status-code`, flag `adjustments.manual-proposals.enabled` | Feature | Adjustments & EC | P1 | M |
| BL-379 | Migration importer writes `migrated` provenance and batch; migration batch summary and release routes with count reconciliation | Feature | Data migration | P1 | S |
| BL-380 | Admin screens: propose a manual adjustment, an approver worklist and decision, and migration batch release | Feature | Adjustments & EC | P2 | M |
| BL-381 | Guards: authority route matrix, permissions assertions, CHECK test, writer allow-list test, P-22 governed-steps rows | Test | Adjustments & EC | P1 | S |
| BL-382 | Demo personas and seed: an `adjustment-approver` distinct from the registry persona | Test | Demo data | P2 | S |
| BL-383 | Note "item 3 amended by ADR-033" on ADR-029 (done with this ADR) | Docs | Documentation | P3 | S |
