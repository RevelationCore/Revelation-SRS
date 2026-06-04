# ADR-012: Architectural Style — Modular Monolith

**Status**: Accepted
**Date**: 2026-06-04

## Context

The SRS Core must be structured as a deployable application with clear domain module boundaries. The choice is between a microservices architecture (each domain module as an independent service) and a modular monolith (all modules in one deployable with enforced internal boundaries).

## Decision

**Modular monolith** for the SRS Core. Each domain module (Student Identity, Enrolment, Assessment, Progression, Exam Board, Regulatory) is a distinct internal module with enforced TypeScript project reference boundaries, but all are deployed in a single Fastify application process.

First-party modules (Wellbeing) and external adapters (VLE Connector) are always separate deployable units and communicate via the integration layer.

## Rationale

- **No distributed system complexity for core operations**: no network overhead, no partial failure scenarios, no distributed transactions between domain modules. A student enrolment that touches identity, enrolment, and fee liability records is a single database transaction.
- **Simpler to test**: integration tests spin up a single process against a Testcontainers database — no service mesh to simulate.
- **Simpler to deploy**: one container for the API; far lower operational overhead for a single institution.
- **Boundaries are preserved**: TypeScript project references and ESLint `eslint-plugin-boundaries` enforce that no module imports repository internals from another. The seams are real; splitting into services later is straightforward.
- **Right for the current scale**: a 50,000-student SRS does not require microservices. The bottleneck will be the database, not the application server.

## Alternatives Considered

| Approach | Reason rejected |
|---|---|
| Microservices from inception | Premature distributed system complexity; no benefit at current scale; significantly higher operational cost for institutions |
| Single-module monolith (no boundaries) | No internal structure; impossible to reason about or split later |

## Consequences

- Domain modules are TypeScript packages within `apps/api/src/modules/`.
- Cross-module calls use defined service interfaces, not repository imports.
- `eslint-plugin-boundaries` enforces the module boundary rules in CI.
- If an individual module needs independent scaling in future (unlikely at SRS scale), it can be extracted to a separate service using its defined interfaces as the API contract.
