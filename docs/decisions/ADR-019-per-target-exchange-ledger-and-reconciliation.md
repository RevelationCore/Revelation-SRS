# ADR-019: Use a Per-Target Exchange Ledger and State Reconciliation

**Status**: Proposed
**Date**: 2026-07-26

## Context

The existing integration architecture specifies retry and dead-letter behaviour, but BP-005, BP-032, BP-043 and BP-050–BP-062 require evidence that each target applied the correct authoritative version. Broker delivery is not equivalent to VLE membership, support implementation, corrected result publication, regulator acceptance or rights-action propagation.

## Decision

All regulated or record-changing exchanges shall create one ledger item per target and authoritative version. Each item records:

- tenant, source entity/version and target;
- contract/schema version;
- correlation and idempotency keys;
- queued/sent/acknowledged/rejected/quarantined/reconciled/accepted-exception state;
- attempts, timestamps, response/target reference and sanitised error;
- reconciliation snapshot/high-water mark and final disposition.

Consumers shall apply commands/events idempotently. A transport acknowledgement marks delivery only; an application acknowledgement or snapshot reconciliation marks applied state. Retry never creates another business record.

Correction, withdrawal, identity merge, restriction, erasure and disposal use the same ledger pattern with target-specific contracts and authority checks.

## Rationale

- Makes partial failure visible without corrupting authoritative state.
- Supports safe replay and version-aware correction.
- Generalises repeated distribution patterns already identified in the process library.
- Provides operational and regulatory evidence.

## Consequences

- `integration_exchange` requires per-target/version semantics or a successor model.
- Contracts must define application acknowledgements and reconciliation snapshots.
- Dashboards, alerts, ownership and accepted-exception governance are required.
- Dead-letter payloads must remain minimum necessary.

## Alternatives Considered

| Alternative | Reason rejected |
|---|---|
| Broker delivery status only | Does not prove target application |
| One status on the business record | Cannot represent independent target outcomes |
| Target-specific ad hoc tables | Duplicates logic and produces inconsistent controls |

## Traceability

- Requirements: ESP-010–ESP-012, ABR-017, IGA-004/012/015, XIC-001–XIC-007
- Backlog: BPR-I03, I07–I08, I10–I12
- Processes: BP-005, BP-032, BP-043, BP-050–BP-062

