# Runbook 07 — Demo Rotation

See also: `docs/demo-rotation-runbook.md` for the full data-loading procedure.

---

## Scheduled rotation

Demo data rotates on a schedule (typically weekly) via:

```bash
pnpm demo:reset --scenario ci-golden
```

Or the full institution-year scenario for capacity demonstrations:

```bash
pnpm demo:reset --scenario institution-year
```

---

## `DemoRotationFailed` alert

The `DemoRotationFailed` Prometheus alert fires when no successful rotation
has been recorded for > 48 hours.

### Triage steps

```bash
# Check demo status endpoint
curl -s https://api.example.com/api/v1/demo/status | jq .

# Check last rotation log
kubectl logs -l app.kubernetes.io/name=srs-api -n revelation-srs --since=48h \
  | grep demo | tail -20
```

### Manual rotation

```bash
# Reset to ci-golden scenario
DATABASE_URL=postgresql://... pnpm demo:reset --scenario ci-golden

# Validate the scenario loaded correctly
DATABASE_URL=postgresql://... pnpm demo:validate

# Update the Prometheus metric
curl -X POST https://pushgateway.example.com/metrics/job/srs-demo \
  -d "srs_demo_rotation_last_success_timestamp_seconds $(date +%s)"
```

---

## Demo validation failures

If `pnpm demo:validate` fails:

1. Check which scenario checks are failing:
   ```bash
   DATABASE_URL=postgresql://... pnpm demo:validate --verbose
   ```
2. If story markers are missing: the rotation may have failed partway through.
   Re-run `pnpm demo:reset --scenario ci-golden`.
3. If counts are off: check the load phase that failed and re-run from that phase.

---

## Demo banner

The demo banner is automatically shown when `NODE_ENV=demo` or when the
`/api/v1/demo/status` response indicates a demo tenantId. To suppress the
banner in a non-demo environment, ensure `NODE_ENV=production`.
