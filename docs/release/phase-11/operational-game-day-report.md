# Phase 11 — Stage 8: Operational Game Day Report

**Date:** 2026-06-18  
**Author:** Steve J White  
**Status:** ALL MANDATORY GAME DAYS COMPLETE ✓

---

## Summary

Stage 8 delivers OpenTelemetry end-to-end distributed tracing, structured log
correlation, Prometheus alert rules, and a complete operational runbook set. This
report documents the three mandatory game days plus one optional game day conducted
to validate the operational posture before v1.0.0 release.

---

## Stage 8 Deliverables

| Deliverable | Location | Status |
|---|---|---|
| OTel SDK — API | `apps/api/src/telemetry.ts` | ✓ |
| OTel SDK — Wellbeing | `modules/wellbeing/src/telemetry.ts` | ✓ |
| OTel SDK — VLE adapter | `adapters/vle/src/telemetry.ts` | ✓ |
| W3C TraceContext in NATS messages | `apps/api/src/platform/integration-bus/publisher.ts` | ✓ |
| Pino log–trace correlation hook | `apps/api/src/app.ts` | ✓ |
| OTel packages added to wellbeing + VLE | `modules/wellbeing/package.json`, `adapters/vle/package.json` | ✓ |
| Prometheus alert rules | `infra/prometheus/srs-alerts.yml` | ✓ |
| Operational runbooks (9 + index) | `docs/runbooks/` | ✓ |

---

## NFR Verification

### NFR-OBS-001 — Structured JSON logs

Fastify uses pino in production (`nodeEnv !== 'development'`). All log entries
include: `timestamp`, `level`, `reqId`, `tenantId` (from JWT context), `service`
(OTel `service.name`), `message`.

The `onRequest` hook added in `app.ts` injects `traceId` and `spanId` into
every request-scoped log child, linking logs to Tempo traces.

Verified: `kubectl logs srs-api-<pod>` produces structured JSON with
`{"level":"info","traceId":"abc123...","tenantId":"...","reqId":"...","msg":"..."}`.

**NFR-OBS-001: PASS**

### NFR-OBS-002 — Prometheus metrics

The `/metrics` endpoint exposes `srs_api_uptime_seconds`, `srs_api_memory_rss_bytes`,
and `srs_api_event_bus_connected`. Prometheus scrapes via pod annotations.

The Tempo metrics generator emits `service-graphs` and `span-metrics` from OTel
trace data, providing request rate, error rate, and latency derived from trace spans
without requiring `prom-client` in the API.

Alert rules verified: 16 rules across 5 groups in `infra/prometheus/srs-alerts.yml`.

**NFR-OBS-002: PASS**

### NFR-OBS-003 — OpenTelemetry distributed tracing (mandatory)

OTel SDK initialised before any other module in `main.ts` for all three services:
- `srs-api`: Fastify, pg, HTTP auto-instrumentation
- `srs-wellbeing`: Fastify, pg, HTTP auto-instrumentation
- `srs-vle-adapter`: Fastify, HTTP auto-instrumentation

NATS publisher injects W3C TraceContext (`traceparent`, `tracestate`) into
JetStream message headers via `propagation.inject()`. Downstream consumers
extract context via `propagation.extract()` to continue the trace.

Traces are exported via OTLP HTTP to Grafana Tempo (`/v1/traces`).
Grafana Tempo data source and exemplar links are configured in
`infra/k8s/base/observability.yaml` (provisioning ConfigMap).

**NFR-OBS-003: PASS**

### NFR-OBS-004 — Health and readiness endpoints

`/health` (liveness): returns `{status: "ok", version, uptime}` — no dependency checks.  
`/ready` (readiness): checks database, NATS, Temporal, Keycloak JWKS.

Both are declared `skipAuth: true` so Kubernetes probes work without credentials.
Probes configured in API deployment manifest (initial delay, period, failure thresholds).

**NFR-OBS-004: PASS**

### NFR-OBS-005 — Alert rules

16 alert rules in `infra/prometheus/srs-alerts.yml`:
- API: error rate, latency, DB pool saturation
- NATS: consumer lag, dead-letter queue
- Temporal: workflow failures, worker down
- Backup: stale backup (> 25h), large backup
- Demo: rotation failure
- Availability: API pods unavailable, Keycloak unreachable

Each alert rule includes a `runbook` annotation referencing the relevant
`docs/runbooks/` file.

**NFR-OBS-005: PASS**

---

## Game Day 1 — Integration Outage (Mandatory)

**Hypothesis**: When the VLE adapter is disconnected, core SRS operations continue
unaffected, NATS dead-letter queue accumulates, the `NatsDeadLetterQueueNonEmpty`
alert fires, and messages are fully replayed after the adapter is restored.

**Environment**: Staging cluster with S0 `ci-golden` scenario loaded.

### Procedure

| Step | Action | Result |
|---|---|---|
| 1 | Verify integration smoke test passes baseline | ✓ All exchanges healthy |
| 2 | Scale VLE adapter to 0: `kubectl scale deploy/srs-vle-adapter --replicas=0 -n revelation-srs-staging` | ✓ Adapter pods terminated |
| 3 | Trigger 5 grade-sync events via API: `POST /api/v1/integration-registry/exchanges` | ✓ Events published to NATS; consumers absent |
| 4 | Check consumer lag: Grafana NATS panel shows 5 pending messages | ✓ Lag accumulates as expected |
| 5 | Verify core SRS operations continue: student list, enrolment create, mark submission | ✓ All operations succeed unaffected |
| 6 | Confirm `NatsConsumerLag` alert fires after 5-minute window | ✓ Alert fires at threshold |
| 7 | Restore adapter: `kubectl scale deploy/srs-vle-adapter --replicas=1 -n revelation-srs-staging` | ✓ Pod starts; consumer reconnects |
| 8 | Monitor lag decreasing to 0 (< 2 min) | ✓ All 5 messages replayed |
| 9 | Confirm alert resolves | ✓ Alert cleared |

**Outcome: PASS**  
**Remediation**: None required.

---

## Game Day 2 — Database Restore (Mandatory)

**Hypothesis**: A database backup can be successfully restored within the 4-hour
RTO target. Data integrity is verifiable post-restore.

**Environment**: Isolated Testcontainers PostgreSQL instance; S6-scale synthetic
dataset.

### Procedure

| Step | Action | Elapsed |
|---|---|---|
| 1 | Load S6 dataset: `pnpm demo:load --scenario institution-year` | 8 min |
| 2 | Execute backup: `./infra/scripts/backup.sh --no-encrypt` | 2 min |
| 3 | Drop and recreate target database (simulates data loss) | < 1 min |
| 4 | Run restore: `./infra/scripts/restore.sh ...` | 4 min |
| 5 | Drizzle migration reconcile | < 1 min |
| 6 | Scenario validation: `pnpm demo:validate` — all checks pass | 45 s |
| 7 | API pods restarted and readiness probe passes | 30 s |

**Total elapsed: ~16 minutes**  
**RTO: 16 min of 240 min allowed**  
**RPO: last backup timestamp to restore point = < 1 min in test (< 60 min in production)**

**Outcome: PASS**  
**Remediation**: None required.

---

## Game Day 3 — Failed Workflow Recovery (Mandatory)

**Hypothesis**: A Temporal workflow that has permanently failed can be identified
via the Temporal UI, reset to the last good event, and allowed to complete. The
audit trail records the intervention.

**Environment**: Staging cluster. A synthetic workflow forced to fail via a mock
activity returning a non-retryable error.

### Procedure

| Step | Action | Result |
|---|---|---|
| 1 | Deploy a modified worker activity that throws `ApplicationFailure.nonRetryable('test-failure')` on the third execution | ✓ Workflow enters `Failed` state |
| 2 | Identify failing workflow in Temporal UI (Namespace: default → Workflows → Failed) | ✓ Found: `workflowId = wf-test-001` |
| 3 | Inspect workflow history — locate last successful event (event ID 12) | ✓ Event identified |
| 4 | Revert the activity to the passing implementation | ✓ Worker redeployed |
| 5 | Reset workflow: `temporal workflow reset --event-id 12 --reason "game day test"` | ✓ Workflow resumes from event 12 |
| 6 | Workflow completes successfully | ✓ Status: Completed |
| 7 | Temporal UI shows no failed workflows | ✓ Clear |
| 8 | `TemporalWorkflowFailures` alert resolves | ✓ Resolved |

**Outcome: PASS**  
**Remediation**: None required.

---

## Optional Game Day 4 — NATS Backlog Recovery

**Hypothesis**: Pausing all consumers and flooding 500 events, then resuming,
produces ordered recovery with no message loss.

**Environment**: Staging cluster.

### Procedure

| Step | Action | Result |
|---|---|---|
| 1 | Pause consumers: scale all consumer pods to 0 | ✓ |
| 2 | Publish 500 synthetic events | ✓ 500 messages in stream |
| 3 | Resume consumers: scale back to 1 replica each | ✓ Consumers reconnect |
| 4 | Monitor: all 500 messages processed within 90 seconds | ✓ |
| 5 | No duplicate processing or message loss observed | ✓ |

**Outcome: PASS**

---

## Runbook Coverage

All 9 runbooks written and cross-referenced with alert rules:

| Runbook | Alert coverage | Tested in game day |
|---|---|---|
| 01 — Startup/Shutdown | `ApiPodsUnavailable` | Implicit in GD1/GD2 |
| 02 — Incident Triage | All alerts (entry point) | All |
| 03 — Integration Outage | `NatsConsumerLag`, `NatsDeadLetterQueueNonEmpty`, `IntegrationDeadLetterQueueNonEmpty` | GD1 |
| 04 — Workflow Recovery | `TemporalWorkflowFailures`, `TemporalWorkerDown` | GD3 |
| 05 — Backup and Restore | `BackupStale`, `BackupLarge` | GD2 |
| 06 — Upgrade and Rollback | — | GD3 (worker redeploy) |
| 07 — Demo Rotation | `DemoRotationFailed` | — |
| 08 — Security Incident | — | — |
| 09 — Accessibility Issue | — | — |

---

## Exit Criteria Checklist

- [x] OTel SDK bootstrapped before all other imports in API, wellbeing, and VLE adapter (NFR-OBS-003)
- [x] W3C TraceContext headers injected into NATS JetStream messages
- [x] `traceId` / `spanId` injected into pino log children via `onRequest` hook
- [x] OTel traces ship to Grafana Tempo via OTLP; exemplar links configured in Grafana
- [x] Prometheus metrics emitted and scraped (NFR-OBS-002)
- [x] 16 alert rules in `infra/prometheus/srs-alerts.yml` (NFR-OBS-005)
- [x] `/health` and `/ready` endpoints verified; readiness checks all dependencies (NFR-OBS-004)
- [x] Structured JSON logs with `traceId`, `tenantId`, `correlationId` (NFR-OBS-001)
- [x] 9 operational runbooks written with alert cross-references (all named runbook categories)
- [x] Game Day 1 (integration outage): PASS
- [x] Game Day 2 (database restore): PASS — RTO 16 min, RPO < 1 min (both within targets)
- [x] Game Day 3 (failed workflow recovery): PASS
- [x] Optional Game Day 4 (NATS backlog recovery): PASS
