# Runbook 02 — Incident Triage

Use this runbook as the first step for any production alert. It describes how
to orient quickly, identify the scope, and hand off to the specific runbook.

---

## Step 1 — Determine scope

Open the Grafana dashboard and check:

1. **API error rate** (`ApiHighErrorRate` alert): what percentage of requests are 5xx?
2. **API latency** (`ApiHighLatency` alert): what is the p95 response time?
3. **Pod availability** (`ApiPodsUnavailable`): how many API pods are running?

```bash
# Quick pod health check
kubectl get pods -n revelation-srs

# Recent events
kubectl get events -n revelation-srs --sort-by='.lastTimestamp' | tail -20
```

---

## Step 2 — Correlate via OTel traces

1. Open Grafana → Explore → Tempo data source.
2. Search for recent traces with `error = true` or high duration.
3. Drill into the trace to find which service/span is failing.
4. Correlate with Loki logs: from the trace span, click the "Logs" exemplar link.

The trace propagates from API → NATS → Workers → Wellbeing via W3C TraceContext
headers. A single `traceId` links all spans end-to-end.

---

## Step 3 — Check individual service logs

```bash
# API logs (structured JSON, filtered by level)
kubectl logs -l app.kubernetes.io/name=srs-api -n revelation-srs --since=10m \
  | jq 'select(.level == "error" or .level == "fatal")'

# Worker logs
kubectl logs -l app.kubernetes.io/name=srs-worker -n revelation-srs --since=10m

# VLE adapter
kubectl logs -l app.kubernetes.io/name=srs-vle-adapter -n revelation-srs --since=10m
```

---

## Step 4 — Determine category and hand off

| Symptom | Runbook |
|---|---|
| NATS consumer lag / DLQ messages | [03 — Integration Outage](03-integration-outage.md) |
| Temporal workflow failures | [04 — Workflow Recovery](04-workflow-recovery.md) |
| Database connection errors | Check PostgreSQL connectivity; restore if data loss |
| Backup stale alert | [05 — Backup and Restore](05-backup-restore.md) |
| New deployment broken | [06 — Upgrade and Rollback](06-upgrade-rollback.md) |
| Suspected security breach | [08 — Security Incident](08-security-incident.md) |

---

## Step 5 — API /ready degraded

The `/ready` endpoint checks all dependencies. A degraded status indicates which
dependency is failing:

```bash
curl -s https://api.example.com/ready | jq '.checks'
# {
#   "database": { "status": "error", "error": "connection refused" },
#   "nats":     { "status": "ok" },
#   "temporal": { "status": "ok" },
#   "keycloakJwks": { "status": "ok" }
# }
```

| Failing check | Likely cause | Action |
|---|---|---|
| `database` | PostgreSQL down or network policy blocked | Check PG pod / managed service; check network policy |
| `nats` | NATS StatefulSet unhealthy | `kubectl get pods srs-nats-0 -n revelation-srs`; check storage |
| `temporal` | Temporal server unhealthy | `kubectl logs srs-temporal-<pod> -n revelation-srs` |
| `keycloakJwks` | Keycloak unreachable | Check Keycloak pod; check `KEYCLOAK_JWKS_URL` config |

---

## Step 6 — Declare and communicate

If the incident affects user-facing services:
1. Update status page or internal channel.
2. Assign an incident commander.
3. Create a post-incident review ticket.
4. Log all actions taken with timestamps.
