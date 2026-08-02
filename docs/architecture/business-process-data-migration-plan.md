# Business Process Data-Model Migration Plan

> Status: Historical — superseded 2026-08-01 by a clean-build migration squash
> Date: 2026-07-27; squash note added 2026-08-01

[Delta assessment](business-process-data-model-delta.md) · [Target model](business-process-target-data-model.md) · [P0 requirements](../requirements/business-process-p0-functional-requirements.md)

> **Clean-build note (2026-08-01):** this document originally planned an expand–backfill–dual-read/write–cutover–contract migration sequence (numbered `0034`–`0053`+) to protect existing production data while the P0 business-process schema landed. Revelation SRS has never had a first production user, so that data-protection discipline no longer serves a purpose and added onboarding complexity for no benefit. All migration history (`packages/db/migrations/`, plus `modules/wellbeing`, `adapters/vle`) has been squashed into a small, clean set of migrations representing the current schema directly — see `packages/db/migrations/0000_platform_foundations.sql` onward. The numbered migration-sequence table that used to appear below has been removed; the sections after it are kept as a historical record of the P0 domain-by-domain design considerations (still relevant reading for anyone extending these aggregates), not as a live migration plan. Once the application has real production tenants, a fresh expand-backfill-cutover discipline should be reinstated for any further schema evolution.

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
