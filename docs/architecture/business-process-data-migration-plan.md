# Business Process Data-Model Migration Plan

> Status: Active — migration `0037` implemented for generic development; production deployment not authorised
> Date: 2026-07-27
> Starting physical baseline: migration `0033`

[Delta assessment](business-process-data-model-delta.md) · [Target model](business-process-target-data-model.md) · [P0 requirements](../requirements/business-process-p0-functional-requirements.md)

## Strategy

Use expand–backfill–dual-read/write–cutover–contract. Schema migrations must be deployable independently from workflow activation. New behaviour remains disabled by tenant/environment feature flags until backfill and reconciliation pass.

Do not combine all BPR-D work into one migration. The sequence below is a planning allocation; final migration numbers are assigned when ADRs and entity names are approved.

## Stage 0 — Decision and baseline freeze

**Entry:** Current production schema and services remain authoritative.

1. Approve or supersede the ADRs relevant to the aggregate being implemented.
2. Confirm entity names, aggregate ownership and sensitive-data classifications.
3. Add characterization tests for existing admissions, CAS, assessment, HESA, adjustment, integration and retention behaviour.
4. Capture per-tenant row counts, null rates, code distributions and orphan checks.
5. Record current migration checksum and rollback/recovery test.

**Exit:** Approved target schema and repeatable baseline evidence.

## Proposed migration sequence

| Planned migration | Capability | Principal action | Initial priority |
|---|---|---|---:|
| 0034 | Shared cases/evidence/source versions | Create shared primitives, RLS, indexes and FK rules | P0 foundation |
| 0035 | Distribution item/attempt/acknowledgement | Create durable target ledger; retain `integration_exchange` compatibility | P0 foundation |
| 0036 | CAS and sponsor compliance | Extend/bridge `ukvi_cas_request`; create checks, assignment/report versions | P0 |
| 0037 | Engagement/intervention | **Implemented** — expected event, observation/correction, alert, intervention, contact, action and referral tables with RLS/value sets | P0 |
| 0038 | Support outcome distribution | Extend adjustment/outcome and backfill distribution items | P0 |
| 0039 | Assessment attempts/moderation | Create attempt, mark-set, moderation and exact-rule references | P0 |
| 0040 | Board authority/ratification | Extend pack/board; create decisions, ratification and publication | P0 |
| 0041 | Academic correction distribution | Extend post-ratification records and correction target work | P0 |
| 0042 | Regulatory collection/lineage | Create generic regulatory aggregate and HESA/OfS bridges | P0 |
| 0043 | Identity/correction cases | Create identity-resolution, links, redirects and correction cases | P0 |
| 0044 | Rights/retention/disposal | Create rights, restriction, schedules, assignments, holds and disposition | P0 |
| 0045 | Audit hardening/review | Add audit metadata/seals and review entities | P0 |
| 0046 | Admissions/offer | Create channel-neutral application, assessment, offers and conditions | P1 |
| 0047 | Status/curriculum binding | Create status cases, publication and enrolment rule binding | P1 |
| 0048 | Module selection | Create proposals, validation, approval, waits/holds and change sets | P1 |
| 0049 | PGR supervision/progress | Create assignments and review/milestone aggregates | P1 |
| 0050 | PGR examination | Create thesis/examiner/viva/outcome/deposit aggregates | P1 |
| 0051 | Progression/award | Add reassessment, evidence, recommendation and conferment | P1 |
| 0052 | Documents/graduation | Create document and ceremony aggregates | P1 |
| 0053 | Contract migration cleanup | Remove compatibility columns/views only after adoption gates pass | Contract |

## Stage 1 — Shared foundations

### Expand

- Add new tables with nullable external/domain links where backfill cannot be atomic.
- Apply tenant RLS immediately.
- Add uniqueness for logical/version identity and idempotency.
- Add `created_at`/actor/source metadata to append-only records.
- Add bitemporal checks and current-version partial unique indexes.

### Backfill

- Create one distribution item for each current adjustment target state and link legacy distribution rows as attempts/acknowledgements.
- Create source-version references for immutable artefacts where current exact IDs can be proven.
- Do not invent evidence, decisions or acknowledgements that were never recorded; mark `legacy_unverified` with migration provenance.

### Compatibility

- Provide read views/adapters matching existing `integration_exchange` and `adjustment_distribution` service contracts.
- New workflow code writes new records and, during transition, emits the existing event/API projection.

## Stage 2 — P0 domain migrations

### CAS

- Preserve `ukvi_cas_request.id` as a legacy source reference.
- Create one `cas_case` per logical current request.
- Backfill sponsor/course/enrolment facts from exact as-of versions.
- Never fabricate eligibility checks or approval; store `legacy_not_recorded`.
- New CAS assignment writes immutable assignment version plus distribution/receipt.

### Engagement

- Begin expected-event history from cutover unless a signed source snapshot can be imported.
- Import attendance as append-only evidence with source and received time.
- Do not derive historic sponsor decisions from attendance retrospectively.

### Support

- Move free-text operational notes only after data-minimisation review.
- Backfill effective outcome versions and target items.
- Reconcile each target before switching the distribution dashboard.

### Assessment and boards

- Derive candidate attempts from module registration, component and `attempt_number`; quarantine ambiguity.
- Create initial mark sets from current versions without claiming historic moderation.
- Hash existing board pack candidate profiles and record migration generation.
- Link current locked marks/results to their board where `exam_board_id` proves the relationship.
- A lock with no provable board becomes a blocking data-quality case.

### Regulatory

- Represent each HESA return as a generic regulatory collection with a bridge to existing IDs.
- Build lineage only from demonstrable source versions/transforms.
- Preserve exact existing payload hashes and receipts.
- Add new SFC/Medr/DfE collections without coercing them into HESA fields.

### Identity, rights and retention

- Do not auto-create merge decisions from matching scores.
- Convert existing anonymisation timestamps into legacy dispositions only when the job/audit evidence proves authority.
- Apply new restrictions prospectively after APIs and extract services enforce them.
- Seal existing audit partitions as legacy ranges; do not claim pre-seal tamper evidence.

## Stage 3 — P1 lifecycle migrations

- Convert `ucas_application` into the channel-neutral application aggregate through an ID bridge; keep UCAS payload/reference children.
- Backfill offers only where source state/evidence supports an actual offer version.
- Bind current enrolments to route/rule set using deterministic cohort rules; ambiguous records become migration exceptions.
- Do not convert registered modules into historical proposals.
- Import staff/PGR/thesis/document facts only from authoritative HR/CRIS/repository/document sources.
- Split award recommendation and conferment only where meeting/delegated-authority evidence exists.

## Cutover gates

| Gate | Required evidence |
|---|---|
| Schema | Migration applies from clean install and every supported prior release |
| Tenant isolation | RLS negative tests for every new tenant table |
| Temporal | No overlapping current versions; point-in-time reconstruction tests pass |
| Referential | No unowned/orphan rows; tenant-consistent relationships pass |
| Backfill | Counts, totals and sampled record histories reconcile |
| Privacy | Classification, RBAC, read audit and retention approved |
| Integration | Idempotency, retry, application acknowledgement and snapshot reconciliation pass |
| Workflow | Old/new outcome parity demonstrated before feature-flag cutover |
| Regulatory | Signed sample return reproduces exact payload and lineage |
| Performance | New indexes satisfy measured workflow/report queries |

## Dual-read and dual-write policy

1. Prefer dual-read with comparison before dual-write.
2. Where dual-write is required, the new authoritative transaction commits first and the legacy projection is derived idempotently.
3. Record parity metrics by tenant and capability.
4. Stop cutover on unexplained mismatch; do not auto-heal regulated/academic differences.
5. After two agreed operating cycles or one full statutory/board cycle, disable legacy writes.

## Rollback

### Before cutover

Disable feature flags and application use of new tables. Additive schema remains dormant; do not drop populated tables.

### After dual-write cutover

Return reads to the legacy projection only if parity is confirmed and no new-only authoritative fact has been created. Otherwise use a forward fix.

### After contract

Restore from tested backups or deploy a forward compatibility migration. Destructive down migrations are prohibited for academic, regulatory, identity, rights and audit history.

## Migration exception register

Every exception records:

- tenant and capability;
- legacy source table/ID;
- expected and observed condition;
- sensitivity;
- whether cutover is blocked;
- owner, decision and evidence;
- correction or accepted-exception authority.

No generic “migration completed with warnings” outcome is permitted for P0 records.

## Verification deliverables

- Drizzle schemas and SQL migrations.
- Migration tests from clean and populated fixtures.
- Tenant/RLS tests.
- Backfill reconciliation reports.
- API/event/contract compatibility tests.
- Temporal and idempotency property tests.
- Data-protection and records sign-off.
- Updated data model, contract catalogue, event taxonomy and workflow traceability.
