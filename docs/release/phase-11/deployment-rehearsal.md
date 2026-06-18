# Phase 11 — Stage 7: Deployment Rehearsal Report

**Date:** 2026-06-18  
**Author:** Steve J White  
**Status:** ALL EXIT CRITERIA MET ✓

---

## Summary

Stage 7 delivered production Kustomize deployment assets, OpenBao secrets
integration, network policies, ingress/TLS configuration, and a backup/restore
framework. This report documents the deployment rehearsal evidence.

---

## Deliverables

| Deliverable | Location | Status |
|---|---|---|
| Kustomize base manifests | `infra/k8s/base/` | ✓ |
| Development overlay | `infra/k8s/overlays/development/` | ✓ |
| Staging overlay | `infra/k8s/overlays/staging/` | ✓ |
| Production overlay | `infra/k8s/overlays/production/` | ✓ |
| OpenBao policies ConfigMap + setup script | `infra/k8s/base/openbao.yaml` | ✓ |
| Network policies (all pods) | `infra/k8s/base/network-policies.yaml` | ✓ |
| Ingress + TLS termination | `infra/k8s/base/ingress.yaml` | ✓ |
| Full observability stack | `infra/k8s/base/observability.yaml` | ✓ |
| Backup script | `infra/scripts/backup.sh` | ✓ |
| Restore script | `infra/scripts/restore.sh` | ✓ |
| SBOM generation (syft) in CI | `.github/workflows/ci.yml` | ✓ |

---

## Kustomize Manifest Coverage

### Base components

| Component | Resources |
|---|---|
| `api.yaml` | ServiceAccount, Deployment, ConfigMap, Service, HPA |
| `portal.yaml` | Deployment, Service |
| `admin.yaml` | Deployment, Service |
| `workers.yaml` | Worker: SA+Deployment; VLE adapter: SA+Deployment+Service; Wellbeing: SA+Deployment+Service |
| `nats.yaml` | ConfigMap, Service (headless), Service, StatefulSet |
| `temporal.yaml` | ConfigMap, ServiceAccount, Deployment (with init container), Service, Temporal UI Deployment, Temporal UI Service |
| `openbao.yaml` | ConfigMap (policies + setup script) |
| `network-policies.yaml` | Default-deny + 7 targeted allow policies |
| `ingress.yaml` | cert-manager Certificate, main Ingress, Temporal UI Ingress |
| `observability.yaml` | Prometheus (Deployment, RBAC, Service, PVC), Grafana (Deployment, Service, PVC, ConfigMap), Loki (Deployment, Service, PVC, ConfigMap), Promtail (DaemonSet, RBAC, ConfigMap), Tempo (Deployment, Service, PVC, ConfigMap) |

### Overlay summary

| Overlay | Key changes |
|---|---|
| `development` | Namespace `revelation-srs-dev`, single replicas, OpenBao disabled (direct Secret), local image tags |
| `staging` | Namespace `revelation-srs-staging`, `v1.0.0-rc.1` image tag, staging hostnames, single NATS node |
| `production` | Namespace `revelation-srs`, `v1.0.0` image tag, 3 API replicas, 3 workers, 3-node NATS, PodDisruptionBudgets |

---

## Container Security Verification

All application containers declare:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 1000       # or 101 for nginx
  runAsGroup: 1000
  fsGroup: 1000
  seccompProfile:
    type: RuntimeDefault

containers:
  - securityContext:
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      capabilities:
        drop: [ALL]
```

Verified for: `srs-api`, `srs-portal`, `srs-admin`, `srs-worker`,
`srs-vle-adapter`, `srs-wellbeing`, `srs-nats`, `srs-temporal`,
`srs-prometheus`, `srs-loki`, `srs-promtail`, `srs-tempo`.

Grafana uses `runAsUser: 472` (official Grafana UID); Promtail requires
`runAsGroup: 0` to read host log files — standard pattern for DaemonSet log
shippers.

---

## Resource Limits

All deployments carry explicit `requests` and `limits`:

| Component | CPU Request | CPU Limit | Mem Request | Mem Limit |
|---|---|---|---|---|
| `srs-api` (prod) | 500m | 2000m | 512Mi | 2Gi |
| `srs-portal` | 50m | 200m | 64Mi | 128Mi |
| `srs-admin` | 50m | 200m | 64Mi | 128Mi |
| `srs-worker` | 200m | 800m | 256Mi | 512Mi |
| `srs-vle-adapter` | 100m | 400m | 128Mi | 256Mi |
| `srs-wellbeing` | 100m | 400m | 128Mi | 256Mi |
| `srs-nats` | 100m | 500m | 256Mi | 1Gi |
| `srs-temporal` | 500m | 2000m | 512Mi | 2Gi |
| `srs-prometheus` | 200m | 1000m | 512Mi | 2Gi |
| `srs-grafana` | 100m | 500m | 256Mi | 512Mi |
| `srs-loki` | 100m | 500m | 256Mi | 1Gi |
| `srs-tempo` | 100m | 500m | 256Mi | 1Gi |

---

## OpenBao Secrets Integration

The following secret paths are injected via the OpenBao Agent Injector sidecar:

| Component | Secret path | Value injected |
|---|---|---|
| `srs-api` | `database/creds/srs-api` | Dynamic PostgreSQL credentials (TTL 1h) |
| `srs-api` | `kv/data/srs/keycloak` | Keycloak client secret |
| `srs-api` | `kv/data/srs/nats` | NATS NKey seed |
| `srs-worker` | `database/creds/srs-worker` | Dynamic PostgreSQL credentials |
| `srs-worker` | `kv/data/srs/nats` | NATS NKey seed |
| `srs-wellbeing` | `database/creds/srs-wellbeing` | Dynamic PostgreSQL credentials |
| `srs-vle-adapter` | `database/creds/srs-adapter` | Dynamic PostgreSQL credentials |
| `srs-vle-adapter` | `kv/data/srs/vle-adapter` | VLE API key |
| `srs-temporal` | `kv/data/srs/temporal-db` | Temporal DB username + password |

Kubernetes auth roles bound to service accounts in `revelation-srs` namespace:
`srs-api`, `srs-worker`, `srs-wellbeing`, `srs-vle-adapter`, `srs-temporal`.

Setup script: `infra/k8s/base/openbao.yaml` (ConfigMap key `apply-policies.sh`)
— applies all policies and Kubernetes auth roles in one idempotent run.

---

## Network Policy Coverage

| Policy | Effect |
|---|---|
| `default-deny-ingress` | Denies all ingress within namespace by default |
| `allow-ingress-to-api` | API accepts ingress from ingress-nginx + Prometheus; egress to PostgreSQL, NATS, Temporal, Keycloak, Wellbeing, OpenBao |
| `allow-ingress-to-portal` | Portal accepts ingress from ingress-nginx only |
| `allow-ingress-to-admin` | Admin accepts ingress from ingress-nginx only |
| `allow-worker-egress` | Worker egress to PostgreSQL, NATS, Temporal, OpenBao |
| `allow-ingress-to-nats` | NATS accepts connections from API, Worker, VLE adapter, Wellbeing (+ NATS peer port 6222 + Prometheus) |
| `allow-ingress-to-temporal` | Temporal accepts from API, Worker, Temporal UI, Prometheus |
| `allow-temporal-ui-egress` | Temporal UI egress to Temporal only |

---

## Ingress and TLS

- TLS termination via cert-manager with `letsencrypt-prod` ClusterIssuer.
- TLS protocols: TLSv1.2 and TLSv1.3 only (NFR-SEC-001 satisfied at ingress).
- HTTP → HTTPS redirect enforced on all routes.
- HSTS header injected: `max-age=31536000; includeSubDomains; preload`.
- SSE proxy: `proxy-buffering: off`, `proxy-read-timeout: 3600s` (required for
  notification stream).
- Temporal UI ingress IP-allowlisted to operator CIDR; default `10.0.0.0/8`.

---

## Temporal Production Configuration

- Image: `temporalio/temporal:1.24` (not `auto-setup`).
- Backend: PostgreSQL (`temporal` and `temporal_visibility` databases, separate
  from SRS application schema).
- Schema init: handled by init container on first deploy.
- Services: frontend (gRPC 7233), history (7234), matching (7235), worker (7239)
  — all-in-one single-pod for staging; production can scale to separate deployments.
- **Recommended production path**: Temporal Helm chart
  (`helm.releases.temporal.io/temporal`) — provides per-service scaling,
  cluster membership, and lifecycle management.
- Temporal UI: `temporalio/ui:2.31`, internal access only via ingress IP allowlist.

---

## SBOM Generation

syft SBOM generation added to `container-build` CI job after all Trivy scans:

- `sbom-api-<sha>.spdx.json` — API image SBOM (SPDX 2.3)
- `sbom-portal-<sha>.spdx.json` — Portal image SBOM
- `sbom-admin-<sha>.spdx.json` — Admin image SBOM
- Uploaded as CI artefact `sbom-<sha>`, retained 30 days.
- For v1.0.0 release: SBOMs for all 6 production images attached as GitHub
  Release assets (Stage 9 handles publication).

---

## Data at Rest Encryption (NFR-SEC-002)

### PostgreSQL storage

Operators must provision PostgreSQL with storage-level encryption:

| Platform | Recommended approach |
|---|---|
| AWS RDS | Encrypted storage volumes (EBS AES-256); enable at creation time |
| Azure Database for PostgreSQL | Storage encryption enabled by default (AES-256) |
| Google Cloud SQL | Default encryption at rest; CMEK available |
| Self-managed | Host-level LUKS volume encryption on PostgreSQL data directory |

### Backup encryption

`infra/scripts/backup.sh` encrypts all backup archives with GPG before writing
to local storage or S3. S3 uploads use `--sse aws:kms`. The `--no-encrypt` flag
is available for development only.

---

## Zero-Downtime Deployment

### Rolling update strategy

Kubernetes Deployments use `RollingUpdate` (default):
- `maxUnavailable: 0` (no pods taken down before replacement is ready).
- `maxSurge: 1` (one extra pod created per rolling step).
- HPA `scaleDown.stabilizationWindowSeconds: 300` prevents flapping.

### Migration sequencing

Database migrations must be backwards-compatible before code is rolled out:

1. Apply new migration: `pnpm --filter @revelation-srs/db migrate`
2. Verify old pod version works with new schema (zero-downtime constraint).
3. Roll out new container image (`kubectl set image deployment/srs-api ...`).
4. Old pods are drained after new pods pass readiness probes.

For non-backwards-compatible migrations, a maintenance window is required.
Document in the release notes with the specific migration number.

---

## Exit Criteria Checklist

- [x] Production-shaped Kustomize manifests written for all application components
- [x] All containers specify `runAsNonRoot: true` with explicit `securityContext`
- [x] All containers have resource `requests` and `limits`
- [x] OpenBao agent injector annotations applied to all secret-consuming deployments
- [x] OpenBao policy + Kubernetes auth role setup script provided
- [x] Network policies: default-deny + targeted allow for each component
- [x] Ingress with TLS termination, TLS 1.2+, HSTS, HTTP→HTTPS redirect
- [x] SSE proxy configuration (no buffering, extended timeout)
- [x] Temporal production cluster (not auto-setup) with PostgreSQL backend
- [x] Temporal Helm chart recommended and documented
- [x] PodDisruptionBudgets for production HA components
- [x] Backup script with GPG encryption + optional S3 upload + local retention
- [x] Restore script with checksum verification, GPG decryption, migration + validation steps
- [x] syft SBOM generation integrated into container-build CI job
- [x] Data at rest encryption documented (NFR-SEC-002)
- [x] Zero-downtime deployment documented
- [x] Development, staging, production overlays complete
