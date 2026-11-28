# ADR-027: Shared Runtime State in PostgreSQL

**Status**: Accepted
**Date**: 2026-11-20
**Follows**: [ADR-003](ADR-003-database-and-orm.md) (PostgreSQL), [ADR-004](ADR-004-message-broker.md) (NATS JetStream for domain events), [ADR-012](ADR-012-architectural-style.md)
**Backlog**: BL-032 (this decision); enterprise readiness items 2.2, 2.5, 3.5, 3.6 and 3.7, and findings SCL-1 to SCL-4, SEC-6 and AVL-1 in the [enterprise readiness audit](../product/enterprise-readiness-audit.md)

## Context

The API runs at least two pods, and the worker runs two (`infra/k8s/base/workers.yaml`). Four functions hold state that must be shared, and each holds it per process:

| Function | Today | Defect |
|---|---|---|
| **Cache invalidation (SCL-2)** | `ValueSetService` (`apps/api/src/platform/value-sets/service.ts`, 10-minute TTL) and `RulesEngine` (`apps/api/src/platform/rules-engine/engine.ts`, 5-minute TTL) each cache in a `Map`. A change clears only the local pod's entries (for example `fastify.rules.invalidateTenant` in `routes/tenant-admin.ts`) | Other pods serve the old value set or academic rule until the TTL runs out |
| **Live notifications (SCL-1)** | `NotificationService` (`apps/api/src/platform/notifications/notification-service.ts`) keeps SSE connections in a `Map` and pushes only to connections on the pod that called `deliver()` | Users connected to other pods miss live notifications |
| **Rate limiting (SEC-6)** | `@fastify/rate-limit` is registered in `apps/api/src/app.ts` before the JWT plugin (`preValidation`), with the default in-memory store and `keyGenerator: req.tenantId ?? req.ip` | `tenantId` is never set at that point, so every caller is counted by IP, per pod. The API also sets no `trustProxy`, so behind the ingress `req.ip` is the ingress controller's address, and the public verification limit (`routes/public-verification.ts`, 30 a minute) is one budget shared by everyone |
| **Scheduled jobs (SCL-3, SCL-4)** | The worker (`apps/api/src/worker.ts`) runs the reconcile loop on a `setInterval` in every replica. The loop covers workflow reconciliation, adjustment dispatch, exam withdrawals, overdue task digests, delivery drain and right-to-study scans. `WorkflowEscalationService.sweepOverdueTasks` runs only when called through a route | Duplicate work. The overdue digest (`adjustments/task-notices.ts`) reads, sends, then marks, so two replicas can both send it. The escalation sweep never runs on a schedule |

Some of these mechanisms are already in the code:
- the delivery drain, adjustment dispatcher and workflow outbox claim rows with `FOR UPDATE SKIP LOCKED`;
- the exam board data pack uses `pg_advisory_xact_lock`.

Readiness item 2.2 wants `/ready` to depend only on the database (`routes/health.ts` today also fails on NATS). Readiness item 2.1 moves domain events to a transactional outbox, because publishing after a commit loses events (AVL-2).

## Decision

PostgreSQL holds all four. No Redis or Valkey is added, and NATS is not used for any of them.

1. **Cache invalidation: `NOTIFY` in the writing transaction.**
   - **Send.** Every change to a cached source runs `SELECT pg_notify('srs_cache', $payload)` in the same transaction as the change, through one helper, `notifyCacheInvalidation(tx, { cache: 'value-set' | 'rules', tenantId, setCode? })`. Postgres delivers notifications only on commit, so a rolled-back change sends nothing and a committed one always sends.
   - **Listen.** Each API and worker process opens one listener with postgres.js `sql.listen`, which keeps a dedicated connection and reconnects with backoff.
     - The listener uses `DATABASE_LISTEN_URL`, which defaults to `DATABASE_URL`. It must be a direct session connection, because `LISTEN` does not work through a transaction-mode pooler.
     - On notification, the process clears the matching keys.
   - **Reconnect.** The `onlisten` callback runs on connect and on every reconnect, and clears the whole cache, because notifications sent while disconnected are lost.
   - **While the listener is down,** the caches are bypassed and reads go to the database. A pod may be slower, but never stale.
   - **The TTLs stay** as a backstop.
2. **Live notifications: `NOTIFY` with identifiers only.**
   - **Send.** `deliver()` inserts the notification and runs `pg_notify('srs_notification', {tenantId, personId, notificationId})` in the same transaction. A bulk path sends one notification per batch of up to 100 identifiers, within Postgres's 8,000-byte payload limit.
   - **Payload.** It never carries the title or body. Any database role can `LISTEN` on any channel, and content in a payload would bypass row-level security.
   - **Receive.** Each pod looks up the person in its own connection map. Only if it holds a connection for them does it read the row under `withTenantContext` and push it.
   - **Delivery semantics.** Live delivery is at most once. The `notification` table is the record: clients reload the list when they connect or reconnect.
   - **Reconnect.** When the listener reconnects, each pod sends `event: resync` on its open streams so clients reload.
3. **Rate limiting: an unlogged counter table, keyed by user after authentication.**
   - **Store.** A custom `@fastify/rate-limit` store over `UNLOGGED TABLE rate_limit_counter (key text, window_start timestamptz, hits int, PRIMARY KEY (key, window_start))`, with a 60-second fixed window. Each check is one `INSERT … ON CONFLICT … DO UPDATE SET hits = hits + 1 RETURNING hits`.
     - The table has no `tenant_id`. Keys carry the tenant.
     - Unlogged means no WAL: counts reset after a crash or failover, which is acceptable for an abuse control.
   - **Hook.** The limiter runs on `preHandler`, after the JWT and tenant hooks, and keys by `u:<tenantId>:<sub>`.
   - **Budgets**, each configurable by environment variable:
     - 1,200 requests a minute per user;
     - 300 non-safe requests (`POST`, `PUT`, `PATCH`, `DELETE`) a minute per user, counted separately;
     - 30 a minute per IP on `/public/v1` (unchanged).
   - **Before authentication.** Requests refused before authentication never reach the limiter. They are bounded at the ingress by a per-IP request rate on each host (ingress-nginx `limit-rps`, default 50 with burst 250, sized for a campus behind one NAT).
   - **Client address.** The API sets `trustProxy` to the ingress network, so that `req.ip` is the client.
   - **If the store errors,** the limiter lets the request through (`skipOnError`), increments `rate_limit_store_errors_total` and logs. An alert fires on any sustained rate. The worker's clean-up job deletes windows older than five minutes.
4. **Scheduled jobs: one advisory lock per job, with row claims for correctness.**
   - **Lock.** Each scheduled job runs in the worker inside `pg_try_advisory_lock(<namespace>, <job id>)`, taken on a reserved connection (`sql.reserve()`) and released in `finally`.
     - Job ids live in one registry module.
     - If the lock is not acquired, the run is skipped and `job_skipped_locked_total` is incremented.
     - If the pod dies, its connection closes and Postgres releases the lock.
   - **Jobs:**
     - each step of today's reconcile loop;
     - the escalation sweep (`sweepOverdueTasks`, per tenant; SCL-4);
     - rate-limit and BFF-session clean-up ([ADR-026](ADR-026-browser-sessions-through-a-backend-for-frontend.md)).
   - **The lock saves work; it does not guarantee correctness.** A lock is lost silently if its connection drops while the job's other connections carry on. So every job claims its rows before acting, with `FOR UPDATE SKIP LOCKED` or a conditional `UPDATE … RETURNING`.
     - The overdue digest becomes "claim, then send": `UPDATE … SET overdue_notice_sent_at = now WHERE … AND (overdue_notice_sent_at IS NULL OR overdue_notice_sent_at < <start of day>) RETURNING`, then dispatch.
   - **Scheduling.** Jobs run on the worker's timer, not as Kubernetes CronJobs (a departure from readiness item 2.5's wording). One mechanism then works the same in compose, in tests and in Kubernetes, and needs no extra manifest or image per job.
5. **NATS stays for domain events,** through the outbox of readiness item 2.1. None of these four functions depends on it.
6. **Readiness.**
   - `/ready` checks the database (and the cached JWKS check) only.
   - The listener's state is reported on `/health/details` and in the gauge `pg_listener_connected`, with an alert. It does not gate readiness, because a pod with a lost listener still answers correctly.

What happens when a dependency is down:

| Down | Cache | Notifications | Rate limit | Jobs |
|---|---|---|---|---|
| PostgreSQL | API unready (it cannot serve without the database) | — | — | Jobs fail and retry next tick |
| Listener connection only | Bypassed; correct but slower | Live push paused; clients resync on reconnect | Unaffected | Unaffected |
| NATS | Unaffected | Unaffected | Unaffected | Unaffected (outbox relay backs off) |

## Rationale

- **Fewer moving parts.** Postgres is already the one hard dependency, it is highly available, and it is already used for row claims and advisory locks. Redis or Valkey would add a stateful component, with its own HA, backups, secrets, network policy and upgrades, to solve problems that are not yet measured.
- **Transactional by construction.** `NOTIFY` is sent on commit, so invalidation and fan-out cannot drift from the data. Publishing to NATS after the commit would repeat the dual-write fault that readiness item 2.1 removes.
- **Availability.** Using NATS would make request-path behaviour depend on the broker, against readiness item 2.2. With Postgres, the failure modes all collapse onto the database, which the API cannot do without anyway.
- **Load is small.** Peak load for a 50,000-student institution (core principle 20) is in the low hundreds of requests a second: a few hundred single-row upserts a second for the limiter, well within one Postgres primary. Readiness item 3.3's load test checks this.
- **Cheap to reverse.** The limiter store sits behind `@fastify/rate-limit`'s store interface, and the listener behind one module. Moving either to Valkey later changes one file.

## Options considered

| Option | Verdict |
|---|---|
| Do nothing; run one API pod | Rejected. It gives up availability; the manifests already run two pods |
| Redis or Valkey for all four | Rejected now. It adds a component; invalidation sent after commit is non-transactional; and it is not needed at this scale |
| NATS core subjects (fan-out, invalidation) and JetStream KV (limits, leases) | Rejected. It puts NATS on the request path and in readiness, and makes every message a dual write after commit |
| Temporal Schedules for jobs | Deferred. Live Temporal execution is still behind a rollout flag (ADR-024); revisit when it is on by default |
| Kubernetes CronJobs for jobs | Rejected. Jobs would behave differently in compose and tests, with a manifest per job; the lock is still needed for overlapping runs |
| **PostgreSQL: `LISTEN/NOTIFY`, unlogged counter, advisory locks with row claims** | **Chosen** |

**Revisit trigger.** Move only the rate-limit store to Valkey if the readiness 3.3 load test shows either of these:
- limiter statements above 15% of database write statements;
- the limiter adding more than 2 ms at p95.

## Consequences

- **Each process holds one more database connection,** the listener: one per API and worker pod, four in the base manifests.
- **Any pooler in front of Postgres** (PgBouncer is mentioned in ADR-014) must give the listener a session-mode or direct route.
- **Live notifications are best-effort,** and the persisted list is authoritative. This is already how the portal behaves on reload.
- **The worker's reconcile loop becomes a scheduler of separately locked jobs,** so a slow job no longer delays the others' lock checks.
- **New migration:** the unlogged counter table, with grants to `srs_app`. No RLS, because it holds no tenant rows and has no `tenant_id`.

## Guard

- **Two-instance test harness** (pattern P-11): two `buildApp` instances on one test database, with these tests:
  - a value-set change on A is served by B on the next request;
  - a rule change on A is applied by B at once;
  - a notification delivered on A reaches an SSE client on B;
  - limits count across both instances;
  - two concurrent schedulers run each job once;
  - two concurrent overdue-digest runs send one digest.
- **Listener-loss test:** kill the listener connection; the cache is bypassed until it reconnects, and the cache is cleared when it does.
- **Compose test** (readiness item 2.2): stop NATS; API pods stay ready.
- **CI check:** `setInterval` appears in `apps/api/src` only in the scheduler module. A new in-process cache must call the shared invalidation helper, which the check enforces by banning `new Map` fields named `cache` outside it.
