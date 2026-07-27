# ADR-016: Separate Authoritative Business State from Workflow State

**Status**: Proposed
**Date**: 2026-07-26

## Context

BP-001–BP-063 expose decisions that are currently combined inside W001, W005, W008, W009 and W012 or executed directly by services. A durable workflow can pause, retry or be superseded, while an application, CAS assignment, support outcome, ratified result or rights decision remains an authoritative business fact.

ADR-005 selects Temporal and ADR-015 establishes SRS-owned workflow records. This decision defines the missing boundary.

## Decision

Authoritative domain state and operational workflow state shall be separate but correlated.

- Domain entities hold approved/effective facts and their temporal history.
- SRS workflow records hold case state, tasks, evidence references, gates, deadlines and decisions.
- Temporal orchestrates execution and retries but is not the system of record for academic or regulatory facts.
- A workflow command reaches a domain service only after required gates pass; the domain service independently enforces invariants.
- Proposed, pending, approved, rejected, effective, superseded and corrected states remain distinguishable.
- Completion events are emitted only after the authoritative domain transaction commits.
- Every workflow instance references tenant, definition/version, initiating business object and resulting domain version.

The first P0 decompositions are CAS/sponsor compliance, engagement intervention, support distribution, assessment/ratification/correction, statutory submission and record-governance workflows.

## Rationale

- Workflow replay must not duplicate or reinterpret the academic record.
- Domain facts remain queryable if the workflow platform is unavailable.
- Provider-configurable process order does not weaken core data invariants.
- Decision evidence, authority and deadlines remain inspectable.

## Consequences

- New case/workflow entities and correlation fields are required.
- Commands and events need idempotency and authoritative-version checks.
- Existing W001/W005/W008/W009/W012 states require staged decomposition.
- Read models must show both operational case status and authoritative outcome without conflating them.

## Alternatives Considered

| Alternative | Reason rejected |
|---|---|
| Store authoritative state only in Temporal history | Weak domain querying, retention and regulatory reconstruction |
| Store workflow status on each domain entity | Couples variable process design to stable records and obscures parallel cases |
| Keep orchestration inside service methods | Does not provide task, deadline, escalation or decision history |

## Traceability

- Requirements: BPC, ESP, ABR, RSS and IGA workflow requirements
- Backlog: BPR-W02, W07–W10, W12–W13
- Processes: BP-005, BP-027–BP-032, BP-033–BP-043, BP-050–BP-063

