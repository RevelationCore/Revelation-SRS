# ADR-034: Authority for Withdrawing a Core Reasonable Adjustment

**Status**: Accepted. The defaults below fail towards the student keeping the entitlement, so engineering can proceed. The policy confirmations under "To confirm" were decided by the AI SME delegate on 2026-11-23, under the product owner's delegation ([SME delegate decisions, 2026-11-23](sme-delegate-decisions-2026-11-23.md#second-batch-withdrawing-a-core-adjustment-adr-034), BL-414): `adjustment-approver` decides withdrawals as well as grants (SME-11); `wellbeing-advisor` may propose withdrawals of case-less adjustments, unlike grants (SME-12); a student's own request needs a second person, who checks the request is the student's (SME-13); adjustments end automatically on withdrawal and graduation only, with prompts to re-record and review (SME-14); the student is told of every early withdrawal, with a plain reason, no clinical detail and a review route (SME-15, BL-412). Ratifiable by the head of disability services and the academic registrar.
**Date**: 2026-11-23
**Amends**: [ADR-033](ADR-033-authority-for-recording-a-core-adjustment.md) item 8 (`adjustment:write` no longer covers expiry; `adjustment-approver` gains `adjustment:approve-withdrawal`) and item 6 (new versions also carry the withdrawal columns); [ADR-029](ADR-029-tenant-bound-service-identity-for-wellbeing-hand-offs.md) item 3 (`wellbeing-service` gains a third permission, `adjustment:withdraw-approved`)
**Follows**: [ADR-033](ADR-033-authority-for-recording-a-core-adjustment.md) (one write path per authority, proposal table, provenance CHECK); [ADR-029](ADR-029-tenant-bound-service-identity-for-wellbeing-hand-offs.md) (tenant-bound wellbeing hand-offs); [ADR-028](ADR-028-exceptional-circumstances-decision-authority.md) (separate decide permission); [ADR-024](ADR-024-live-temporal-execution.md) (`GovernedReview`); [ADR-017](ADR-017-minimum-necessary-outcomes-and-restricted-evidence.md) (minimum-necessary outcomes); [ADR-019](ADR-019-per-target-exchange-ledger-and-reconciliation.md) (per-target distribution and withdrawal)
**Backlog**: BL-384; related BL-240 (withdrawal driven by a case review, the wellbeing side)
**Patterns**: P-22 (separation of duties in the service), P-23 (acting user from the token), P-03 (deny by default), P-16 (coded values from value sets), P-24 (tenant-bound service identity), P-10 (transactional outbox), P-15 (migration discipline), P-07 (contract on every route), P-08 (one error format), P-12 (paginate every list)

## Context

What the code shows (read 2026-11-23):

- **One person can withdraw an adjustment from every target.** `POST /api/v1/adjustments/:adjustmentId/expire` (`apps/api/src/routes/adjustments.ts:477`) has the preHandler `requirePermission('adjustment:write')`, no body, and returns 204. `adjustment:write` is held by `registry-administrator` and `wellbeing-advisor` (`packages/domain/src/permissions.ts:72`).
- **What expiry does.** `AdjustmentService.expireAdjustment` (`apps/api/src/platform/adjustments/adjustment-service.ts:703`), in one transaction:
  - closes the current bitemporal version and writes a successor with `valid_to = now` (or `valid_from + 1 ms` if it has not started), carrying the provenance columns forward;
  - moves each distribution whose instruction was published to `withdrawal-requested`, with a withdrawal instruction, and each unpublished one to `superseded`.

  It then publishes `srs.adjustment.expired` and dispatches. The route calls `examEntryService.applyExamWithdrawals` and writes one audit row with `reasonText: 'Adjustment expired'`. There is no reason code, no case reference and no second person.
- **Nothing in the product calls it.** No admin screen, no portal page and nothing in `modules/wellbeing` calls `/expire`. Ten call sites in seven test files do, all with a staff token: `adjustments.int.test.ts` (4), `adjustment-provenance.int.test.ts`, `adjustment-target-fulfilment.int.test.ts`, `adjustment-distribution-instructions.int.test.ts`, `exam-entry-adjustments.int.test.ts`, `cross-component/adjustment-handoff.int.test.ts`, `events/phase5-event-consumer-tests.int.test.ts`.
- **ADR-033 closed the grant side only.** Recording is now one write path per authority: the wellbeing hand-off (`adjustment:record-approved`, `sourceCaseId` required), a manual proposal approved by a second person (`adjustment_proposal`, `adjustment-manual-approval`, `AdjustmentProposalService`), or a migration batch released by a second person. Withdrawal, which removes the same entitlement, still has a one-person side door. Pre-review D-44 F7 also found that a case review never withdraws what was sent (BL-240).
- **Enrolment end does not touch adjustments.** `EnrolmentService.transitionStatus` (`apps/api/src/platform/enrolment/service.ts:544`) writes the enrolment version and an `enrolment_status_transition` row. `withdrawn` and `graduated` are terminal (`ALLOWED_TRANSITIONS`, line 150). Its callers are the governed status-case decision (`status-case-service.ts:429`, decided by someone other than the opener), award conferral (`award-service.ts:265`, `:340`) and registration (`app.ts:653`). A status case can be decided with a future effective date; the new enrolment version then has `valid_from` in the future.
- **A periodic, idempotent reconcile loop already runs.** `apps/api/src/worker.ts:61` drains adjustment instructions and applies exam withdrawals per tenant on an interval.
- **Instructions already carry `validTo`** (`distribution-dispatcher.ts:135`), and exam entries honour it by date (`exam-entry-service.ts:432`, `:461`), so a natural end at `valid_to` needs no action.
- **Stage.** Alpha and pre-production, so retiring the route and adding NOT NULL-free columns and a CHECK is acceptable now.

Withdrawing a reasonable adjustment removes an Equality Act 2010 entitlement. A wrongful or mistaken withdrawal can mean a disabled student sits an exam without the extra time they are owed. It is the same harm as a wrongful grant in reverse, and needs the same control.

## Decision

1. **Every early end of a core adjustment has a named authority, chosen by the adjustment's provenance.** There are three paths and no others:

   | Path | Authority code | Who | Applies to provenance | Reasons allowed |
   |---|---|---|---|---|
   | Case hand-off | `wellbeing-case` | `wellbeing-service` only, for the case that recorded it | `wellbeing-case` | `student-request`, `no-longer-needed`, `recorded-in-error`, `superseded` |
   | Withdrawal proposal decided by a second person | `approved-withdrawal` | proposed by staff, decided by an `adjustment-approver` who is neither the proposer nor the subject | `manual-approved`, `migrated`, `legacy-direct` | the same four |
   | Enrolment end | `enrolment-ended` | the system, from a terminal enrolment status transition | all | `enrolment-ended` only |

   - **A wellbeing-case adjustment is withdrawn only through its case** (or by enrolment end). The case owns the decision (BP-04-004), so core must not diverge from it. A withdrawal proposal against one returns 409 `https://srs.example.com/errors/withdrawal-through-case`.
   - **Natural expiry at `valid_to`** is not a withdrawal and writes nothing.
   - **A withdrawal always ends valid time at the time it is applied**, as `expireAdjustment` does today: `max(now, valid_from + 1 ms)`. It is never backdated and never future-dated. A withdrawal must not retroactively undo what the adjustment already did (a late penalty waived, an exam sat with extra time); a correction of those is the marks or board process. `recorded-in-error` is no exception: the reason code tells readers the record was wrong, and the history keeps what was believed.

2. **The student's own request to stop needs a second person too.** When staff record "the student asked", it is one person's unverified claim, and the harm of a false claim is the loss of an entitlement. The cost of the second person is a short delay, during which the student can simply not use extra time. Disability services normally confirm a decline with the student anyway.
   - For a wellbeing-case adjustment the student declines in the case (BP-04-004 A2.1, `request-review`), and the case hands off the withdrawal (BL-240).
   - For the other provenances, staff propose with reason `student-request` and an `externalReference` to the student's written request. A later portal route (BL-413) lets the student make the proposal themselves; the student is then the proposer, and an approver still confirms.

3. **The existing route is retired.**
   - `POST /api/v1/adjustments/:adjustmentId/expire` is deleted. Requests get the framework's 404.
   - The public `AdjustmentService.expireAdjustment` is replaced by `withdrawAuthorisedAdjustment(tenantId, adjustmentId, authority, actorId)`, where `authority` is:

     ```ts
     | { kind: 'wellbeing-case'; sourceCaseId: string; reasonCode: CaseWithdrawalReason; replacementAdjustmentId?: string }
     | { kind: 'approved-withdrawal'; withdrawalId: string; reasonCode: CaseWithdrawalReason; replacementAdjustmentId?: string }
     | { kind: 'enrolment-ended'; enrolmentStatusTransitionId: string }
     ```

     There is no overload without an authority. It keeps today's transaction (lock, close the version, write the successor, withdraw or supersede distributions, publish `srs.adjustment.expired`, dispatch), and also writes the withdrawal columns (item 6) and the audit row (item 8) itself, so no caller can skip them.
   - **It is idempotent by state.** If the current version has already ended (naturally or by an earlier withdrawal), it writes nothing, publishes nothing and returns `{ changed: false, validTo }`.
   - **It re-validates** a `replacementAdjustmentId`: it must be a different, current adjustment (`recorded_until` null, `valid_to` null or in the future) of the same person and tenant. Otherwise 422. This also means a replacement must exist before the old one is withdrawn, so the student is never left with neither.
   - Each path calls `examEntryService.applyExamWithdrawals(tenantId)` after commit, as the route did; the worker loop remains the backstop.

4. **The case hand-off.**
   - New permission `adjustment:withdraw-approved`, held by `wellbeing-service` only.
   - `POST /api/v1/students/:personId/adjustments/:adjustmentId/withdrawal`, body `{ sourceCaseId: uuid, withdrawalReasonCode: string, replacementAdjustmentId?: uuid }`, `additionalProperties: false`.
   - The adjustment must belong to `:personId` (404 otherwise). `sourceCaseId` must equal the adjustment's `source_case_id`; a different case, or an adjustment with none, returns 409 `https://srs.example.com/errors/source-case-mismatch`.
   - Responses: 200 `{ adjustmentId, validTo, withdrawalAuthorityCode, withdrawalReasonCode, changed }`; 400; 403 for any other caller; 404; 409 `source-case-mismatch`; 422 for an unknown reason, for `enrolment-ended`, for `superseded` without `replacementAdjustmentId`, or for an invalid replacement.
   - The replay of a lost response returns 200 with `changed: false`. The wellbeing side sends it from its outbox, as for recording (ADR-029 item 6). The client and outbox are BL-240's.
   - The OpenAPI operation is classified `integration`.

5. **The withdrawal proposal.** It reuses ADR-033's shape, but in its own table: the grant proposal's columns are grant-shaped (type, scope, amount, valid period, manual reason), and a `kind` column would make most of them nullable with a CHECK per kind.
   - **New table `adjustment_withdrawal`.** Not bitemporal: a governed decision record, like `adjustment_proposal`. RLS `tenant_isolation`, `FORCE ROW LEVEL SECURITY` and the app-role grants. Columns:

     | Column | Type | Notes |
     |---|---|---|
     | `id` | uuid PK | |
     | `tenant_id` | uuid not null | |
     | `adjustment_id` | uuid not null | The logical adjustment id (not a foreign key; `reasonable_adjustment.id` repeats across versions) |
     | `person_id` | uuid not null | Copied from the current version at proposal; used for the subject check and the list filter |
     | `withdrawal_reason_code` | text not null | Value set `adjustment-withdrawal-reason-code`; CHECK `<> 'enrolment-ended'` |
     | `external_reference` | text not null, 1–100 chars | Where the evidence is held: the student's written request, the review record, the duplicate's id. An identifier, never narrative |
     | `replacement_adjustment_id` | uuid | Required when the reason is `superseded` (CHECK), null otherwise |
     | `status_code` | text not null default `proposed` | Existing value set `adjustment-proposal-status-code`: `proposed`, `approved`, `rejected` |
     | `proposed_by` text not null, `proposed_by_person_id` uuid | | From the token (`sub`, `srsPersonId`), never the body (P-23) |
     | `proposed_at` | timestamptz not null default now() | |
     | `workflow_instance_id` | uuid | |
     | `decided_by`, `decided_by_person_id`, `decided_at`, `decision_reason` | nullable | `decision_reason` required for `rejected`, max 500 |
     | `withdrawn_at` | timestamptz | Set by the approval effect when it ended the adjustment; null if it had already ended |

     A partial unique index on `(tenant_id, adjustment_id) WHERE status_code = 'proposed'` allows one open proposal per adjustment. There is no `notes` field (BL-243).
   - **Until approval nothing changes.** A `proposed` or `rejected` withdrawal leaves the adjustment current, its distributions as they were, and publishes nothing.
   - **Approval runs through `GovernedReview`.** A new workflow definition `adjustment-withdrawal-approval`, seeded by migration, copying `adjustment-manual-approval`:

     | Step key | Type | Owner role |
     |---|---|---|
     | `withdrawal-proposed` | start | |
     | `decide-withdrawal` | human-task | `adjustment-approver` |
     | `decision-gateway` (gateway `G01`, "Withdraw the adjustment?") | decision | `adjustment-approver` |
     | `withdrawal-closed` | end | |

     Spec: `subjectEntityType: 'adjustment_withdrawal'`, `assigneeRoleCode: 'adjustment-approver'`, `effectDecisionCodes: ['approved', 'rejected']`. The task context holds identifiers only (`withdrawalId`, `adjustmentId`, `personId`, `proposedBy`).
   - **The effect** is a new `AdjustmentWithdrawalService` (`apps/api/src/platform/adjustments/adjustment-withdrawal-service.ts`). On `approved` it calls `withdrawAuthorisedAdjustment` with `{ kind: 'approved-withdrawal', withdrawalId, reasonCode, replacementAdjustmentId }`, and sets `status_code`, `decided_*` and `withdrawn_at`. A retried activity finds the adjustment already ended and changes nothing. The actor on the new version is the approver. If the adjustment ended between proposal and decision, the withdrawal is still marked `approved`, with `withdrawn_at` null.
   - **No feature flag.** A withdrawal proposal has no effect without a second person, and migrated adjustments exist in tenants that leave `adjustments.manual-proposals.enabled` off. Withdrawal must work there too.

6. **The withdrawal authority is recorded on the adjustment, and the database enforces it.**
   - **New nullable columns on `reasonable_adjustment`:**
     - `withdrawal_authority_code text`, value set `adjustment-withdrawal-authority-code` (not extensible): `wellbeing-case`, `approved-withdrawal`, `enrolment-ended`;
     - `withdrawal_reason_code text`, value set `adjustment-withdrawal-reason-code`;
     - `withdrawal_id uuid`, foreign key to `adjustment_withdrawal(id)`;
     - `withdrawal_enrolment_transition_id uuid`, foreign key to `enrolment_status_transition(id)`;
     - `replacement_adjustment_id uuid`.
   - **CHECK `reasonable_adjustment_withdrawal_ck`:**
     - `withdrawal_authority_code` and `withdrawal_reason_code` are both null or both set; when null, the other three are null;
     - a set authority requires `valid_to` not null;
     - `wellbeing-case` requires `provenance_code = 'wellbeing-case'`;
     - `approved-withdrawal` requires `withdrawal_id` and `provenance_code <> 'wellbeing-case'`;
     - `enrolment-ended` requires `withdrawal_enrolment_transition_id`, and is the only authority allowed the reason `enrolment-ended`;
     - the reason `superseded` requires `replacement_adjustment_id`.
   - **No backfill.** Versions ended through the old route keep null columns and read as natural ends. Only development and demo databases hold them. Update `_journal.json` (`when` after every earlier entry).
   - **New versions copy the withdrawal columns** as they copy provenance (`attachOutcomeDocument`).
   - **The API wire shape gains `withdrawalAuthorityCode` and `withdrawalReasonCode`.** The admin record and the portal show the end date and the reason's label.
   - **Targets learn nothing new.** The withdrawal instruction and `srs.adjustment.expired` v1 are unchanged and carry no reason (ADR-017).

7. **Enrolment end withdraws adjustments automatically, as a system effect.**
   - **Authority.** The terminal `enrolment_status_transition` row (`withdrawn` or `graduated`) is the authority. That transition is itself the effect of a governed decision (a status case decided by someone other than its opener, or award conferral). No HTTP route and no permission are involved.
   - **Mechanism.** A new idempotent `AdjustmentWithdrawalService.withdrawForEndedEnrolments(tenantId)` finds current adjustments (`recorded_until` null, `valid_to` null or after now) whose enrolment's current version has `status_code` in (`withdrawn`, `graduated`) and `valid_from <= now`. It withdraws each with `{ kind: 'enrolment-ended', enrolmentStatusTransitionId }`, taking the latest transition to that status. It runs:
     - in the worker reconcile loop (`apps/api/src/worker.ts`), per tenant, next to `applyExamWithdrawals`; this is the guarantee;
     - straight after `transitionStatus` records a terminal status, through a post-commit listener registered in `app.ts` (as `onLeaverClosure` is); this is only for latency.
   - **A future-dated end waits.** A withdrawal decided today and effective next month leaves the adjustments in place until the effective time passes, and the next sweep then ends them. Adjustments are never removed from a student who is still studying.
   - **Interruption and suspension do not withdraw adjustments.** The student is expected back, and a return should not depend on re-recording each adjustment.
   - **Actor.** `actor_id = 'system:enrolment-ended'`, audit `actorType: 'system'`.

8. **Routes, audit and permissions.**

   | Method and path | Permission | Responses |
   |---|---|---|
   | `POST /api/v1/adjustments/:adjustmentId/expire` | — | removed (404) |
   | `POST /api/v1/students/:personId/adjustments/:adjustmentId/withdrawal` | `adjustment:withdraw-approved` | item 4 |
   | `POST /api/v1/students/:personId/adjustments/:adjustmentId/withdrawal-proposals`, body `{ withdrawalReasonCode, externalReference, replacementAdjustmentId? }` | `adjustment:propose-withdrawal` | 201 `{ withdrawalId, statusCode }`; 400 for unknown fields (`additionalProperties: false`); 403 `separation-of-duties` when the proposer is the subject; 404; 409 `withdrawal-through-case` for a wellbeing-case adjustment; 409 `https://srs.example.com/errors/conflict` when the adjustment has already ended or has an open withdrawal; 422 for an unknown or `enrolment-ended` reason, or an invalid replacement |
   | `GET /api/v1/adjustment-withdrawals?statusCode=&personId=` | `adjustment:propose-withdrawal` or `adjustment:approve-withdrawal` | 200, paginated (P-12) |
   | `GET /api/v1/adjustment-withdrawals/:withdrawalId` | as above | 200, 404 |
   | `POST /api/v1/adjustment-withdrawals/:withdrawalId/decision`, body `{ decisionCode: 'approved' \| 'rejected', reason?: string }` | `adjustment:approve-withdrawal` | 200 `{ withdrawalId, statusCode, adjustmentId, withdrawnAt, decisionStatus }`; 403 `separation-of-duties`; 404; 409 `conflict` when already decided; 422 when `reason` is missing for `rejected`, or the replacement is no longer current |

   - **Separation of duties (P-22), in the service.** The decision returns 403 `https://srs.example.com/errors/separation-of-duties` when the acting user is the proposer (by `sub`, and by `srsPersonId` when both carry it) or the subject student. The deciding user comes from the token. Reuse ADR-033's `SeparationOfDutiesError`.
   - **Audit rows** (actor from the token, or the system actor):
     - `adjustment_withdrawal` create, `reasonText` = the reason code;
     - `adjustment_withdrawal` update on decision, `reasonText` = the decision code;
     - `reasonable_adjustment` update, `fieldName: 'valid_to'`, before and after values, `reasonText` "Adjustment withdrawn: `<reason>` (case `<sourceCaseId>` | withdrawal `<id>` | enrolment transition `<id>`)", written by `withdrawAuthorisedAdjustment` on every path. For the hand-off, `actorType: 'integration'` with `azp` as display name (ADR-029 item 3).
   - **Permissions** (`packages/domain/src/permissions.ts`):

     | Permission | Roles | Change |
     |---|---|---|
     | `adjustment:withdraw-approved` | `wellbeing-service` | new |
     | `adjustment:propose-withdrawal` | `registry-administrator`, `adjustment-proposer`, `wellbeing-advisor` | new |
     | `adjustment:approve-withdrawal` | `adjustment-approver` | new |
     | `adjustment:write` | `registry-administrator`, `wellbeing-advisor` | unchanged roles; now covers only the outcome-document upload |

     - `wellbeing-advisor` may propose a withdrawal (unlike a manual grant, SME-6) because a migrated or manual adjustment has no case in the wellbeing module, and advisers are the people who learn it is no longer needed. A second person still decides.
     - **No role holds both `adjustment:propose-withdrawal` and `adjustment:approve-withdrawal`.** `adjustment-approver` now holds `adjustment:approve-manual`, `adjustment:release-migrated`, `adjustment:approve-withdrawal` and `adjustment:read:all`, and nothing else.

9. **Value set `adjustment-withdrawal-reason-code`** (`srs-internal`, not extensible, because two codes drive behaviour). Codes have NULL `activeFrom`/`activeTo`.

   | Code | Meaning | Paths |
   |---|---|---|
   | `student-request` | The student asked to stop it | case, proposal |
   | `no-longer-needed` | A review found it is no longer needed | case, proposal |
   | `recorded-in-error` | It should never have been recorded, for example a duplicate | case, proposal |
   | `superseded` | A replacement adjustment, named in `replacementAdjustmentId`, takes its place | case, proposal |
   | `enrolment-ended` | The enrolment it belongs to has ended | system only |

## Rationale

- **Withdrawal is the same decision as a grant, in reverse.** ADR-033 left the recording side with one write path per authority, and the withdrawal side with a one-person route that reaches every target. Matching the authority to the provenance gives each adjustment one way out that mirrors its way in: the case that granted it, a second person for a case-less grant, or the authoritative end of the enrolment it belongs to.
- **It fails towards the student.** When no approver is assigned, or the wellbeing hand-off is not built yet, an adjustment stays in force until it ends naturally or the enrolment ends. Over-provision for a short time is the lesser harm.
- **Enrolment end is safe to automate.** It follows a governed, separated decision recorded in core, it is idempotent, and it waits for the effective date, so a student who is still studying never loses an adjustment.
- **The database records why each adjustment ended.** The CHECK makes an early end without an authority and a reason impossible, as provenance did for grants.
- **Proportionate.** It reuses `GovernedReview`, workflow-definition seeding, the separation error, value sets, the worker reconcile loop and the existing distribution withdrawal logic. It adds one table, five columns, three permissions and no infrastructure.

## Options considered

| Option | Verdict |
|---|---|
| Do nothing | Rejected. One registry administrator or adviser can remove extra exam time from every target, with no reason and no case |
| (a) Service-only withdrawal from wellbeing, for every adjustment | Rejected as the whole answer. Manual, migrated and legacy adjustments have no case to withdraw them, and tenants without the wellbeing module would have no way to end one early. Kept for wellbeing-case adjustments |
| (b) A withdrawal proposal decided by a second person, for every adjustment | Rejected as the whole answer. For a wellbeing-case adjustment it lets core diverge from the case that owns the decision. Kept for the other provenances |
| (c) One person, with a mandatory coded reason and audit | Rejected. Audit after the fact does not stop a wrongful withdrawal before the student's exam, and "the student asked" is exactly the claim a single person can make up |
| (d) By provenance: case hand-off for wellbeing-case, second person for the rest, system effect for enrolment end | **Chosen** |
| Add a `kind` to `adjustment_proposal` | Rejected. Its columns are grant-shaped and NOT NULL; a kind would make most nullable, with a CHECK per kind and a branch in every reader of the table |
| Keep `/expire`, make it service-only | Rejected. A body-less route cannot carry the case or the reason; the new hand-off route replaces it |
| Withdraw on enrolment end only through staff proposals | Rejected. Thousands of leavers a year would invite rubber-stamping, and the authoritative decision is already taken in the status case |
| Backdate a withdrawal to when it became true | Rejected. It would retroactively remove late-penalty waivers and other effects already relied on, outside the marks process |
| One person may stop an adjustment at the student's own request | Rejected. The request is unverified when staff record it, and the delay of a second person costs the student little |

## Consequences

- **Breaking changes, acceptable at Alpha:**
  - the `/expire` route and `expireAdjustment` are removed;
  - the ten test call sites move to a new helper, `withdrawApprovedAdjustment(ctx, personId, adjustmentId, opts?)` in `apps/api/test/helpers/adjustments.ts`, which mints a `wellbeing-service` token. `recordApprovedAdjustment` also returns the `sourceCaseId` it used, so the helper can send it.
- **Until BL-240 ships the wellbeing client, a wellbeing-case adjustment cannot be withdrawn early** except by enrolment end. This includes one recorded in error. The risk of a duplicate is low, because the hand-off is idempotent per case.
- **If a tenant stops running the wellbeing module,** its wellbeing-case adjustments can only end naturally or by enrolment end. That needs its own decision if it arises.
- **The wellbeing case is not told** when enrolment end withdraws its adjustment. BL-240 may consume `srs.adjustment.expired`; until then the case shows `approved` for a student who has left.
- **A reinstated enrolment does not restore adjustments.** `withdrawn` is terminal, so reinstatement is an enrolment correction, and the adjustments are recorded again through their authority.
- **Until IAM assigns `adjustment-approver`,** no manual, migrated or legacy adjustment can be withdrawn early. This fails towards the student.
- **ADR-033 and ADR-029 status lines** note the amendments.
- **To confirm, without blocking** (BL-414; head of disability services, with the academic registrar):
  - whether `adjustment-approver` is the right authority for withdrawals as well as grants;
  - whether `wellbeing-advisor` may propose withdrawals of case-less adjustments;
  - that a student's own request to stop needs a second person;
  - that adjustments end automatically on withdrawal from study and on graduation, but not on interruption or suspension;
  - whether the student must be told when an adjustment is withdrawn early, and what the notice says (BL-412).

## Guard

- **`apps/api/test/adjustment-withdrawal-authority.int.test.ts`, a route matrix.** Expected responses:

  | Caller and request | Response |
  |---|---|
  | `registry-administrator` on `POST /adjustments/:id/expire` | 404 |
  | `registry-administrator` or `wellbeing-advisor` on `.../withdrawal` | 403 |
  | `wellbeing-service`, matching case | 200; `withdrawalAuthorityCode: 'wellbeing-case'`; published distributions `withdrawal-requested`, unpublished `superseded`; one `srs.adjustment.expired`; exam entries lose the arrangement |
  | the same, repeated | 200, `changed: false`, no second event or version |
  | `wellbeing-service`, another case, or a manual-approved adjustment | 409 `source-case-mismatch` |
  | `wellbeing-service` with `enrolment-ended`, `superseded` without a replacement, or a replacement of another person | 422 |
  | propose on a wellbeing-case adjustment | 409 `withdrawal-through-case` |
  | propose with `notes` in the body | 400 |
  | propose with an unknown reason or `enrolment-ended` | 422 |
  | propose for one's own record | 403 `separation-of-duties` |
  | a second open proposal for the same adjustment | 409 |
  | after a proposal: the adjustment, its distributions, events | unchanged, none |
  | the proposer decides; the subject student decides | 403 `separation-of-duties` |
  | `registry-administrator` decides | 403 |
  | a second person approves | 200; `withdrawalAuthorityCode: 'approved-withdrawal'`, `withdrawal_id` set, one audit row on `reasonable_adjustment` |
  | the approval effect is repeated | no second version |
  | rejection without a reason; rejection | 422; adjustment unchanged |
  | a status case withdraws the enrolment, effective today | the sweep ends its adjustments with `enrolment-ended` and the transition id |
  | effective next month | adjustments unchanged until the clock passes the date |
  | interruption | adjustments unchanged |
  | the sweep is run again | no change |
- **Permissions test (`apps/api/test/architecture/adjustment-permissions.test.ts`):**
  - `adjustment:withdraw-approved` is held only by `wellbeing-service`;
  - `adjustment:approve-withdrawal` is held only by `adjustment-approver`;
  - no role holds both `adjustment:propose-withdrawal` and `adjustment:approve-withdrawal`;
  - `requirePermission('adjustment:write')` appears on exactly one route in `apps/api/src/routes` (the outcome-document upload).
- **Writer allow-list test (`apps/api/test/architecture/adjustment-writers.test.ts`)** extends from inserts to version writes: an `update(reasonableAdjustments)` or `update(adjustmentDistributions)` setting `validTo`, `recordedUntil` or a withdrawal status is allowed only in `adjustment-service.ts` (and the dispatcher's existing status updates). Inserts into `adjustmentWithdrawals` are allowed only in `adjustment-withdrawal-service.ts`.
- **Database test** (`adjustment-provenance.int.test.ts`). The CHECK rejects: an authority without a reason; `approved-withdrawal` without `withdrawal_id`, or on a wellbeing-case row; `wellbeing-case` on a manual-approved row; `enrolment-ended` without a transition; `superseded` without a replacement; an authority with a null `valid_to`.
- **The TypeScript compiler.** `withdrawAuthorisedAdjustment` takes a required discriminated union, so a new caller that names no authority does not compile.
- **The governed-steps register** (BL-405) gains `adjustment-withdrawal / decide / differs from proposer and subject student`, `adjustment / case withdrawal / service only, case matches` and `adjustment / enrolment-ended / system, terminal transition only`, each pointing at the matrix test.

## Follow-up work

| ID | Title | Type | Area | Priority | Size |
|---|---|---|---|---|---|
| BL-406 | Retire `POST /adjustments/:id/expire`; `withdrawAuthorisedAdjustment` with typed authority and in-service audit; withdrawal columns, value sets and CHECK on `reasonable_adjustment`; move test call sites to `withdrawApprovedAdjustment` | Defect | Adjustments & EC | P1 | M |
| BL-407 | Case withdrawal hand-off: `POST /students/:personId/adjustments/:adjustmentId/withdrawal`, `adjustment:withdraw-approved` for `wellbeing-service` | Feature | Adjustments & EC | P1 | S |
| BL-408 | Withdrawal proposals: `adjustment_withdrawal` table, `adjustment-withdrawal-approval` workflow, `AdjustmentWithdrawalService`, routes, `adjustment:propose-withdrawal` and `adjustment:approve-withdrawal` | Feature | Adjustments & EC | P1 | M |
| BL-409 | Enrolment end withdraws adjustments: idempotent sweep in the worker loop and a post-transition listener; system actor; future-dated ends wait | Feature | Adjustments & EC | P1 | S |
| BL-410 | Guards: withdrawal route matrix, permissions assertions, CHECK test, writer allow-list over version writes, governed-steps rows | Test | Adjustments & EC | P1 | S |
| BL-411 | Admin screens: propose a withdrawal from the student record; approver worklist and decision (with BL-380) | Feature | Adjustments & EC | P2 | M |
| BL-412 | Tell the student when an adjustment is withdrawn early | Feature | Adjustments & EC | P2 | S |
| BL-413 | Portal: a student asks to stop a manual or migrated adjustment (creates a withdrawal proposal, reason `student-request`) | Feature | Adjustments & EC | P3 | S |
| BL-414 | Confirm withdrawal authority, the student-request rule and automatic withdrawal on enrolment end (head of disability services, academic registrar) | Decision | Adjustments & EC | P2 | S |
| BL-415 | Note the amendments on ADR-033 and ADR-029 (done with this ADR) | Docs | Documentation | P3 | S |

The wellbeing side (client, outbox and review outcomes that call item 4's route) stays in BL-240.
