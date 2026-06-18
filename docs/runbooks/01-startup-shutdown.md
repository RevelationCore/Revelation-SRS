# Runbook 01 — Startup and Shutdown

## Controlled startup

### Prerequisites
- OpenBao is running and unsealed
- PostgreSQL is accessible from the cluster
- NATS JetStream is running
- Temporal server is running
- Keycloak is running and the `srs` realm is imported

### Apply latest manifests

```bash
kubectl apply -k infra/k8s/overlays/production/
```

Watch rollout:
```bash
kubectl rollout status deployment/srs-api -n revelation-srs
kubectl rollout status deployment/srs-portal -n revelation-srs
kubectl rollout status deployment/srs-admin -n revelation-srs
```

### Verify health

```bash
# API liveness
curl -s https://api.example.com/health | jq .

# API readiness (checks DB, NATS, Temporal, Keycloak)
curl -s https://api.example.com/ready | jq .

# Expected:
# { "status": "ok", "checks": { "database": {"status":"ok"}, "nats": {...}, ... } }
```

If any check returns `"status": "error"`, see the appropriate dependency runbook.

---

## Rolling restart (zero-downtime)

Used after a config change that doesn't require a new image (e.g., a ConfigMap update):

```bash
kubectl rollout restart deployment/srs-api -n revelation-srs
kubectl rollout restart deployment/srs-worker -n revelation-srs
```

Watch pods drain and restart:
```bash
kubectl get pods -n revelation-srs -w
```

---

## Graceful shutdown

### Drain a single pod

```bash
kubectl drain <node-name> --ignore-daemonsets --delete-emptydir-data
# or for a single pod:
kubectl delete pod <pod-name> -n revelation-srs --grace-period=60
```

The API listens for `SIGTERM` and calls `fastify.close()` + `eventBus.close()`.
Workers drain Temporal pollers before exiting (`terminationGracePeriodSeconds: 120`).

### Full stack shutdown

```bash
kubectl scale deployment srs-api srs-worker srs-vle-adapter srs-wellbeing \
  --replicas=0 -n revelation-srs
```

Scale back up:
```bash
kubectl apply -k infra/k8s/overlays/production/
```

---

## Post-startup smoke test

```bash
# Check API returns 200 for a public route
curl -s -o /dev/null -w "%{http_code}" https://api.example.com/health

# Portal returns HTML
curl -s -o /dev/null -w "%{http_code}" https://portal.example.com/

# Admin returns HTML
curl -s -o /dev/null -w "%{http_code}" https://admin.example.com/
```
