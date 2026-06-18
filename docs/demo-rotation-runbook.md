# Demo Rotation Runbook

Operational guide for the Revelation SRS hosted demo environment: scenario loading, rotation, recovery, and operational controls.

---

## Environment variables

All variables must be set in the container/environment that runs the demo CLI or API server.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string for the demo database |
| `DEMO_DATA_ENABLED` | Yes | — | Must be `true` to unlock the reset CLI |
| `DEMO_RESET_ALLOWED` | Yes | — | Must be `true` for destructive resets in hosted environments |
| `DEMO_DB_ALLOWLIST` | Recommended | — | Comma-separated permitted database host patterns (e.g. `demo-db.internal,*.demo.svc`) |
| `KEYCLOAK_ADMIN_URL` | Hosted only | — | Keycloak Admin REST API base URL for persona provisioning |
| `KEYCLOAK_ADMIN_CLIENT_ID` | Hosted only | — | Service-account client ID for persona provisioning |
| `KEYCLOAK_ADMIN_CLIENT_SECRET` | Hosted only | — | Service-account secret for persona provisioning |
| `DEMO_ROTATION_CRON` | No | `0 3 * * *` | Cron expression for the daily scenario rotation (3 AM UTC) |
| `DEMO_S6_ROTATION_CRON` | No | `0 1 * * 0` | Cron expression for the weekly S6 full-institution load (Sunday 1 AM UTC) |
| `DEMO_ROTATION_PAUSED` | No | — | Set to `true` to suspend automatic rotation without removing the current scenario |
| `DEMO_FORCE_SCENARIO` | No | — | Slug of a specific scenario to load on the next rotation, overriding the computed schedule |

Frontend build variables (set at Vite build time, not at runtime):

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `VITE_DEMO_MODE` | Demo builds only | — | Set to `true` to enable the demo banner in `apps/admin` and `apps/portal` |
| `VITE_API_BASE_URL` | No | `http://localhost:3000` | API base URL used by the demo banner to call `GET /api/v1/demo/status` |

---

## Scheduled rotation

The demo environment uses two cron jobs:

### Daily rotation (`DEMO_ROTATION_CRON`, default `0 3 * * *`)

Cycles through standard-demo scenarios in a fixed order determined by UTC epoch-day number:

```
curriculum-baseline → applicant-pipeline → enrolment-induction →
module-selection → assessment-marks → exam-board → (repeat)
```

Run manually:
```sh
pnpm demo:rotate daily --tenant-id <uuid>
# or by tenant code:
pnpm demo:rotate daily --tenant-code DEMODEMO
```

### Weekly rotation (`DEMO_S6_ROTATION_CRON`, default `0 1 * * 0`)

Loads the full-institution S6 scenario (`institution-year`, 50,000 students) every Sunday.

Run manually:
```sh
pnpm demo:rotate weekly --tenant-id <uuid>
```

---

## Operational controls

### Pause rotation

Prevents automatic rotation from starting a new load. The current scenario remains in place.

```sh
export DEMO_ROTATION_PAUSED=true
```

To resume, unset the variable or set it to anything other than `true`.

### Force a specific scenario

Override the computed rotation schedule on the next run:

```sh
# Via environment variable (persists across multiple runs until unset):
export DEMO_FORCE_SCENARIO=exam-board

# Via CLI flag (applies only to this invocation):
pnpm demo:rotate daily --tenant-code DEMODEMO --force-scenario exam-board
```

### Dry run

Print what would happen without touching the database:

```sh
pnpm demo:rotate daily --tenant-code DEMODEMO --dry-run
```

### Check current scenario status

```sh
DATABASE_URL=... pnpm demo:status
```

---

## Local reset

To load a specific scenario in a local development environment:

```sh
DEMO_DATA_ENABLED=true DEMO_RESET_ALLOWED=true \
  DATABASE_URL=postgres://... \
  pnpm demo:reset --scenario exam-board --tenant-code DEMODEMO
```

To list all registered scenarios:

```sh
pnpm demo:list
```

---

## Failed-load recovery

If a scenario load is interrupted mid-way (container restart, OOM, etc.), the load infrastructure uses phase-level checkpoints stored in `demo_load_checkpoints`. On the next run, loading resumes from the last successfully committed phase — no data is lost and a full reload is not required.

If checkpoints are stale or inconsistent, clear them and restart from scratch:

```sql
-- Connect to the demo database and run:
DELETE FROM demo_load_checkpoints WHERE tenant_id = '<uuid>';
```

Then re-run the rotation or reset command. The advisory lock (`pg_advisory_lock`) ensures only one load runs at a time; if the lock is held by a dead connection, PostgreSQL releases it automatically when the session ends.

To verify a scenario loaded correctly after recovery:

```sh
DATABASE_URL=... pnpm demo:validate --scenario <slug> --tenant-id <uuid>
```

---

## Adding a new scenario to the daily rotation

1. Implement the scenario in `packages/demo-data/src/scenarios/<slug>.ts`.
2. Register it in `packages/demo-data/src/manifest.ts` and `packages/demo-data/src/reset.ts`.
3. Add its slug to `DAILY_SLUGS` in `packages/demo-data/src/rotation.ts` (or set it as `WEEKLY_SLUG` for performance scenarios).
4. Run `pnpm demo:check-versions` to confirm the new scenario is compatible with the current database schema.
5. Update this runbook.

---

## Schema version bump

When a database migration changes a table that demo scenarios write to:

1. Run `pnpm demo:check-versions` — this will report which scenarios are now incompatible.
2. Update the `schemaVersion` field in each affected scenario's manifest to the new migration number (e.g. `'0024'`).
3. Re-run `pnpm demo:check-versions` to confirm all scenarios pass.
4. In CI, `pnpm demo:check-versions` is part of the standard integration pipeline.
