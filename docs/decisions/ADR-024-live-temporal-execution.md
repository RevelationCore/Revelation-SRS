# ADR-024: Live Temporal execution for review workflows

**Status:** Accepted
**Date:** 11 November 2026
**Follows:** [ADR-005](ADR-005-workflow-engine.md) (Temporal as the workflow engine),
[ADR-015](ADR-015-workflow-feature-flags-and-environment-promotion.md),
[ADR-016](ADR-016-authoritative-business-state-and-workflow-separation.md)
**Plan:** [Live Temporal integration plan](../architecture/temporal-integration-plan.md)

## Context

ADR-005 chose Temporal, but until now no application code started, signalled or
queried a Temporal workflow. All workflow state lived in the SRS database and was
changed in-process by `WorkflowBridgeService`. Deadlines were enforced only when
someone called the manual overdue sweep. Workflow events were dropped silently
when NATS was unavailable.

The integration plan left four decisions to this record: which versions to pin,
the namespace model, how decisions are accepted, and what the later expansion
stage covers.

## Decisions

### 1. Pinned versions

| Component | Version | Where |
|---|---|---|
| TypeScript SDK (`@temporalio/client`, `worker`, `workflow`, `activity`, `testing`) | 1.25.0 (exact) | `packages/workflow`, `apps/api` |
| Temporal Server | 1.32.2 | `temporalio/server` in `infra/k8s/base/temporal.yaml` |
| Admin tools (schema setup) | 1.32.2 | `temporalio/admin-tools` init container |
| Web UI | 2.58.1 | `temporalio/ui` in k8s |
| Local dev server | Temporal CLI 1.10.0 (bundles Server 1.32.2, UI 2.56.1) | `temporalio/temporal` in Compose and in integration tests |

The upgrade from server 1.24 / SDK 1.17.2 was made while no executions existed,
so no history migration was needed. `temporalio/auto-setup` is deprecated and is
no longer used. Upgrades from now on must follow the replay and backup checks in
the plan's deployment section.

### 2. One namespace per environment

The pilot uses one Temporal namespace per deployment environment (for example
`srs-local`, `srs-production`), configured by `TEMPORAL_NAMESPACE`, and one task
queue (`srs-workflows`). The tenant is carried in the workflow ID
(`srs:<environment>:<tenant>:<instance>`) and in every activity input.

Namespaces are not treated as an authorisation boundary. Every activity loads
its command under the tenant's row-level-security context, so a command from
another tenant or a forged command ID is ignored. Per-tenant namespaces remain
an option if an institution needs separate retention, quotas or operator access.

### 3. Decisions: saved first, delivered by Update, re-delivered by Signal

- A decision or cancellation is saved as a `workflow_command` row, unique per
  task revision, before Temporal is contacted. The same idempotency key and
  payload return the same receipt; a second decision for the same revision is
  a conflict.
- The API then delivers it with a Temporal **Update** and waits up to
  `TEMPORAL_DECISION_WAIT_MS` (default 10 s) for the outcome. Normally the
  user gets `200` with the applied outcome, so the Task Inbox keeps its
  request-and-result behaviour.
- If the worker or Temporal is unavailable, the API returns `202 Accepted` with
  a status URL. The decision is not lost: the reconciler re-delivers it by
  **Signal** until the workflow confirms it.
- Signals and Updates carry only a command ID. The worker loads the actor,
  decision and payload from the database, so a signal cannot introduce new
  authority.
- Legacy-run tasks keep their existing `204` behaviour.

### 4. Ownership of state and timers

- The database stays authoritative for instances, tasks, decisions and
  business records. Starting a review writes the instance and its task in one
  transaction; Temporal then owns waiting, the deadline timer and the order in
  which commands are applied.
- Each applied command, escalation, audit row and workflow event commits in one
  transaction with an operation receipt. A retried activity returns the
  receipt's result.
- Business changes (the pilot: module registration) run as idempotent domain
  effects before the review closes. Business-rule failures keep the decision,
  reopen the task and report why; they are never retried forever.
- The execution backend (`legacy` or `temporal`) is stored per instance and
  never changes. The legacy overdue sweep ignores Temporal-run tasks.
- `/ready` reports Temporal but does not fail because of it: during a workflow
  outage the API keeps serving records and saving decisions.

### 5. Rollout and scope

- `TEMPORAL_EXECUTION_ENABLED=true` enables the capability for a deployment.
  The `workflow.temporal-execution` flag (default off) then selects new starts
  by tenant, environment and workflow definition version.
- Covered now: builder-authored single-review workflows and
  `module-registration-change-approval`.
- Stage 6a (later): the other workflow-bridge callers — admissions, student
  record changes (legal identity), module selection and the five regulatory
  submission workflows.
- Stage 6b is **out of scope** unless a later ADR says otherwise: PGR, data
  subject access requests and identity resolution (on `business_case`, ADR-023)
  and the wellbeing module's case state machines. They do not use the workflow
  bridge and need their own design.

## Consequences

- A worker (`apps/api/src/worker.ts`, the API image with a different entry
  point) must run wherever the capability is enabled. It also runs the
  reconciler, which starts saved reviews, re-delivers saved commands and
  publishes saved workflow events.
- Workflow events now go through `workflow_event_outbox`, so they survive a NATS
  outage. Other services still publish directly; a platform-wide outbox is a
  separate piece of work.
- Integration tests need Docker for both PostgreSQL and the Temporal dev server;
  workflow unit tests use the SDK's time-skipping test server.
- Not yet done: production Worker Versioning, a load test against the API's
  500 ms p95 target, and alert rules for the new backlog metrics. See the
  plan's progress section.
