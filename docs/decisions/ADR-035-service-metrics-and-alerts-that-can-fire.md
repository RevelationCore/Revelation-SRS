# ADR-035: Service Metrics, and Alert Rules That Can Fire

**Status**: Accepted. The engineering decision is final. The alert receivers are the institution's or platform operator's to supply (adoption checklist A-3, A-18, A-19, A-20). Until they are supplied, alerts are evaluated and shown in Alertmanager and Grafana, and a production build is refused (see Guard).
**Date**: 2026-11-23
**Amends**: [ADR-030](ADR-030-malware-scanning-of-uploaded-documents.md) item 8. The two document alerts are evaluated by the Loki ruler and routed by Alertmanager, not by Grafana-managed rules. The SME-2 "contact point" `srs-security` becomes an Alertmanager receiver of the same name. The metric names become `srs_documents_scan_total` and `srs_documents_scan_duration_seconds`.
**Follows**: [ADR-008](ADR-008-observability.md) (OpenTelemetry, Prometheus and Alertmanager, Grafana, Loki); [ADR-024](ADR-024-live-temporal-execution.md) (workflow backlog signals); [ADR-027](ADR-027-shared-runtime-state-in-postgresql.md) (`/ready` gates on the database only); [ADR-036](ADR-036-default-deny-egress-and-a-named-host-egress-proxy.md) (the egress side of the observability pods)
**Backlog**: BL-370; related BL-087 (workflow backlog alert thresholds), BL-344 (document alerts), BL-009 (event outbox)
**Patterns**: P-06 (one configuration schema, checked against the deployment), P-05 (hide internal surfaces), P-11 (partial failure; `/ready` on the database only), P-21 (evidence for status claims), P-01 (test with production privileges)

## Context

What the repository shows (read 2026-11-23):

- **No service exports metrics.**
  - `apps/api`, `modules/wellbeing`, `modules/attendance` and `adapters/vle` each have a near-identical `src/telemetry.ts`. Each starts the OpenTelemetry `NodeSDK` with traces only: an OTLP span exporter if `OTEL_EXPORTER_OTLP_ENDPOINT` is set, otherwise none. No `MetricReader` is configured.
  - The four copies have already drifted. Wellbeing and the VLE connector add a `pg` request hook that copies `db.statement` onto spans.
  - `apps/bff` has no OpenTelemetry dependency at all.
- **The hooks are dead code.** The services use postgres.js (`packages/db/src/pool.ts`), which `@opentelemetry/instrumentation-pg` does not instrument. No `OTEL_EXPORTER_OTLP_ENDPOINT` is set in any manifest, so no traces leave the cluster either.
- **Scrape targets with nothing behind them.**
  - `infra/k8s/base/api.yaml` annotates the API pod `prometheus.io/port: "9464"` and declares a `metrics` container port 9464. Nothing listens on it.
  - `workers.yaml` annotates the worker with port 9465, but the worker only listens on 9466 (health).
  - The API instead serves a hand-written `/metrics` on its main port 3000 (`apps/api/src/routes/health.ts`): uptime, RSS and `srs_api_event_bus_connected`. The Ingress routes `api.example.com/` to that port, so this internal surface is public. Wellbeing has a similar route.
- **The OpenTelemetry Prometheus exporter is already installed.** `@opentelemetry/exporter-prometheus@0.223.2` is in the lockfile, as a dependency of `sdk-node`. Its defaults are port 9464 and `/metrics`. Read in `PrometheusSerializer.js`, it:
  - replaces `.` with `_`;
  - appends `_total` to monotonic counters;
  - does **not** append unit suffixes.

  `@opentelemetry/instrumentation-http@0.223.2` records only the stable `http.server.request.duration`, in seconds. It sets `http.route` only from RPC metadata that a framework instrumentation provides. `auto-instrumentations-node@0.81.2` has no Fastify instrumentation, so no route label would be recorded.
- **There are two rule sets, and they disagree.** `infra/k8s/base/observability.yaml` (ConfigMap `prometheus-rules`, 8 rules) and `infra/prometheus/srs-alerts.yml` (12 rules, not deployed anywhere). Every rule in them is broken:

  | Rule (either file) | Queries | Why it cannot fire |
  |---|---|---|
  | `ApiHighErrorRate`, `ApiHighLatency` | `http_request_duration_seconds_*{job="srs-api"}` | Nothing emits it. The scrape job named `srs-api` also scrapes every annotated pod, so `job` does not identify the API |
  | `DatabaseConnectionPoolSaturation` | `db_connection_pool_*` / `srs_db_connection_pool_*` | Nothing emits it. postgres.js has no public pool-usage API (`types/index.d.ts`) |
  | `NatsConsumerLag`, `*DeadLetterQueueNonEmpty` | `nats_consumer_num_pending` | Port 8222 serves NATS's JSON monitoring, not Prometheus text, and no exporter is deployed. Dead-lettering is a database row plus `ack()` (`adapters/vle/src/consumers/vle-event-consumer.ts:121`). There is no DLQ consumer |
  | `TemporalWorkflowFailure*` | `temporal_workflow_failed_total` | The Temporal server (port 9090, `temporal.yaml`) uses server metric names. The worker installs no Temporal SDK metrics runtime |
  | `TemporalWorkerDown` | `up{job="srs-worker"}` | No job has that name |
  | `BackupStale`, `BackupLarge` | `srs_last_backup_*` | `infra/scripts/backup.sh` pushes only if `PROMETHEUS_PUSHGATEWAY` is set, and no Pushgateway exists. An absent series never alerts |
  | `DemoRotationFailed` | `srs_demo_rotation_last_success_timestamp_seconds` | Nothing emits it |
  | `ApiPodsUnavailable`, `KeycloakUnreachable` | `kube_deployment_*`, `kube_pod_container_*` | kube-state-metrics is not deployed |
- **Even a firing rule would reach no one.** `alerting.alertmanagers[].static_configs.targets: []`, and no Alertmanager is deployed. ADR-030's document alerts (BL-344) are not built.
- **The network blocks the observability stack.** `default-deny-ingress` applies to the whole namespace. Every scrape rule in `network-policies.yaml` admits only the namespace `monitoring`, but `srs-prometheus` runs in `revelation-srs`. Nothing admits Grafana to Prometheus, Loki or Tempo, or Promtail to Loki. As deployed, Prometheus scrapes nothing and Loki receives no logs.
- **Promtail reached end of life on 2 March 2026.** Grafana now develops only Alloy. Promtail also promotes `traceId` and `tenantId` to Loki labels, and `traceId` is an unbounded label.
- **Stage.** Alpha and pre-production. Renaming metrics, deleting rules and changing ports breaks nothing in use.

Principle §21 and NFR-OBS-002 and NFR-OBS-005 say services expose Prometheus metrics, with alert thresholds kept alongside them. Today the thresholds are kept and the metrics are not: the system is running blind while appearing monitored.

## Decision

1. **Metrics come from the OpenTelemetry SDK, exported for Prometheus to pull.**
   - Each service runs a `PrometheusExporter` as its `MetricReader`, on a dedicated port **9464** named `metrics`, path `/metrics`.
   - That port is never a Service port that an Ingress routes to.
   - The worker also exposes the Temporal SDK's own metrics on **9465**, named `sdk-metrics`. They come from `Runtime.install({ telemetryOptions: { metrics: { prometheus: { bindAddress: '0.0.0.0:9465' } } } })`.
   - No OpenTelemetry Collector, no Pushgateway and no kube-state-metrics are added.

2. **One telemetry package.** A new workspace package, `packages/telemetry`, replaces the four `telemetry.ts` copies. It exports:
   - `startTelemetry({ serviceName, metricsPort = 9464 })`. This sets up:
     - traces through a `BatchSpanProcessor`, not `SimpleSpanProcessor`, to `OTEL_EXPORTER_OTLP_ENDPOINT`;
     - metrics through the Prometheus exporter;
     - `@opentelemetry/instrumentation-runtime-node`;
     - a View that drops the `http.server.request.duration` instrument of the meter `@opentelemetry/instrumentation-http`. Its spans are kept; item 3 records the metric with a route.
     - no `pg` hooks. The `db.statement` request hooks are deleted: they instrument nothing today, and a statement must never carry personal data into a span.
   - `httpServerMetrics`, a Fastify plugin.
   - typed helpers for the SRS instruments in item 4.
   - Every service's `main.ts` (and `worker.ts`) imports it first, `apps/bff` included.
   - The hand-written `/metrics` routes on ports 3000 and 3002 are deleted.
   - `METRICS_PORT` and `OTEL_EXPORTER_OTLP_ENDPOINT` enter each service's config schema (P-06). Every base Deployment sets `OTEL_EXPORTER_OTLP_ENDPOINT=http://srs-tempo:4318`.

3. **HTTP server metrics are recorded by the plugin, with a bounded route label.**
   - The plugin's `onResponse` hook records `http.server.request.duration`, in seconds, with:
     - `http_request_method`;
     - `http_route`, the route template from `request.routeOptions.url`, or `unmatched` when no route matched;
     - `http_response_status_code`.
   - It uses the semantic-convention buckets: 0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10.
   - Routes registered with `schema.hide: true` (health, readiness) are not recorded.
   - The Prometheus names are `http_server_request_duration_bucket`, `_count` and `_sum`, with no `_seconds` suffix, as the exporter writes them.

4. **The metrics catalogue.** These are the metrics the SRS services emit, as Prometheus names. SRS-defined instruments carry the unit in the name, so the Prometheus name follows Prometheus convention even though the exporter adds no suffix. **No metric carries a person identifier, a raw URL path, a request body value or free text.** Only the backlog gauges carry `tenant_id`, a UUID bounded by the number of tenants.

   | Metric | Type | Labels | Emitted by |
   |---|---|---|---|
   | `http_server_request_duration` | histogram (s) | `http_request_method`, `http_route`, `http_response_status_code` | srs-api, srs-admin-bff, srs-portal-bff, srs-wellbeing, srs-attendance, srs-vle-adapter |
   | `http_client_request_duration` | histogram (s), from `instrumentation-undici` | `http_request_method`, `server_address`, `server_port`, `http_response_status_code`, `error_type` | all seven Node services |
   | `srs_dependency_up` | gauge, 1 or 0, probed every 15 s with the same checks as `/ready` | `dependency` | srs-api (`database`, `nats`, `temporal`, `keycloak_jwks`); srs-worker (`database`, `nats`, `temporal`); srs-wellbeing, srs-attendance, srs-vle-adapter (`database`, `nats`, `srs_api`); the BFFs (`database`, `srs_api`, `keycloak`) |
   | `srs_events_published_total` | counter | `subject_family` (the first three subject tokens), `outcome` = `ok` or `error` | every service that publishes |
   | `srs_events_consumed_total` | counter | `consumer` (the durable name), `outcome` = `ok`, `retry` or `dead_letter` | every service with a JetStream consumer |
   | `srs_documents_scan_total` | counter | `outcome` = `clean`, `infected` or `error` | srs-api, srs-worker, srs-wellbeing |
   | `srs_documents_scan_duration_seconds` | histogram; buckets 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30 | none | srs-api, srs-worker, srs-wellbeing |
   | `srs_worker_reconcile_runs_total` | counter | `outcome` = `ok` or `error` | srs-worker |
   | `srs_worker_reconcile_last_success_timestamp_seconds` | gauge | none | srs-worker |
   | `srs_outbox_pending` | gauge, set by the reconcile loop, not queried on scrape | `outbox` = `workflow`, `adjustment_distribution` or `delivery` (and `event` with BL-009), `tenant_id` | srs-worker |
   | `srs_outbox_oldest_pending_age_seconds` | gauge, set by the reconcile loop | `outbox`, `tenant_id` | srs-worker |
   | `srs_vle_instructions_total` | counter | `action` = `apply` or `withdraw`, `outcome` = `ok`, `failed` or `retry` | srs-vle-adapter |
   | Temporal SDK metrics (`temporal_*`) | as the SDK exports them | `namespace`, `task_queue`, `workflow_type`, `activity_type` | srs-worker, port 9465 |
   | Node runtime metrics | as `instrumentation-runtime-node` exports them | none added | all seven |

   The workflow backlog metrics of the Temporal plan (pending-decision age, unapplied effects, projection mismatches) are BL-087's. They are named `srs_workflow_*`, follow the same label rules, and are added to the catalogue with BL-087's thresholds.

   **Exporters not written by the SRS** are catalogued with their source:

   | Source | Deployed as | Metrics the rules use |
   |---|---|---|
   | Prometheus | the scrape itself | `up` |
   | Temporal server | `srs-temporal`, port 9090 (exists) | `up{job="temporal-server"}` only |
   | NATS | a `prometheus-nats-exporter` sidecar in each `srs-nats` pod (image pinned by digest), `-varz -jsz=all http://localhost:8222`, port 7777 named `metrics` | the JetStream consumer pending count, `jetstream_consumer_num_pending{stream_name,consumer_name}` |
   | The institution's backup | supplied by the platform operator (A-20) | `srs_last_backup_timestamp_seconds` |

   The catalogue is a file, `infra/k8s/base/observability/metrics-catalogue.yaml`. Each entry gives: name, type, unit, labels with their allowed values (where the values are a closed set), `emittedBy` (services), and `source` (`srs`, an exporter name, or `external`). External exporters' names are taken from a scrape, not from memory (see Guard).

5. **How metrics are scraped.**
   - **Discovery by port name, not by annotation port.** The Prometheus job `srs-services` (renamed from `srs-api`) keeps pods annotated `prometheus.io/scrape: "true"`, and container ports named `metrics` or `sdk-metrics`. It sets:
     - `service` from `app.kubernetes.io/name`;
     - `pod` and `namespace`;
     - `port_name` from the port name.

     The `prometheus.io/port` and `prometheus.io/path` annotations are removed.
   - **Other jobs.** `temporal-server` (`srs-temporal:9090`) stays as it is. `nats-monitoring` is replaced by pod discovery of the exporter sidecar's `metrics` port, under `srs-services` with `service=srs-nats`. A `prometheus` job scrapes Prometheus itself.
   - **PodMonitors as an option.** Base runs no Prometheus Operator, so it uses no `ServiceMonitor` or `PodMonitor`. An optional kustomize component, `infra/k8s/components/prometheus-operator`, provides `PodMonitor`s with the same port names and a `PrometheusRule` generated from the same rule files. It is for institutions that run kube-prometheus-stack, which `observability.yaml` already mentions.
   - **Network policies: the ingress side.**
     - Every scraped port admits `app.kubernetes.io/name: srs-prometheus` in this namespace, and the `monitoring` namespace for an external Prometheus. These ports are 9464 on all seven services, 9465 on the worker, 7777 on NATS and 9090 on Temporal. The existing `monitoring`-only rules are corrected.
     - New policies admit the stack's own traffic:
       - `srs-grafana` to Prometheus 9090, Loki 3100, Tempo 3200 and Alertmanager 9093;
       - `srs-promtail` (or its replacement) to Loki 3100;
       - Prometheus and the Loki ruler to Alertmanager 9093;
       - the seven services to Tempo 4318.
     - The egress side is decided in ADR-036.

6. **Rules are Prometheus-format files evaluated by Prometheus and the Loki ruler. Alertmanager routes them.**
   - **One source of rules.** It lives in `infra/k8s/base/observability/rules/`:
     - `prometheus/*.yml`, loaded by a `configMapGenerator`;
     - `loki/*.yml`, loaded by the Loki ruler, with `ruler.alertmanager_url: http://srs-alertmanager:9093` and local rule storage.
   - **Retired.** `infra/prometheus/srs-alerts.yml` and the inline `prometheus-rules` ConfigMap are deleted. Compose mounts the same directory.
   - **Grafana evaluates nothing.** It shows the Prometheus, Loki and Alertmanager alerts (an Alertmanager data source is added). There is no Grafana-managed alert rule, and no Grafana contact point.
   - **Alertmanager is added.** It is a new Deployment, `srs-alertmanager`, with a pinned `prom/alertmanager` image, one replica, a 1 Gi PVC for silences and the notification log, and the hardened `securityContext` used elsewhere. Prometheus's `alerting.alertmanagers` points at `srs-alertmanager:9093`.
   - **The routing tree** (receivers are supplied per deployment; see item 8):
     - default receiver `platform-oncall`;
     - `severity="security"` to `srs-security`, with `continue: true`, so the on-call also receives it (SME-2);
     - `alertname="Watchdog"` to `watchdog`, with `repeat_interval: 1m`;
     - `group_by: [alertname, service]`.

7. **The rule set.** Every existing rule is replaced as follows. The `runbook` annotation must name a file that exists.

   | Rule | Expression (abridged) | For | Severity | Replaces |
   |---|---|---|---|---|
   | `ServiceHighErrorRate` | `sum by (service) (rate(http_server_request_duration_count{http_response_status_code=~"5.."}[5m])) / sum by (service) (rate(http_server_request_duration_count[5m])) > 0.01`, and the same denominator `> 0.1` (at least 6 requests a minute) | 5m | warning | `ApiHighErrorRate` |
   | `ApiHighLatency` | `histogram_quantile(0.95, sum by (le) (rate(http_server_request_duration_bucket{service="srs-api"}[5m]))) > 0.5` (NFR-PERF-001) | 5m | warning | `ApiHighLatency` |
   | `ServiceDown` | `up{job="srs-services"} == 0` | 2m | critical | `TemporalWorkerDown` |
   | `ApiPodsUnavailable` | `(count(up{job="srs-services",service="srs-api",port_name="metrics"} == 1) or vector(0)) < 2` | 2m | critical | `ApiPodsUnavailable` (no kube-state-metrics) |
   | `DatabaseUnreachable` | `min by (service) (srs_dependency_up{dependency="database"}) == 0` | 2m | critical | `DatabaseConnectionPoolSaturation` |
   | `DependencyUnreachable` | `min by (service, dependency) (srs_dependency_up{dependency!="database"}) == 0` | 3m | warning | `KeycloakUnreachable` |
   | `NatsConsumerLag` | `max by (stream_name, consumer_name) (jetstream_consumer_num_pending) > 1000` | 5m | warning | `NatsConsumerLag` |
   | `EventsDeadLettered` | `sum by (service, consumer) (increase(srs_events_consumed_total{outcome="dead_letter"}[10m])) > 0` | 0m | warning | both dead-letter rules |
   | `EventPublishFailing` | `sum by (service) (increase(srs_events_published_total{outcome="error"}[10m])) > 0` | 10m | warning | new |
   | `ReconcileStale` | `time() - max(srs_worker_reconcile_last_success_timestamp_seconds) > 300 or absent(srs_worker_reconcile_last_success_timestamp_seconds)` | 5m | critical | new |
   | `OutboxBacklogOld` | `max by (outbox, tenant_id) (srs_outbox_oldest_pending_age_seconds) > 900` | 5m | warning | new |
   | `TemporalWorkflowFailures` | `sum by (workflow_type) (increase(<SDK failed-workflow counter>[10m])) > 5`; the counter name is taken from the SDK scrape fixture | 0m | warning | `TemporalWorkflowFailure*` |
   | `TemporalServerDown` | `up{job="temporal-server"} == 0` | 2m | critical | new |
   | `BackupStale` | `time() - max(srs_last_backup_timestamp_seconds) > 90000 or absent(srs_last_backup_timestamp_seconds)` | 1h | critical | `BackupStale`; it fires until A-20 is done, by design |
   | `Watchdog` | `vector(1)` | 0m | none | new: a dead man's switch for the alerting pipeline |
   | `DocumentMalwareDetected` (Loki) | `sum(count_over_time({app=~"srs-api\|srs-worker\|srs-wellbeing"} \| json \| event=~"documents.upload.rejected\|documents.rescan.infected" [10m])) > 0` | 0m | security | ADR-030 |
   | `DocumentScannerUnavailable` (Loki) | the same selector, `event="documents.scanner.unavailable"`, `> 5` | 0m | warning | ADR-030 |
   | `EgressDenied` (Loki) | defined in ADR-036 | | warning | ADR-036 |

   **Deleted without replacement:**
   - `BackupLarge`, which was informational; it belongs on a dashboard.
   - `DemoRotationFailed`. Nothing emits its metric; BL-427 brings it back for the demo overlay only.

8. **Receivers are deployment configuration, and a production build without them is refused.**
   - The Alertmanager config is a ConfigMap. The base defines receivers `platform-oncall`, `srs-security` and `watchdog` with no integrations, so alerts are visible in the UI only.
   - Overlays patch in the integrations. Any credential (webhook URL, SMTP password) comes from a Secret `srs-alertmanager-receivers`, mounted and referenced by `*_file` fields.
   - Webhook receivers go through the egress proxy (`http_config.proxy_url`, ADR-036). An email receiver uses the institution's SMTP relay at a declared address.

9. **Logs: Promtail is replaced by Grafana Alloy** (Apache 2.0, Grafana's supported collector). Alloy keeps the labels `namespace`, `pod`, `app` and `component`, which the Loki rules select on, and `level`. `traceId` and `tenantId` become structured metadata, not labels. This is BL-425. It is in this ADR because the Loki rules depend on logs arriving.

## Rationale

- **Pull keeps "is it up?" for free.** A scraped target that stops answering gives `up == 0`, so `ServiceDown` and `ApiPodsUnavailable` need no kube-state-metrics. A push pipeline (OTLP to a Collector or to Prometheus's OTLP receiver) needs a separate liveness signal, and adds a component or depends on a newer Prometheus.
- **It reuses what is installed and agreed.** OpenTelemetry for instrumentation, and Prometheus with Alertmanager, are the stack in ADR-008 and `docs/decisions/technology-stack.md`. The exporter is already in the lockfile. Alertmanager is the one component added, and it is the agreed one. Without it, or Grafana-managed alerting, nothing is routed at all.
- **The rules can be tested.** Prometheus-format rules can be checked by `promtool check rules` and unit-tested by `promtool test rules`. The same files become a `PrometheusRule` for kube-prometheus-stack. Grafana-managed rules (ADR-030's first choice) have neither. That is why ADR-030 item 8 is amended now, before BL-344 builds anything.
- **A route label is what makes HTTP metrics useful, and it must be bounded.** Without a Fastify instrumentation the stock HTTP metric has no route. A raw path would put person IDs into label values. The plugin records the template, and `unmatched` for everything else.
- **The rules follow the signals that exist.**
  - Pool saturation cannot be measured with postgres.js, so the database alert is reachability, the same check `/ready` makes.
  - Dead-lettering is an application outcome, so it is counted where it happens.
  - Backup recency is the database operator's fact, so the rule fails loud (`absent`) until the operator supplies it.
- **An alert that cannot fire is worse than none.** It tells reviewers and auditors that a failure would be noticed. The guard makes "this rule can fire" a build-time fact, in the same way P-21 makes status claims need evidence.

## Options considered

| Option | Verdict |
|---|---|
| Do nothing | Rejected. Every rule is silent and the system is running blind |
| Move the rules to Loki (metrics from log lines) | Rejected as the main approach. Rates and percentiles from logs depend on log volume and parsing, cost more to query, and lose histograms. Kept for discrete events (ADR-030's two alerts, ADR-036's denials) |
| Tempo span metrics (`metrics_generator` remote-writing to Prometheus) | Rejected. Alerting would depend on trace export, sampling and Tempo staying up. It cannot express gauges such as outbox age or dependency state |
| OpenTelemetry SDK with the Prometheus exporter, scraped | **Chosen** |
| OTLP push to an OpenTelemetry Collector, or to Prometheus's OTLP receiver | Rejected for now. It adds a component or a Prometheus upgrade, and loses `up`. Reconsider if an institution's platform mandates push |
| `prom-client` directly | Rejected. It would be a second instrumentation library next to OpenTelemetry (ADR-008), with its own naming |
| Grafana-managed alerting for every rule | Rejected. It has no `promtool` checks or unit tests, it is not portable to `PrometheusRule`, and ADR-008 names Alertmanager |
| `ServiceMonitor`/`PodMonitor` in base | Rejected for base, which has no Prometheus Operator and whose CRDs would fail to apply. Offered as a component |
| Annotation-chosen port (`prometheus.io/port`) | Rejected. One port per pod cannot cover the worker's two endpoints. Port names can, and map one-to-one to `PodMonitor` |
| Deploy kube-state-metrics for pod availability | Rejected for now. `up` answers the same question for the SRS's own pods |
| Deploy a Pushgateway for backup metrics | Rejected. Production backups are the database operator's (`PostgreSQL (operator-managed, may be external)` in `network-policies.yaml`). They supply the series (A-20) |

## Consequences

- **Breaking changes, acceptable at Alpha:**
  - the API's and wellbeing's `/metrics` on their main ports are removed;
  - the scrape job is renamed;
  - every alert rule is replaced;
  - `infra/prometheus/srs-alerts.yml` is deleted;
  - the worker's annotation port moves to 9464.
- **More pods.** Alertmanager is one more Deployment, and NATS gains an exporter sidecar.
- **Alerting has a single point of failure.** Prometheus, Loki and Alertmanager each run one replica. The `Watchdog` route to an external dead man's switch (A-19) is how the operator learns the pipeline itself has died. HA Prometheus or Alertmanager is not in scope.
- **`BackupStale` fires in every deployment until A-20 is supplied.** This is deliberate: no evidence of a backup is reported as a missing backup.
- **Compose.** `infra/compose/prometheus/prometheus.yml` scrapes each service's 9464 and mounts the same rule files, so rules can be exercised locally.
- **Tempo's `metrics_generator` stays unused.** Its remote write is not configured, and nothing relies on it. Grafana's service map stays empty until it is.
- **ADR-030 item 8 is amended** (status line updated). BL-344 builds its two rules in the Loki rule file, under this ADR's guard.
- **BL-087** names its metrics `srs_workflow_*` and adds them to the catalogue and rule set.

## Guard

1. **`scripts/check-alert-rules.mjs` (`pnpm check:alerts`, run in CI).** For base and every overlay it renders with `kubectl kustomize`, as `check-k8s.mjs` does, and fails when:
   - A **PromQL** expression selects a metric that is not in the catalogue. Expressions are parsed with `@prometheus-io/lezer-promql`, the Prometheus project's parser. `_bucket`, `_count` and `_sum` map to their histogram.
   - A label matcher names a label that is neither the metric's nor a target label (`job`, `service`, `pod`, `namespace`, `port_name`, `instance`).
   - A matcher on a closed label set uses a value outside it, for example `outcome="deadletter"`.
   - `service="x"` names a service that is not in the metric's `emittedBy`.
   - A metric's `source` exporter is not deployed in that build (a Deployment, StatefulSet or sidecar container of the catalogued name).
   - An `external`-source metric is used in a rule that has no `absent()` branch.
   - `vector()` is used anywhere except `Watchdog` and an `or vector(0)` fallback.
   - A **LogQL** rule's stream selector names an `app` that is not a Deployment in the build.
   - A LogQL rule filters on an `event` value that does not appear as `event: '<value>'` in the source of one of those apps, or, for the proxy, in its log format.
   - A rule has no `severity` from `critical`, `warning`, `security`, `info` and `none`, or its `runbook` file does not exist.
   - A Grafana provisioning file defines alert rules or contact points.
   - A **production build**'s Alertmanager config has a `platform-oncall`, `srs-security` or `watchdog` receiver with no integration (A-3, A-18, A-19).
   - Any rule file fails `promtool check rules`, run in a pinned `prom/prometheus` container in CI.
2. **The catalogue is checked against real scrapes.**
   - `packages/telemetry/test/metrics-catalogue.int.test.ts`, one case per service, builds the service's app with `startTelemetry` on an ephemeral port. It makes one routed request, one unrouted request and one health request, then scrapes `/metrics`. It asserts that:
     - every catalogue metric attributed to that service is present;
     - each metric's label keys are a subset of the catalogue's (so nobody adds `person_id` or a raw path);
     - `http_route` is a template or `unmatched`;
     - the health request is not recorded.
   - External exporters are checked against scrape fixtures (`infra/k8s/base/observability/scrapes/{temporal-sdk,nats-exporter}.txt`), captured from the pinned images and refreshed when a pin changes. The check fails if a catalogued external name is missing from its fixture.
3. **`promtool test rules`** unit tests (`infra/k8s/base/observability/rules/tests/*.yml`) fire and do not fire each Prometheus rule on synthetic series, including the low-traffic guard on `ServiceHighErrorRate` and the `absent()` branches.
4. **`check:k8s` additions:**
   - every Node service Deployment has a container port named `metrics`, which no Service selected by an Ingress exposes;
   - `srs-worker` also has `sdk-metrics`;
   - every scraped port's NetworkPolicy admits `srs-prometheus`.
5. **An ESLint rule** bans `new PrometheusExporter`, `NodeSDK` and `MeterProvider` outside `packages/telemetry`.

## Follow-up work

| ID | Title | Type | Area | Priority | Size |
|---|---|---|---|---|---|
| BL-420 | `packages/telemetry`: `startTelemetry` (batch traces, Prometheus exporter on 9464, runtime metrics, drop View), `httpServerMetrics` plugin; adopt in api, worker, wellbeing, attendance, VLE connector and both BFFs; delete the four `telemetry.ts` copies, the `db.statement` hooks and the `/metrics` routes on service ports | Defect | Infrastructure | P1 | M |
| BL-421 | Emit the catalogue's SRS metrics: `srs_dependency_up`, event publish and consume counters, document scan counter and histogram, worker reconcile and outbox gauges, VLE instruction counter; Temporal SDK metrics on 9465 | Feature | Infrastructure | P1 | M |
| BL-422 | Scraping and network: `srs-services` job by port name, NATS exporter sidecar, `prometheus` self-scrape, NetworkPolicies admitting `srs-prometheus` and the stack's internal traffic, `OTEL_EXPORTER_OTLP_ENDPOINT` on every Deployment, compose scrape config | Defect | Infrastructure | P1 | M |
| BL-423 | Alertmanager and the rule set: `srs-alertmanager` Deployment and routing tree, Loki ruler, rule files under `observability/rules/` replacing both old rule sets, `Watchdog`, `BackupStale` with `absent()` | Operations | Infrastructure | P1 | M |
| BL-424 | Guards: `check:alerts` (PromQL/LogQL references, labels, sources, receivers, `promtool check rules`), per-service catalogue scrape test, scrape fixtures, `promtool test rules`, `check:k8s` metrics-port assertions, ESLint telemetry rule | Test | Infrastructure | P1 | M |
| BL-425 | Replace Promtail (end of life 2 March 2026) with Grafana Alloy; `traceId` and `tenantId` as structured metadata, not labels | Operations | Infrastructure | P1 | S |
| BL-426 | Optional kustomize component for kube-prometheus-stack: `PodMonitor`s and a `PrometheusRule` from the same rule files | Improvement | Infrastructure | P3 | S |
| BL-427 | Demo overlay only: the demo rotation emits `srs_demo_rotation_last_success_timestamp_seconds`, with `DemoRotationFailed` restored there | Improvement | Demo & migration | P3 | S |
| BL-428 | Runbook entries for every new rule (`ServiceDown`, `DependencyUnreachable`, `ReconcileStale`, `OutboxBacklogOld`, `EventsDeadLettered`, `EventPublishFailing`, `TemporalServerDown`, `Watchdog`) in `docs/runbooks/` | Docs | Documentation | P2 | S |

BL-420 to BL-424 are go-live Tier 1: without them the deployment is running blind. BL-425 is Tier 2. Promtail still ships logs, but it is unsupported software on the path of the security alerts.
