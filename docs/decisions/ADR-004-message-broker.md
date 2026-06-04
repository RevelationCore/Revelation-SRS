# ADR-004: Message Broker

**Status**: Accepted
**Date**: 2026-06-04

## Context

The event-driven integration architecture (principle §12) requires a durable message broker for publishing and subscribing to domain events. The broker must support: at-least-once delivery, durable subscriptions (events are not lost if a consumer is temporarily offline), subject/topic-based routing, ordered delivery within a subject, and a dead-letter mechanism for unprocessable messages. It must run in Docker on a Mac Mini development environment without excessive resource consumption.

## Decision

**NATS JetStream** as the message broker.

## Rationale

- Single binary with no external dependencies; trivial to run in Docker with minimal resource footprint — well suited to development on a Mac Mini alongside PostgreSQL, Temporal, and Keycloak.
- JetStream layer provides durable, persistent messaging with at-least-once delivery, acknowledgements, and replay from any point in the stream.
- Subject-based routing maps naturally to the domain event taxonomy (e.g. `srs.student.enrolled`, `srs.result.ratified`).
- Consumer groups provide competing consumer load distribution and independent subscriber offset management.
- Excellent TypeScript SDK (`nats.ws` / `nats`) with full JetStream support.
- Dead-letter subjects for undeliverable messages satisfy the dead-letter policy requirement in principle §12.
- Free and open source (Apache 2.0 licence).
- Scales from a single server (development, small institution) to a clustered deployment (multi-institution) without application changes.

## Alternatives Considered

| Broker | Reason rejected |
|---|---|
| Apache Kafka | Excellent for high-throughput; requires Zookeeper or KRaft + multiple brokers to run correctly; heavy resource footprint on a development Mac Mini |
| Redpanda | Kafka-compatible, lighter than Kafka; still heavier than NATS; fewer advantages at SRS scale |
| RabbitMQ | Well-known; AMQP model is more complex than required; resource footprint higher than NATS |
| Redis Streams | Dual-purpose (cache + stream); stream semantics less rich than JetStream for this use case |

## Consequences

- All domain events are published to NATS JetStream subjects following the taxonomy defined in ADR (domain events catalogue, Phase 2).
- Event consumers are independent services or SRS module subscribers; they manage their own consumer group offsets.
- The NATS server is deployed as a Docker container in the local environment and as a clustered deployment in production.
- Integration adapters (VLE connector, etc.) subscribe to the relevant subjects via the JetStream client; they do not require internal network access to the SRS database.
