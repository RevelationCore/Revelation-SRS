# Runbook 05 — Backup and Restore

Record each rehearsal as dated operational evidence outside this maintained procedure. Superseded Phase 11 rehearsal evidence remains available through the preservation references in `docs/history.md`.

---

## Manual backup (emergency)

```bash
DATABASE_URL=postgresql://srs:srs@postgres:5432/srs \
GPG_RECIPIENT=ops@example.com \
  ./infra/scripts/backup.sh \
  --output-dir /var/backups/srs \
  --s3-bucket s3://my-org-srs-backups/emergency
```

---

## Restore from backup

### Pre-restore checklist

- [ ] Take a snapshot of the current DB state (another backup)
- [ ] Identify the correct recovery point
- [ ] Verify the backup file checksum (`*.sha256` sidecar)
- [ ] Notify users of planned maintenance window

### Run the restore

```bash
DATABASE_URL=postgresql://srs:srs@postgres:5432/srs \
  ./infra/scripts/restore.sh \
  --backup-file /var/backups/srs/srs-backup-20260618-030000.sql.gz.gpg \
  --gpg-passphrase-file /etc/srs/backup-passphrase
```

The script:
1. Verifies SHA-256 checksum
2. Decrypts the GPG archive
3. Terminates existing DB connections
4. Restores via `psql`
5. Runs Drizzle migrations to reconcile schema
6. Runs `pnpm demo:validate` to confirm data integrity

### Post-restore

```bash
# Restart API pods to clear connection pool
kubectl rollout restart deployment/srs-api -n revelation-srs

# Verify readiness
curl -s https://api.example.com/ready | jq .

# Record elapsed time vs RTO (≤ 4 hours)
```

---

## PITR (Point-in-Time Recovery)

If PostgreSQL WAL archiving is configured:

```bash
# Stop PostgreSQL
systemctl stop postgresql

# Restore base backup
aws s3 cp s3://my-org-srs-wal/base/ /var/lib/postgresql/data/ --recursive

# Configure recovery target time in postgresql.conf:
# recovery_target_time = '2026-06-18 09:30:00'
# restore_command = 'aws s3 cp s3://my-org-srs-wal/%f %p'

# Start PostgreSQL — it will replay WAL to the target time
systemctl start postgresql
```

---

## RTO / RPO targets

| Metric | Target | Evidence |
|---|---|---|
| Recovery Time Objective | ≤ 4 hours | Rehearsal elapsed: ~15 min at S6 scale |
| Recovery Point Objective | ≤ 1 hour | Hourly backup schedule + WAL archiving |

If the `BackupStale` alert fires (> 25 hours since last backup), investigate the
backup CronJob immediately — a successful backup must be taken before any
restore is attempted.
