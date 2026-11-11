# Runbook 04 — Workflow Recovery

Covers: Temporal-run reviews that are stuck, decisions that were saved but not
applied, a worker that is down, and Temporal or NATS outages.

Background: [ADR-024](../decisions/ADR-024-live-temporal-execution.md). The SRS
database is the record of truth. Temporal coordinates waiting, deadlines and the
order decisions are applied. **Do not edit workflow rows in the database by hand,
and do not start a fresh Temporal workflow for a review that already has one.**

Only reviews with `execution_backend = 'temporal'` run on Temporal. Legacy
reviews are not covered here; their deadlines are handled by
`POST /api/v1/workflow-tasks/sweep-overdue`.

---

## Step 1 — Check the backlog

```bash
curl -H "Authorization: Bearer <token>" https://api.example.com/api/v1/workflow-execution/health
```

| Field | Meaning | Normal |
|---|---|---|
| `startingInstances` | Reviews saved but not yet started on Temporal | 0, or briefly above 0 |
| `pendingCommands` | Decisions saved but not yet applied | 0, or briefly above 0 |
| `oldestPendingCommandSeconds` | Age of the oldest unapplied decision | Under a minute |
| `needsAttentionInstances` | Deadline passed with no escalation role configured | Act on these (Step 5) |
| `failedCommands` | Decisions recorded whose business change could not be applied | See Step 6 |
| `unpublishedEvents` | Workflow events waiting for NATS | 0 when NATS is up |

Then check the worker:

```bash
kubectl get pods -l app.kubernetes.io/name=srs-worker -n revelation-srs
kubectl exec deploy/srs-worker -n revelation-srs -- wget -qO- http://localhost:9466/ready
```

`/ready` returns 503 unless the worker is polling its task queue. Its response
also shows the last reconciliation result.

---

## Step 2 — Worker down or not polling

```bash
kubectl rollout restart deployment/srs-worker -n revelation-srs
```

Waiting reviews resume on the new worker with their timers intact. Decisions
saved while the worker was down are re-delivered by the reconciler within
`RECONCILE_INTERVAL_MS` (default 15 s). Staff do **not** need to decide again,
and doing so is refused as a duplicate.

To confirm a worker can run workflow code at all:

```bash
TEMPORAL_ADDRESS=<address> TEMPORAL_NAMESPACE=<namespace> \
  pnpm --filter @revelation-srs/api workflow:smoke
```

---

## Step 3 — Temporal unavailable

While Temporal is down:

- The API stays ready and keeps serving records (`/ready` reports Temporal as
  `required: false`).
- New Temporal-run reviews are saved with status **Starting**.
- Decisions are saved and return `202 Accepted`.

When Temporal is back, the reconciler starts the saved reviews and delivers the
saved decisions. To run a pass immediately:

```bash
curl -X POST -H "Authorization: Bearer <token>" https://api.example.com/api/v1/workflow-execution/reconcile
```

If the outage lasts a long time, turn the rollout flag `workflow.temporal-execution`
off so new reviews start on the legacy path. Reviews that already started on
Temporal stay on Temporal.

---

## Step 4 — NATS unavailable

Workflow events are saved in `workflow_event_outbox` and published by the
reconciler when NATS returns. Consumers receive each event's stable `id` and
must de-duplicate on it. No action is needed beyond restoring NATS.

---

## Step 5 — Needs attention

A review whose deadline passed with no escalation role configured is flagged
**Needs attention** in the Task Inbox. It is never completed automatically. Ask
the assigned role (or someone with `workflow:write`) to decide it, or cancel it:

```bash
curl -X POST -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' \
  https://api.example.com/api/v1/workflow-instances/<instanceId>/completion \
  -d '{"statusCode":"cancelled","metadata":{"reason":"<reason>"}}'
```

Administrative completion (`"statusCode":"completed"`) is refused for
Temporal-run reviews because it would bypass the decision.

---

## Step 6 — Decision recorded but change not applied

For a review that applies a business change (currently module registration
change requests), a business-rule failure (closed window, capacity, duplicate)
is shown to the decider with the reason. The decision is kept in
`workflow_decision_audit` with `changeApplied: false`, and the review stays open.
Fix the cause and decide again. Nothing is retried automatically.

---

## Step 7 — Inspecting Temporal directly

The Temporal UI is for operators only (restricted ingress). The workflow ID is
`srs:<environment>:<tenantId>:<workflowInstanceId>`, stored on the instance as
`temporal_workflow_id`.

```bash
temporal workflow describe --workflow-id <id> -n <namespace>
temporal workflow query --workflow-id <id> --type reviewState -n <namespace>
```

A reset re-runs activities, which is safe because every effect is applied under
a receipt. Record the reason:

```bash
temporal workflow reset --workflow-id <id> --type LastWorkflowTask \
  --reason "<reason> [incident-XXX]" -n <namespace>
```

Do not terminate a review that has pending decisions unless you also cancel it
in the SRS (Step 5). A terminated execution with unapplied decisions shows up as
`pendingCommands` that never clear.

---

## Step 8 — Post-recovery checks

1. `workflow-execution/health` shows `startingInstances` and `pendingCommands`
   at 0, or falling.
2. The worker's `/ready` returns 200.
3. Affected student records are in the expected state. For registration change
   requests, check that each approved request has exactly one registration.
4. Record the intervention in the incident log, with workflow IDs.
