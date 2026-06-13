# ADR-002: API Framework

**Status**: Accepted
**Date**: 2026-06-04

## Context

An HTTP API framework is required for all REST API surfaces. The framework must support TypeScript natively, produce OpenAPI 3.x specifications (principle §12), enforce JSON Schema validation at request boundaries, and perform well under the load targets defined in principle §18.

## Decision

**Fastify** for all HTTP API services.

## Rationale

- TypeScript-first design with full type inference across route handlers, request/response schemas, and plugins.
- Fastest Node.js HTTP framework under benchmark; comfortably meets the 500ms p95 target at SRS scale.
- Native JSON Schema validation on all request inputs and response outputs — schema is the source of truth, validated before any handler code runs.
- First-class OpenAPI 3.x generation via `@fastify/swagger` and `@fastify/swagger-ui`, satisfying the API-first design principle without additional tooling.
- Plugin architecture with lifecycle hooks maps cleanly onto cross-cutting concerns (auth middleware, audit trail injection, correlation ID propagation, multi-tenancy context).
- Free and open source (MIT licence).

## Alternatives Considered

| Framework | Reason rejected |
|---|---|
| Express | De facto standard but not TypeScript-first; no native schema validation; OpenAPI generation requires third-party packages with more friction |
| Hono | Promising but newer and less proven at enterprise scale |
| NestJS | Opinionated framework-on-a-framework; significant abstraction overhead; slower |

## Consequences

- All routes define input and output JSON Schema; no unvalidated request data reaches handler logic.
- OpenAPI specs are generated from route schemas, not hand-written — the spec is always in sync with the implementation.
- Fastify plugins are the mechanism for cross-cutting concerns; no global middleware pattern.
