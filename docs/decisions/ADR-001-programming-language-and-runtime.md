# ADR-001: Programming Language and Runtime

**Status**: Accepted
**Date**: 2026-06-04

## Context

A primary programming language must be chosen for all backend services. The choice affects contributor accessibility (open source project), type safety (data integrity requirement), ecosystem maturity (workflow engine, ORM, event bus SDKs), and suitability for REST API and event-driven architecture patterns.

## Decision

**TypeScript on Node.js 22 LTS** for all backend services.

## Rationale

- Strong static typing catches domain model errors at compile time, consistent with the data integrity requirements of an SRS.
- Large, active ecosystem with mature libraries for every required integration pattern (REST, events, file exchange, database, workflow).
- Widely known across developers of all backgrounds, maximising the contributor pool for an open source project.
- Node.js 22 LTS provides a stable, long-term supported runtime with native TypeScript tooling improvements.
- Consistent language across backend and frontend reduces context-switching for contributors.
- Free and open source (MIT licence).

## Alternatives Considered

| Language | Reason rejected |
|---|---|
| Java / Spring Boot | Heavier runtime, more verbose, higher barrier to contribution; though mature for enterprise SRS work |
| Kotlin / Spring Boot | Better ergonomics than Java but same JVM overhead; smaller contributor pool than TypeScript |
| Go | Excellent performance and simplicity; weaker ecosystem for workflow engines and ORMs; smaller contributor pool |
| Python | Weaker type safety at scale; slower execution for API-heavy workloads |

## Consequences

- All backend services are TypeScript; strict mode enforced.
- `tsconfig.json` targets Node.js 22 with `strict: true`, `noUncheckedIndexedAccess: true`.
- Runtime type validation at API boundaries uses JSON Schema (enforced by the API framework) rather than duplicating schema in application code.
