# ADR-031: Governed Identity Merge, Propagation and Unmerge

**Status**: Proposed. The engineering design is final. The registry process owner must confirm the decision authority (who holds `identity-resolution-officer`) and the unmerge policy. The DPO must confirm the self-service rule in item 9 and the two-accounts confirmation (pre-review OQ-1, R08-9).
**Date**: 2026-11-22
**Follows**: [ADR-013](ADR-013-bitemporal-storage.md) (bitemporal storage); [ADR-018](ADR-018-versioned-regulatory-submission-lineage.md) (submission lineage); [ADR-019](ADR-019-per-target-exchange-ledger-and-reconciliation.md) (per-target ledger, which already names identity merge); [ADR-021](ADR-021-governed-identity-rights-retention-and-audit.md) (governed identity and rights); [ADR-025](ADR-025-self-service-audiences-and-identity-binding.md) (`srs_person_id`); [ADR-028](ADR-028-exceptional-circumstances-decision-authority.md) (separation of duties in the service)
**Backlog**: BL-040, BL-289; pre-review [BP-08-001–006](../business-processes/pre-reviews/pre-review-bp-08-001-006.md) R08-9 and BP-08-001 OQ-1
**Patterns**: P-22 (separation of duties in the service), P-23 (acting user from the token), P-10 (transactional outbox), P-02 (tenant isolation), P-15 (migration discipline), P-18 (domain identity is not the IdP subject)

## Context

What the code shows:

- **A link needs no decision.** `IdentityResolutionService.linkPersons` (`apps/api/src/platform/identity/identity-resolution-service.ts`) inserts a `person_identity_link` and, for `merged-into`, an `identity_redirect`, without checking that any decision exists. `POST /identity-resolution/links` (`apps/api/src/routes/identity-resolution.ts`) exposes it to anyone holding `identity:manage`.
- **`decide()` checks almost nothing.** It requires a `survivorPersonId` for `merge`, and nothing else:
  - not that the decider differs from the opener or from whoever added candidates;
  - not that the survivor is the case subject or one of its candidates;
  - not that either person is already merged away.
- **One permission covers every step.** `identity:manage` (`dpo`, `registry-administrator`; `packages/domain/src/permissions.ts:214`) guards every identity-resolution route: open, add candidate, decide and link.
- **Nothing reads a redirect.** `identity_redirect.propagated_at` (`packages/db/src/schema/identity-resolution.ts`) is never set, and no code reads `identity_redirect`. A "merge" changes no dependent record, event, ledger item or token.
- **The scale, measured from the migrations:** 43 tables have a `*person_id uuid` column.
  - 19 of them are bitemporal (`recorded_until`): `person_identity`, `enrolment`, `award`, `student_address`, `student_contact_method`, `student_regulatory_profile`, `disability_declaration`, `reasonable_adjustment`, `exceptional_circumstances`, `right_to_study_check`, `identity_verification_check`, `misconduct_case_reference`, `staff_assignment`, `curriculum_binding_change`, and the five `engagement_*` and `expected_engagement_event` tables.
  - 24 are not. They include `fee_liability`, `student_application`, `student_status_case`, `support_award`, `award_recommendation`, `graduation_invitation`, `student_document`, `delivery_item`, `email_message`, `hesa_identifier_assignment` and `processing_restriction`.
  - `business_case` refers to people logically, through `subject_type = 'person'` and `subject_id`.
- **Statutory identifiers held today:**
  - HUSID: `person.hesa_id` and `hesa_identifier_assignment.hesa_id`;
  - UCAS Personal ID: `enrolment.ucas_personal_id`, and `ucas_personal_id` in `regulatory.ts`.
  - ULN and the SLC customer reference are not stored yet.
- **Other services key on `personId`:**
  - Wellbeing: `srs_context_projection`, `enrolment_person_map` and its cases.
  - Attendance: its projections and observations.
  - The VLE connector: course membership.

  All three consume `srs.student.*` events from JetStream (`docs/architecture/domain-events.md`).
- **External systems.** IAM receives accounts through F-SIS-IAM-01 (`apps/api/src/platform/delivery/producers/access.ts`). IAM sets the `srs_person_id` claim (ADR-025).
- **The delivery ledger already exists.** `DeliveryService.request`, `/delivery-items/:id/acknowledge` and `reportFailure` are in place, with 15 configured flows in `apps/api/src/platform/delivery/flows.ts`.
- **Stage.** Alpha and pre-production, so changing the routes and permissions is acceptable now. Core principle 3 forbids destructive updates of temporal records.

## Decision

1. **A merge happens only as the execution of a recorded decision.**
   - **`POST /identity-resolution/links` is removed for `merged-into`.**
     - A `merged-into` link, a redirect and every effect below are created only inside `decide()` with `decisionTypeCode: 'merge'`, in the same transaction as the decision.
     - The route keeps `related-record` links (no redirect, no effects) under `identity-resolution:prepare`.
     - The route returns 400 for `merged-into` and `duplicate-of`, so old clients fail loudly.
   - **A merge is between two people.** Merging three records means two cases, one after the other.

2. **Roles, permissions and separation of duties.**
   - **New role: `identity-resolution-officer`** (BP-08-001's Identity Resolution Officer). Permission mapping:

     | Permission | Routes | Roles |
     |---|---|---|
     | `identity-resolution:read` | `GET /identity-resolution/cases`, `GET /identity-resolution/cases/:id`, `GET /identity-merges/:id` | `identity-resolution-officer`, `registry-administrator`, `dpo` |
     | `identity-resolution:prepare` | `POST /identity-resolution/cases`, `POST /identity-resolution/cases/:id/candidates`, `PUT /identity-resolution/cases/:id/proposal`, `POST /identity-resolution/links` (`related-record` only), `POST /identity-merges/:id/unmerge-cases` | `identity-resolution-officer`, `registry-administrator` |
     | `identity-resolution:decide` | `POST /identity-resolution/cases/:id/decision`, `POST /identity-resolution/unmerge-cases/:id/decision` | `identity-resolution-officer` |
   - `identity:manage` stays on the BP-08-002 correction-case routes only.
   - **Who may not decide.** `decide()` returns 403 problem `separation-of-duties` when the acting user is any of these:
     - the case opener;
     - anyone who added a candidate;
     - the author of the current proposal.

     Actors are compared by `sub`, and also by `srsPersonId` when both records carry it, as in ADR-028 item 4.
   - **No one may decide a case about their own record.** That is, when the decider's `srsPersonId` is either person in the case.
   - **The acting user comes from the token** (P-23). Bodies carry no `decidedBy` or `proposedBy`.

3. **A proposal, which the decision must match.**
   - **New table `identity_merge_proposal`.** Columns:
     - `id`, `tenant_id`, `identity_resolution_case_id`, `version`;
     - `survivor_person_id`, `merged_person_id`;
     - `fact_choices jsonb`;
     - `identifier_resolutions jsonb`;
     - `two_accounts_confirmed boolean`;
     - `proposed_by`, `proposed_at`.

     `PUT .../proposal` writes a new version, and earlier versions are kept.
   - **`fact_choices`** says, for each fact class that holds one row per person (`person-identity`, `regulatory-profile`), whether the survivor's or the merged person's current version becomes the survivor's. The default is the survivor's.
   - **The decision body is `{ decisionTypeCode: 'merge' | 'link' | 'reject', proposalVersion, reason }`.**
     - `decide()` returns 409 `proposal-changed` when `proposalVersion` is not the current version.
     - The survivor comes from the proposal, never from the decision body.
     - `survivorPersonId` in the body returns 400.
   - **The checks `decide()` makes**, each 422 `merge-not-allowed` with a reason code:

     | Reason code | Fails when |
     |---|---|
     | `not-a-candidate` | `{survivor, merged}` is not `{case subject, one of its candidates}` |
     | `same-person` | survivor = merged |
     | `already-merged` | either person has a current redirect from them (merges never chain) |
     | `anonymised` | either person has `retention_anonymised_at` set |
     | `restricted` | either person has an active `processing_restriction`; the case is referred to the DPO |
     | `identifier-conflict` | an identifier conflict is unresolved (item 4) |
     | `two-accounts-unconfirmed` | both people have a delivered F-SIS-IAM-01 account and `two_accounts_confirmed` is false |

4. **Conflicting statutory identifiers block the merge until each one is resolved.**
   - **A registry `STATUTORY_IDENTIFIERS` in `packages/db/src/person-references.ts`** lists each class and its columns:

     | Class | Columns |
     |---|---|
     | `husid` | `person.hesa_id` |
     | `ucas-personal-id` | `enrolment.ucas_personal_id`, `student_application` and `regulatory` columns |
     | `uln` | none yet |
     | `slc-customer-reference` | none yet |

     A class with no column yet is still listed, so a column added later is covered.
   - **A conflict** is two different non-null values of one class across the two people. Opening the proposal computes the conflicts, and the case status becomes `identifier-conflict`.
   - **Resolving a conflict.** `identifier_resolutions` must give, for every conflicting class, `{ keep: 'survivor' | 'merged', reason }`.
   - **The value that is not kept is not discarded.** It becomes a row in a new table `person_identifier_alias`, with columns `tenant_id`, `person_id` (survivor), `identifier_class`, `value`, `source_person_id`, `merge_id` and `created_at`. Lookups by that value then find the survivor.
   - **Regulatory follow-up.** When a value that is not kept, or the merged person's HUSID or UCAS PID, appears in a submitted return's lineage (ADR-018) or a delivered UCAS or SLC exchange, the merge opens a BP-07-008 regulatory correction case for `regulatory-officer`, in the same transaction. HESA owns the HUSID, so any request to HESA goes through that case. The SRS does not send one automatically.

5. **Propagation model: move current ownership, keep history in place, redirect old ids at the edge (hybrid).**
   - **The registry `PERSON_REFERENCES`** in `packages/db/src/person-references.ts` classifies every column that references a person, including `business_case (subject_type='person', subject_id)`. Each column has exactly one mode:

     | Mode | Applied to | What the merge does | What unmerge does |
     |---|---|---|---|
     | `versioned-move` | bitemporal ownership tables (for example `enrolment`, `award`, `student_address`, `reasonable_adjustment`, `staff_assignment`, the engagement tables) | Closes each current version (`recorded_until = merge time`) and inserts an identical version with `person_id = survivor` and the same valid period: a transaction-time correction. As-recorded history before the merge still shows the merged person | Inserts a new current version back to the restored person |
     | `survivor-chooses` | one-per-person bitemporal facts (`person_identity`, `student_regulatory_profile`) | Per `fact_choices`: the merged person's current version is closed on the merged person and not moved. If the proposal chose it, a new survivor version is written with its values | Restores the closed version on the restored person; the survivor's version from before the merge becomes current again |
     | `ledgered-move` | non-bitemporal current-state tables (for example `fee_liability`, `student_application`, `student_status_case`, `support_award`, `award_recommendation`, `graduation_invitation`, `student_document`, `business_case` subjects, PGR tables) | `UPDATE ... SET person_id = survivor`. Each row is recorded in `identity_merge_move` | Sets back only the recorded rows that still point at the survivor |
     | `history-in-place` | append-only records of what happened to whom (`delivery_item`, `email_message`, `audit_record`, `hesa_identifier_assignment`, `external_record`, `retention_disposal_plan_item`, `individual_rights_request`, `processing_restriction`) | Nothing. The survivor's history views read `personAliases(survivor)` | Nothing |
     | `identity-infra` | `identity_resolution_*`, `person_identity_link`, `identity_redirect`, `identity_merge*`, `data_correction_case` | Nothing | Nothing |
   - **Ratification locks (core principle 16) do not block a move.** A move changes ownership, not content. The audit record says it was done by the merge.
   - **New table `identity_merge`.** Columns:
     - `id`, `tenant_id`, `identity_resolution_case_id`, `decision_id`, `proposal_version`;
     - `survivor_person_id`, `merged_person_id`;
     - `effective_at`, `decided_by`;
     - `unmerged_at`, `unmerge_decision_id`.
   - **New table `identity_merge_move`.** Columns: `merge_id`, `table_name`, `row_key`, `mode`, `from_person_id`, `to_person_id`, `closed_version_id`, `new_version_id`.
   - **`identity_redirect` gains** `merge_id`, `ended_at` and `ended_by_merge_id`. `propagated_at` means "core moves done, event and ledger items queued", and is set in the decision transaction.
   - **The merged person's row stays.** `person.person_status_code` becomes `merged`, so the person is never deleted and the old id stays resolvable.
   - **One transaction.** The decision, its moves, the `merged-into` link, the redirect, the identifier aliases, the regulatory cases, the outbox event and the ledger requests all commit in one transaction, so there is no half-merged state. The API's 30 s `statement_timeout` applies. Stage 5 measures the time for a person with a full record.
   - **Audit.** The audit trail records:
     - one record for the decision, with `resourceType: 'identity-merge'`;
     - one summary per table, with the count of rows moved.

     The rows themselves are in `identity_merge_move`.

6. **Old ids are resolved at the edge.** `PersonRedirectResolver` is in `apps/api/src/platform/identity/person-redirects.ts`.
   - **Lookup.** `current(tenantId, personId)` reads `identity_redirect` where `ended_at IS NULL`, using the index `(tenant_id, old_person_id) WHERE ended_at IS NULL`. There is no cache, so an unmerge takes effect on the next request.
   - **Staff routes with `:personId`** use a shared preHandler `resolvePersonParam`:
     - **GET** on a merged-away id returns 307, with `Location` set to the same path for the survivor, and problem `person-merged` with `survivorPersonId`.
     - **Any other method** returns 409 `person-merged` with `survivorPersonId`. A write is never redirected silently.
   - **Search** by student number, HUSID or UCAS PID also matches `person_identifier_alias` and merged people. It returns the survivor, with `mergedFrom`.

7. **How the other services learn of a merge: an event through the core outbox.**
   - **The events.** Core publishes `srs.person.merged` v1 and `srs.person.unmerged` v1. Both have data class `personal`, partition key `survivorPersonId`, and carry no names or identifiers:
     - `srs.person.merged`: `{ mergeId, survivorPersonId, mergedPersonId, effectiveAt }`
     - `srs.person.unmerged`: `{ mergeId, survivorPersonId, restoredPersonId, effectiveAt, reallocatedToRestored: { [entity: string]: string[] } }`

     The events are added to `docs/architecture/domain-events.md` under a new `srs.person.*` section.
   - **Wellbeing, attendance and the VLE connector** each add a durable JetStream consumer, and apply the event idempotently by `mergeId`, in their own schema:
     - They re-key their own records with the same modes, recording each moved row in their own `person_merge_move` table.
     - They record that they applied the merge in their own audit log.
     - The VLE connector updates its person-to-VLE-user mapping, and lets the next provisioning snapshot move memberships.
   - **Unmerge** reverses each service's recorded moves for that `mergeId`, and applies the `reallocatedToRestored` list.
   - **No reconciliation yet.** In the first release, core does not track whether the modules have applied a merge. Reconciliation is a follow-up.

8. **External systems learn of a merge through the delivery ledger (ADR-019).**
   - **A `person-merged` notice.** For each enabled flow in `DELIVERY_FLOWS` that has a delivered item for either person, the merge requests one ledger item with message type `person-merged`. It carries `{ survivorPersonId, mergedPersonId, survivorStudentNumber, mergedStudentNumber, effectiveAt }`, as a minor version of each flow's contract.
   - **A fresh snapshot.** The flow's existing producer then requests a new snapshot for the survivor. An example is `requestItsmSnapshot`.
   - **Unmerge** sends `person-unmerged`, then snapshots for both people.
   - **HESA, UCAS, SLC and UKVI** are not ledger targets for this. They are handled by the regulatory cases in item 4.

9. **IAM, `srs_person_id`, and students' own access.**
   - **While a case is open, nothing changes.** Each account sees its own person.
   - **From the moment of the merge, a token whose `srs_person_id` is a merged-away id is resolved to the survivor.**
     - An `onRequest` hook, after authentication, sets `request.user.srsPersonId` to the survivor and keeps the original in `request.user.srsPersonIdAsIssued`.
     - Self-service routes keep reading `request.user.srsPersonId`, so the rule that they never use `sub` is unchanged.
     - The audit trail records both ids.
   - **IAM (F-SIS-IAM-01):**
     - If only the merged person has an account, IAM is told to bind it to the survivor: a `rebind` instruction, with `successorPersonId`.
     - If both have accounts, the merged person's account gets `ended`, with reason `merged`, and the survivor's account is recomputed. The proposal must confirm this case (`two_accounts_confirmed`), because one human then loses an account.
   - **After an unmerge,** the redirect ends at once, so tokens resolve to their own person again on the next request. IAM gets `rebind` or `restore` instructions.

10. **Unmerge is a governed case of its own.**
    - **Opening.** `POST /identity-merges/:id/unmerge-cases` (prepare) opens a BP-08-001 business case with `caseKindCode: 'unmerge'`.
    - **The proposal** lists every record created on or moved to the survivor after `effective_at` that has no move record, each with an allocation of `survivor` or `restored` (default `survivor`).
    - **The decision** (decide permission, with the same separation-of-duties rule) reverses the merge's moves:
      - `versioned-move`: a new version back to the restored person;
      - `ledgered-move`: rows still pointing at the survivor;
      - `survivor-chooses`: the closed versions are restored.

      It then applies the allocations, deletes the merge's identifier aliases, sets `person_status_code` back, ends the redirect, sets `identity_merge.unmerged_at`, and publishes `srs.person.unmerged`, the ledger notices and the IAM instructions. All of this happens in one transaction.
    - **Limits.** There is no time limit. It is refused (422 `unmerge-not-allowed`) when the restored person has been anonymised or disposed of since.

11. **Case states (`business_case.status_code` for BP-08-001).** The values are registered as a value set (P-16):
    `open` → `proposed` → (`identifier-conflict` ⇄ `proposed`) → `merged` | `linked` | `rejected` → `closed`.
    An unmerge case runs `open` → `proposed` → `unmerged` | `rejected` → `closed`.

## Rationale

- **The hybrid is the only option that keeps every system true to itself.**
  - Moving current ownership means the 40-odd query paths that read "this person's enrolments" keep working with no change, because they query by the survivor's id.
  - Doing it as new versions for bitemporal tables keeps core principle 3: nothing is destroyed, and "what did we believe before the merge" still has an answer.
  - Recording each non-bitemporal move makes an unmerge exact rather than a forensic exercise.
  - Leaving the record of what happened in place (deliveries, emails, audit) keeps the record accurate. An email was sent to person B, and saying so is the truth.
- **Edge redirection keeps old ids safe.** Bookmarks, external references, module messages and tokens issued before IAM catches up all keep working, and no write can land silently on a merged-away record.
- **Governance where the harm is.** A wrong merge discloses one person's record to another, which is a personal-data breach (R08-9). Two independent officers, survivor checks, identifier conflicts and an explicit two-accounts confirmation put the controls on that one decision.
- **The tools already exist.** The events go through the existing outbox and JetStream, and external systems through the existing ledger. Nothing new is deployed.

## Options considered

| Option | Verdict |
|---|---|
| Do nothing (link and redirect with no effect) | Rejected. A merge changes nothing, and a merge with no decision is possible (R08-9) |
| Rewrite every `person_id` in place (`UPDATE`), with no versions | Rejected. It destroys bitemporal history (core principle 3), as-recorded queries would show the survivor in the past, and unmerge would depend on a perfect side log for 43 tables |
| Read-time resolution only: no record moves; every read queries `person_id = ANY(members(survivor))` | Rejected. Every query path that reads by person (more than 40 tables, plus three services) would have to change, and a path that is missed silently shows a partial record. It cannot be guarded by one check |
| **Hybrid: versioned or ledgered move of current ownership, history kept in place, edge redirect, governed unmerge** | **Chosen** |
| Merge asynchronously in a background workflow | Rejected. It allows a half-merged state visible to users. One person's rows fit in one transaction (to be measured in stage 5) |
| Modules acknowledge through the delivery ledger | Deferred. They are first-party consumers of the event, and reconciliation is a follow-up |

## Consequences

- **Breaking changes to the API:**
  - `POST /identity-resolution/links` accepts only `related-record`;
  - the decision body changes;
  - `identity:manage` no longer reaches BP-08-001.

  This is acceptable at Alpha.
- **Every new table with a person column must be classified.** The guard fails the build if it is not, which is deliberate.
- **Wellbeing, attendance and the VLE connector each gain a consumer** and a `person_merge_move` table.
- **Each person-bearing delivery flow gains a `person-merged` message type.** Targets must accept the contract's minor version. Only the manual and stub modes exist today, so a manual target's operator sees a task.
- **Self-service follows the merge at once**, with no wait for IAM. That is correct only because the decision is controlled; the DPO must confirm it.
- **Inconsistency noticed:** core principle 3 lists tuition fee liability as bitemporal, but `fee_liability` has no `recorded_until`. This ADR treats it as `ledgered-move`. Making it bitemporal is a separate follow-up.
- **To confirm:**
  - by the registry process owner: who is given `identity-resolution-officer` (at least two people per institution), and the unmerge policy (default: always allowed, governed);
  - by the DPO: self-service resolution at the moment of the merge, and the two-accounts confirmation.

## Guard

- **`packages/db/test/person-references.test.ts`.** On a freshly migrated database, it fails when:
  - a column named `%person_id`, or a `subject_type`/`subject_id` pair, is not in `PERSON_REFERENCES`;
  - an entry is `versioned-move` on a table without `recorded_until`.

  The same test in wellbeing, attendance and the VLE connector covers their own schemas.
- **`apps/api/test/identity-merge.int.test.ts`.** Expected outcomes:

  | Situation | Expected |
  |---|---|
  | merge decided by the opener, by a candidate adder or by the proposal author | 403 `separation-of-duties` |
  | survivor not subject or candidate; already merged; anonymised; restricted | 422 `merge-not-allowed` with the matching reason code |
  | identifier conflict unresolved | 422 `merge-not-allowed` (`identifier-conflict`) |
  | stale `proposalVersion` | 409 `proposal-changed` |
  | `POST /identity-resolution/links` with `merged-into` | 400 |
  | a valid merge | survivor's current rows include every moved row; the merged person's as-recorded history before the merge is unchanged; one outbox event; ledger items for flows with prior deliveries; an alias for the HUSID that was not kept; a BP-07-008 case when it was in a submitted return |
  | GET, then PATCH, on the old id | 307, then 409 |
  | a token with the old `srs_person_id` | reads the survivor |
  | unmerge | row ownership matches the state before the merge, except for allocated records; the redirect ends; a token with the old id sees only its own person again |
- **`packages/domain` permissions test.** `identity-resolution:decide` is held only by `identity-resolution-officer`. `identity:manage` guards no BP-08-001 route.
- **Consumer tests in each module.** Applying `srs.person.merged` twice equals applying it once, and unmerge restores the state.

## Implementation stages

| Stage | Scope | Done when |
|---|---|---|
| 0 | Permissions and role; proposal table; `decide()` checks and separation of duties; link route restricted; case value set | Permissions and separation-of-duties tests pass |
| 1 | `PERSON_REFERENCES` and `STATUTORY_IDENTIFIERS` registries, with their guard test; migration for `identity_merge`, `identity_merge_move`, `person_identifier_alias`, the redirect columns and the index | The guard passes on core |
| 2 | Merge execution: the three move modes, aliases, regulatory cases, audit, outbox event, ledger notices | Merge integration test passes |
| 3 | Edge: `resolvePersonParam`, the self-service `onRequest` hook, alias search; IAM `rebind` and `ended`/`merged` instructions (F-SIS-IAM-01 contract minor version) | 307 and 409 tests and token tests pass |
| 4 | Consumers in wellbeing, attendance and the VLE connector | Consumer tests pass |
| 5 | Unmerge case and execution; admin screens for proposal, decision and unmerge; merge time measured for a full-record person | Unmerge tests pass; timing recorded in `current-capabilities.md` |

## Follow-up work

| ID | Title | Type | Area | Priority | Size |
|---|---|---|---|---|---|
| BL-353 | Identity-resolution roles and permissions, proposal, decision checks and separation of duties; links route limited to `related-record` (BL-289, part) | Feature | Identity & rights | P1 | M |
| BL-354 | `PERSON_REFERENCES` and `STATUTORY_IDENTIFIERS` registries with the schema guard test in core and the modules | Test | Identity & rights | P1 | S |
| BL-355 | Merge execution: versioned, ledgered and survivor-chooses moves, identifier aliases, BP-07-008 case, audit, `srs.person.merged` (BL-040) | Feature | Identity & rights | P1 | L |
| BL-356 | Edge resolution of merged ids: 307 and 409 on staff routes, self-service token resolution, alias search | Feature | Identity & rights | P1 | M |
| BL-357 | Delivery ledger `person-merged` and `person-unmerged` messages, and IAM `rebind`/`ended`/`merged` (F-SIS-IAM-01 minor version) | Integration | Integrations | P1 | M |
| BL-358 | Wellbeing, attendance and VLE connector consumers for `srs.person.merged` and `srs.person.unmerged` | Integration | Integrations | P1 | M |
| BL-359 | Governed unmerge case and execution | Feature | Identity & rights | P1 | M |
| BL-360 | Admin screens: merge proposal (fact choices, identifier conflicts, two-accounts confirmation), decision, unmerge | Feature | Admin & portal UI | P1 | M |
| BL-361 | Reconcile module application of merges (per-service acknowledgement or snapshot) | Integration | Integrations | P2 | M |
| BL-362 | Make `fee_liability` bitemporal, as core principle 3 states, or correct the principle | Tech debt | Tenancy & data | P2 | M |
| BL-363 | Confirm merge decision authority, unmerge policy and self-service rule (registry process owner, DPO) | Decision | Identity & rights | P1 | S |
