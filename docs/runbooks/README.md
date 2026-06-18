# Revelation SRS — Operational Runbooks

> Version: 1.0.0 (Phase 11 Stage 8)

This directory contains operational runbooks for Revelation SRS platform operators
and on-call engineers.

## Index

| Runbook | When to use |
|---|---|
| [01 — Startup and Shutdown](01-startup-shutdown.md) | Controlled startup, graceful shutdown, rolling restart |
| [02 — Incident Triage](02-incident-triage.md) | Any production alert; starting point for all incidents |
| [03 — Integration Outage](03-integration-outage.md) | VLE adapter down; NATS dead-letter queue accumulating; integration exchange failures |
| [04 — Workflow Recovery](04-workflow-recovery.md) | Temporal workflow stuck, failed, or paused; worker pod down |
| [05 — Backup and Restore](05-backup-restore.md) | Data loss scenario; point-in-time recovery; rehearsal |
| [06 — Upgrade and Rollback](06-upgrade-rollback.md) | Deploying a new release; rolling back a failed deployment |
| [07 — Demo Rotation](07-demo-rotation.md) | Demo data refresh; demo environment validation failures |
| [08 — Security Incident](08-security-incident.md) | Suspected breach, unusual access patterns, CVE in deployed image |
| [09 — Accessibility Issue](09-accessibility-issue.md) | Accessibility complaint or regression; WCAG failure reported |

## Shared reference

- Architecture overview: `docs/architecture/`
- Observability stack: Grafana at `https://grafana.example.com`
- Trace explorer: Grafana Tempo data source
- Alert manager: Prometheus alert rules at `infra/prometheus/srs-alerts.yml`
- Backup scripts: `infra/scripts/backup.sh`, `infra/scripts/restore.sh`
- Deployment: `infra/k8s/overlays/production/`

## Escalation path

1. On-call engineer (PagerDuty / equivalent)
2. Platform team lead
3. Security lead (for NFR-SEC issues)
4. Data Protection Officer (for privacy breaches involving personal data)
