# Runbook 06 — Upgrade and Rollback

---

## Pre-upgrade checklist

- [ ] Read `CHANGELOG.md` for breaking changes or migration requirements
- [ ] Check if the new release includes backwards-incompatible migrations (see below)
- [ ] Take a fresh backup: `./infra/scripts/backup.sh`
- [ ] Verify staging deployment passes all acceptance tests
- [ ] Notify users if a maintenance window is required

---

## Deployment procedure

### 1. Apply migrations first

Database migrations must be backwards-compatible so the old pods can still run
against the new schema during the rolling update window.

```bash
# Run migration against production database
DATABASE_URL=postgresql://... pnpm --filter @revelation-srs/db migrate
```

Verify all migrations applied:
```bash
psql $DATABASE_URL -c "SELECT id, name FROM drizzle_migrations ORDER BY created_at DESC LIMIT 5;"
```

### 2. Deploy new images

Update the image tag in the production overlay and apply:

```bash
# Update infra/k8s/overlays/production/kustomization.yaml: images[].newTag = v1.0.1
kubectl apply -k infra/k8s/overlays/production/
```

Watch rollout:
```bash
kubectl rollout status deployment/srs-api -n revelation-srs
kubectl rollout status deployment/srs-worker -n revelation-srs
```

### 3. Post-deploy verification

```bash
# API health and readiness
curl -s https://api.example.com/ready | jq .

# Version check
curl -s https://api.example.com/health | jq .version

# Run golden E2E smoke test
pnpm test:e2e:playwright:golden
```

---

## Rollback procedure

### Rollback to previous image

```bash
# Revert the image tag in kustomization.yaml to previous version, then:
kubectl apply -k infra/k8s/overlays/production/

# Or use kubectl rollout undo (reverts to previous ReplicaSet):
kubectl rollout undo deployment/srs-api -n revelation-srs
kubectl rollout undo deployment/srs-worker -n revelation-srs
```

### Rollback migrations

Backwards-incompatible migration rollback requires a database restore:

1. Restore from the pre-upgrade backup (`infra/scripts/restore.sh`).
2. Deploy the old image version.
3. Verify all checks pass.

**Always prefer backwards-compatible migrations** to avoid needing DB rollback.

---

## Sequence for non-backwards-compatible migration

1. Deploy a maintenance page / announce downtime.
2. Scale down API: `kubectl scale deployment/srs-api --replicas=0 -n revelation-srs`
3. Take a backup.
4. Apply migration: `pnpm --filter @revelation-srs/db migrate`
5. Deploy new image.
6. Verify readiness.
7. Scale up API to full replicas.
