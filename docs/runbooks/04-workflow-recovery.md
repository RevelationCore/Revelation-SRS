# Runbook 04 — Workflow Recovery

Covers: Temporal workflow stuck or failed, worker pod down, workflow needing
manual reset.

---

## Step 1 — Identify the failing workflow

Open the Temporal UI at `https://temporal.example.com` (requires operator access).

- Navigate to **Namespace: default → Workflows → Failed**.
- Note the `workflowId` and `runId` of the failing workflow.
- Inspect the workflow history for the failing event and error message.

Alternatively via the Temporal CLI:
```bash
temporal workflow list --query 'ExecutionStatus="Failed"' -n default
temporal workflow describe --workflow-id <id> -n default
```

---

## Step 2 — Diagnose the failure

| Failure type | Symptom | Action |
|---|---|---|
| Activity failure (retryable) | Activity is retrying; backoff increasing | Wait; or manually terminate and re-trigger if stuck |
| Activity failure (non-retryable) | Workflow has failed permanently | Inspect error; fix data; reset workflow to before failing event |
| Worker pod down | Workflow stuck in `Running` with no heartbeat | Restart worker pod; workflow resumes automatically |
| Schema mismatch | `ApplicationError: unknown activity type` | Rolling deploy workers before API; see upgrade runbook |

---

## Step 3 — Restart worker pods

If the worker is down or unresponsive:

```bash
kubectl get pods -l app.kubernetes.io/name=srs-worker -n revelation-srs
kubectl rollout restart deployment/srs-worker -n revelation-srs
```

Temporal workflows resume automatically once a worker is available — no manual
intervention is required for healthy workflows that were simply waiting for a worker.

---

## Step 4 — Reset a failed workflow

If a workflow has permanently failed and the underlying issue is fixed:

```bash
# Reset to the last completed event before the failure
temporal workflow reset \
  --workflow-id <id> \
  --run-id <run-id> \
  --event-id <last-good-event-id> \
  --reason "manual reset after data fix [incident-XXX]" \
  -n default
```

Verify the reset workflow resumes and completes:
```bash
temporal workflow describe --workflow-id <id> -n default
```

---

## Step 5 — Audit trail

Record the intervention in the SRS audit log via the admin API:

```bash
curl -X POST -H "Authorization: Bearer <token>" \
  https://api.example.com/api/v1/audit-log \
  -H 'Content-Type: application/json' \
  -d '{"entityType":"workflow","entityId":"<id>","action":"manual_reset","notes":"<reason>"}'
```

---

## Step 6 — Post-recovery verification

1. Temporal UI shows no failed workflows.
2. `TemporalWorkflowFailures` Prometheus alert is resolved.
3. `TemporalWorkerDown` alert is resolved.
4. Affected student records are in the expected state.
