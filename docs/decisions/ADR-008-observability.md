# ADR-008: Observability Stack

**Status**: Accepted
**Date**: 2026-06-04

## Context

Principle §18 requires structured logging, Prometheus-compatible metrics, distributed tracing, health endpoints, alerting, and log retention. All components must be open source, self-hosted, and runnable in Docker alongside the application services.

## Decision

**OpenTelemetry** for instrumentation (traces and metrics).
**Prometheus** for metrics storage and alerting rules.
**Grafana** for dashboards and alert routing.
**Grafana Loki** for log aggregation and retention.

## Rationale

**OpenTelemetry**
- Vendor-neutral, open standard for traces, metrics, and logs; instrumentation is portable across any backend.
- Official Node.js SDK (`@opentelemetry/sdk-node`) instruments Fastify, PostgreSQL, NATS, and HTTP calls automatically with minimal code.
- Trace context propagation across service boundaries satisfies the distributed tracing requirement.
- Free and open source (Apache 2.0 licence).

**Prometheus**
- De facto standard for metrics collection and alerting in containerised environments.
- Compatible with OpenTelemetry metrics via the Prometheus exporter.
- Alertmanager (bundled) handles alert routing, silencing, and notification.
- Free and open source (Apache 2.0 licence).

**Grafana**
- Integrates with Prometheus, Loki, and Tempo (Grafana's tracing backend) via a single UI.
- Pre-built dashboards for Node.js, PostgreSQL, NATS, and Keycloak reduce setup time.
- Free and open source (AGPL v3 — compatible with the project's AGPL v3 licence).

**Grafana Loki**
- Log aggregation designed for container-native structured logs; ingests from Docker log driver or Promtail agent.
- Indexed by labels (service name, tenant, correlation ID) rather than full-text, keeping storage efficient on a Mac Mini.
- Queryable from Grafana alongside metrics — correlated log/metric investigation in one interface.
- Free and open source (AGPL v3).

## Consequences

- Every service is instrumented with `@opentelemetry/sdk-node` at startup; no per-route instrumentation code is required.
- All log output is structured JSON; Promtail ships logs from Docker to Loki.
- Correlation IDs are injected into every request by Fastify middleware and propagated as OpenTelemetry trace context and as a structured log field.
- Prometheus scrape targets are defined in `prometheus.yml`; alert rules are version-controlled alongside the application.
- The full observability stack (Prometheus, Grafana, Loki, Promtail, OpenTelemetry Collector) runs as Docker Compose services in both local development and production environments.
- Log retention policy is configured in Loki; default is 90 days in development, configurable per deployment.
