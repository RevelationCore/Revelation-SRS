# ADR-021: Govern Identity, Individual Rights, Retention and Audit as Linked Controls

**Status**: Accepted for generic product implementation
**Date**: 2026-07-26

## Context

Duplicate identity resolution, correction, access requests, restriction/erasure, retention/disposal and audit affect the same distributed record but have distinct legal and business authorities. Direct merge/delete/update operations cannot preserve provenance, apply legal holds or demonstrate propagation.

## Decision

Create separate governed cases for:

- identity resolution;
- bitemporal fact correction;
- individual-rights request and decision;
- retention/disposition with legal/other holds;
- access/material-change audit review.

Identity merges preserve source identifiers, nominate a survivor, remain logically reversible and generate target redirects. Restrictions are enforceable processing markers consulted by APIs, workflows, extracts and integrations. Erasure/disposal operates through approved target work and produces minimal certificates rather than retaining disposed content.

Audit records are append-only and tamper-evident. Reviews may reference but cannot alter them. Expected audit gaps create a security/control incident.

ADR-013 remains authoritative for bitemporal facts; this ADR governs the case, authority and distributed consequences around those facts.

## Rationale

- Prevents destructive identity and record operations.
- Makes individual-rights decisions and exceptions demonstrable.
- Coordinates retention and legal holds across copies.
- Separates evidence of audit from the audit-review conclusion.

## Consequences

- New identity, rights, restriction, retention, hold, disposal and audit-review entities are required.
- Every material consumer must support applicable propagation contracts.
- Authorisation and segregation-of-duty policies must be defined.
- Backup/beyond-use and archival procedures need operational design.

## Alternatives Considered

| Alternative | Reason rejected |
|---|---|
| Direct administrator merge/delete | Weak authority, reversibility and propagation evidence |
| Treat all rights as data correction | Erasure, restriction and access have different tests/outcomes |
| Retention by table/database only | Cannot represent record class, hold or mixed disposition |
| Editable operational logs | Cannot provide reliable audit evidence |

## Traceability

- Requirements: IGA-001–IGA-018, XIC-001–XIC-007
- Backlog: BPR-W13, D17–D19, I12
- Processes: BP-08-001–BP-08-006

