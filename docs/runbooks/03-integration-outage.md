# Runbook 03 — Integration Outage

Covers: VLE adapter down, NATS consumer lag, dead-letter queue accumulation,
integration exchange failures.

---

## Scenario A — VLE adapter pod down

```bash
kubectl get pods -l app.kubernetes.io/name=srs-vle-adapter -n revelation-srs
kubectl describe pod <pod-name> -n revelation-srs
kubectl logs <pod-name> -n revelation-srs --previous
```

**Core SRS operations continue** during an adapter outage. Domain events published
to NATS will accumulate in the JetStream stream until the consumer catches up.

### Recovery

1. Identify the cause from pod logs (crash loop, OOM, config error).
2. Fix the underlying cause (e.g., update Secret, increase resource limits).
3. Restart the adapter: `kubectl rollout restart deployment/srs-vle-adapter -n revelation-srs`
4. Verify consumer lag decreases: Grafana → NATS consumer lag panel.
5. Check dead-letter queue is empty after replay.

---

## Scenario B — NATS consumer lag accumulating

Check the consumer lag in Grafana (`NatsConsumerLag` alert threshold: 1000 messages).

```bash
# NATS monitoring endpoint
kubectl port-forward svc/srs-nats 8222:8222 -n revelation-srs
curl http://localhost:8222/jsz?consumers=true | jq '.account_details[].stream_detail[].consumer_detail[] | {name, num_pending, num_redelivered}'
```

**If the consumer is stalled** (lag growing but no errors):
1. Check the consumer pod logs.
2. Restart the consumer pod if it has entered a stuck state.

**If the consumer is redelivering** (high `num_redelivered`):
1. Check for poison messages causing repeated failures.
2. Inspect the message payload: `nats sub 'srs.>' --last` (requires NATS CLI).
3. Move the problematic message to a dead-letter subject manually if needed.

---

## Scenario C — Dead-letter queue has messages (`NatsDeadLetterQueueNonEmpty`)

```bash
# List DLQ messages (requires nats CLI)
nats stream view SRS_EVENTS_DLQ --count=10
```

For each DLQ message:
1. Inspect the payload to understand why it failed.
2. Fix the underlying data or code issue.
3. Re-publish the message to the original subject, or discard if stale.

```bash
# Discard a specific message by sequence number
nats stream rmm SRS_EVENTS_DLQ <sequence>
```

---

## Scenario D — Integration exchange failures

Integration exchange records (VLE grade sync, regulatory submissions) can fail
silently. Check the admin `IntegrationOpsPage` for failed exchanges.

```bash
# Check exchange failures via API
curl -H "Authorization: Bearer <token>" \
  https://api.example.com/api/v1/integration-registry/exchanges?status=failed

# Trigger a bulk reconciliation (manual replay)
curl -X POST -H "Authorization: Bearer <token>" \
  https://api.example.com/api/v1/integration-registry/exchanges/reconcile
```

---

## Post-recovery verification

After restoring adapter connectivity:
1. Consumer lag returns to 0 within a few minutes.
2. No new DLQ messages.
3. Re-run integration validation from the demo validator: `pnpm demo:validate`.
4. Check Grafana `IntegrationDeadLetterQueueNonEmpty` alert is resolved.
