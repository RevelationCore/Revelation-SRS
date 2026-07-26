# BP-062 — Retain, archive and dispose of student records

> Status: Draft
> Domain: 08 — Record governance and lifecycle
> Owner: TBC
> Version: 0.1
> Last reviewed: 2026-07-26
> Review by: 2027-01-26

[Previous: BP-061](../08-record-governance-and-lifecycle/bp-061-assess-restriction-rectification-or-erasure-rights.md) · [Domain index](README.md) · [Next: BP-063](../08-record-governance-and-lifecycle/bp-063-audit-access-and-material-record-changes.md) · [Library home](../README.md)

## Applicability

| Dimension | Applies |
|---|---|
| Common | UK |
| Nations | England; Scotland; Wales; Northern Ireland |
| Provider types | Providers operating this process; exact regulatory scope is configured |
| Levels and modes | UG; PGT; PGR; full-time; part-time; distance and collaborative provision where relevant |
| Exclusions | Activities outside the stated start/end boundary |

## Traceability

| Type | References |
|---|---|
| Revelation workflows | Gap |
| Reference-model flows | See integration contract catalogue; confirm detailed F-number mapping during architecture review |
| Functional requirements | See functional requirements; detailed mapping remains an SME/architecture review action |
| Data entities | retention class, legal hold, archive and disposal certificate; supporting identity, evidence, decision and integration-exchange records |
| Domain events | Proposed: `srs.retain.archive.and.dispose.of.student.records.completed` |
| Integration contracts | SRS → archive/disposal service |

## Purpose and outcome

Retain, archive and dispose of student records creates a controlled, explainable and effective-dated retention class, legal hold, archive and disposal certificate. The outcome preserves the evidence, authority and cross-system state needed for the Revelation SRS rather than reducing the process to a status update.

## Scope

**Starts when:** A record reaches a retention event or scheduled review.

**Ends when:** The authorised outcome is recorded, communicated and reconciled, or the case is closed with an owned reason.

**In scope:** Intake, validation, evidence, decision, effective dating, communication and downstream reconciliation.

**Out of scope:** Upstream policy creation and later lifecycle processes referenced under Related processes.

## Actors and responsibilities

| Actor/system | Responsibility |
|---|---|
| Records Manager | Initiates or owns the principal business action |
| Data Owner | Provides evidence, decision, system processing or governed support |
| Archivist | Provides evidence, decision, system processing or governed support |
| System Administrator | Provides evidence, decision, system processing or governed support |

**Accountable owner:** Records Manager service owner or delegated authority (TBC)

**System of record:** SRS for the student-record outcome; specialist systems retain their governed source evidence.

## Preconditions

1. Canonical person, programme/period and source identifiers are available where applicable.
2. The current policy/rule version and decision authority are configured.
3. Required interfaces use stable identifiers, provenance and reconciliation controls.

## Trigger

A record reaches a retention event or scheduled review.

## Main flow

1. **Records Manager** classify records by purpose, authority, trigger and approved schedule.
2. **Data Owner** calculate review/disposal dates from authoritative lifecycle events.
3. **Archivist** check legal, investigation, complaint and research/archive holds.
4. **System Administrator** approve transfer, continued retention, anonymisation or disposal.
5. **Data Owner** execute across primary, derived and governed backup locations.
6. **Archivist** retain disposal/transfer evidence without retaining the disposed content.

## Alternative flows

### A1 — Variant

- **A1.1** Permanent archival selection transfers custody and access controls.

### A2 — Variant

- **A2.1** Anonymised analytical data requires a documented re-identification risk assessment.

## Exception flows

### E1 — Control exception

- **E1.1** Active hold blocks disposal and records the owner/review date.

### E2 — Control exception

- **E2.1** Failed partial disposal is reconciled across replicas and processors.

## Postconditions

### Successful

- The retention class, legal hold, archive and disposal certificate is authoritative, effective-dated and linked to its evidence and decision authority.
- Each required consumer has acknowledged the correct version or has an owned reconciliation item.

### Unsuccessful or incomplete

- No unapproved outcome is represented as final; the case retains reason, owner and next action.

## Business rules and controls

| ID | Classification | Rule/control | Applicability | Source |
|---|---|---|---|---|
| BR-1 | SECTOR | Apply the current authoritative requirement and provider regulation for the person, level, mode and nation | UK/configured | SRC-072–SRC-073 |
| BR-2 | INSTITUTION | Decision roles, deadlines, evidence and permitted discretion are policy-versioned | Provider | Provider regulations |
| BR-3 | REVELATION | No record-level retention classification, hold or disposal orchestration exists. | Revelation | SRC-015–SRC-019 |
| BR-4 | PROPOSED | Proposed, approved, rejected and superseded states remain distinguishable | Revelation target | Process control |
| BR-5 | PROPOSED | Corrections append provenance and trigger impact/reconciliation; they do not silently overwrite | Revelation target | Data governance |

## National and institutional variations

### England

UK GDPR and the Data Protection Act 2018 apply; provider retention and legal obligations define implementation.

### Scotland

The common data-protection framework applies with Scottish provider governance and public-records obligations where relevant.

### Wales

The common data-protection framework applies; Welsh-language communication preferences must be honoured.

### Northern Ireland

The common data-protection framework applies with Northern Ireland provider governance.

### Institutional policy points

Terminology, authority, deadlines, evidence, thresholds, communication, appeals/reviews, partner responsibility and target-system ownership.

## Data impact

| Data concept | Action | System of record | Effective/provenance requirement | Sensitivity |
|---|---|---|---|---|
| retention class, legal hold, archive and disposal certificate | Create/version | SRS or governed specialist source | Policy, actor, evidence, decision and effective/transaction times | Personal; may be sensitive |
| Workflow/case evidence | Append | Owning service | Immutable source and restricted access | Personal/confidential |
| Integration exchange | Append/update | SRS integration ledger | Contract version, correlation, attempts and acknowledgement | Personal |

## Integration impact

| From | To | Information/purpose | Contract/pattern | Failure and reconciliation |
|---|---|---|---|---|
| SRS | archive/disposal service | governed lifecycle action | Versioned/idempotent contract | Retry, quarantine, acknowledge and reconcile |

## Sequence diagram

```mermaid
sequenceDiagram
    actor A1 as Records Manager
    participant A2 as Data Owner
    participant A3 as Archivist
    participant A4 as System Administrator
    A1->>A2: 1. classify records by purpose, authority, trigger and approved schedule
    A2->>A3: 2. calculate review/disposal dates from authoritative lifecycle events
    A3->>A4: 3. check legal, investigation, complaint and research/archive holds
    A4->>A1: 4. approve transfer, continued retention, anonymisation or disposal
    A1->>A2: 5. execute across primary, derived and governed backup locations
    A2->>A3: 6. retain disposal/transfer evidence without retaining the disposed content
    alt Valid and authorised
        A4->>A1: Record and communicate outcome
    else Incomplete or exception
        A4->>A1: Retain case with owner and reason
    end
```

## Open questions and decisions

| ID | Question/decision | Owner | Status |
|---|---|---|---|
| OQ-1 | Confirm the authoritative owner, workflow boundary and detailed requirement/contract mapping | Process owner/architect | Open |
| OQ-2 | Which national, provider-type and mode variants require configuration? | Four-nation SME | Open |
| OQ-3 | Which evidence stays in a specialist system and what minimum outcome enters the SRS? | Data protection/data owner | Open |

## Sources

| Source | Supported content |
|---|---|
| [SRC-072–SRC-073](../source-register.md) | External process, regulatory or sector evidence |
| [SRC-015–SRC-019](../source-register.md) | Revelation workflows, actors, contracts, data and requirements |

## Related processes

[Process inventory](../process-inventory.md); adjacent lifecycle processes in the [process map](../process-map.md).

## Review record

| Review | Reviewer | Date | Outcome |
|---|---|---|---|
| Research/documentation | Codex implementation role | 2026-07-26 | Drafted |
| Required reviews | Process, national, data and integration SMEs (TBC) | — | Pending |

## Change history

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1 | 2026-07-26 | Codex | Initial research draft |
