# BP-05-007 — Prepare an exam board and data pack

> Status: Draft
> Domain: 05 — Assessment and results
> Owner: TBC
> Version: 0.1
> Last reviewed: 2026-07-26
> Review by: 2027-01-26

[Previous: BP-05-006](../05-assessment-and-results/bp-05-006-investigate-academic-misconduct.md) · [Domain index](README.md) · [Next: BP-05-008](../05-assessment-and-results/bp-05-008-complete-external-examiner-review.md) · [Library home](../README.md)

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
| Revelation workflows | W005 |
| Reference-model flows | See integration contract catalogue; confirm detailed F-number mapping during architecture review |
| Functional requirements | See functional requirements; detailed mapping remains an SME/architecture review action |
| Data entities | board instance, agenda and reproducible data snapshot; supporting identity, evidence, decision and integration-exchange records |
| Domain events | Proposed: `srs.prepare.an.exam.board.and.data.pack.completed` |
| Integration contracts | SRS/case systems → board workspace |

## Purpose and outcome

Preparing an exam board and its data pack turns a snapshot of candidate results, exceptional-circumstance and misconduct indicators into the single, access-controlled evidence pack the board will actually decide from. Freezing the population at a recorded cut-off, and running completeness and anomaly checks before the pack is produced, means the board never makes decisions from a partial or silently-changing data set. Any item that arrives after the freeze is tracked as a late item and issued as a versioned replacement or addendum, never merged invisibly into the original pack.

## Scope

**Starts when:** A module/programme board cut-off is reached.

**Ends when:** The authorised outcome is recorded, communicated and reconciled, or the case is closed with an owned reason.

**In scope:** Intake, validation, evidence, decision, effective dating, communication and downstream reconciliation.

**Out of scope:** Upstream policy creation and later lifecycle processes referenced under Related processes.

## Actors and responsibilities

| Actor/system | Responsibility |
|---|---|
| Assessment Officer | Initiates or owns the principal business action |
| Board Chair | Provides evidence, decision, system processing or governed support |
| SRS | Provides evidence, decision, system processing or governed support |
| Case/Support Systems | Provides evidence, decision, system processing or governed support |

**Accountable owner:** Assessment Officer service owner or delegated authority (TBC)

**System of record:** SRS for the student-record outcome; specialist systems retain their governed source evidence.

## Preconditions

1. Canonical person, programme/period and source identifiers are available where applicable.
2. The current policy/rule version and decision authority are configured.
3. Required interfaces use stable identifiers, provenance and reconciliation controls.

## Trigger

A module/programme board cut-off is reached.

## Main flow

1. **Assessment Officer** define board scope, membership, quorum, date and decision authority.
2. **Board Chair** freeze the candidate/result population at a recorded cut-off.
3. **SRS** join only authorised EC, misconduct and support indicators.
4. **Case/Support Systems** run completeness, anomaly and prior-decision checks.
5. **Assessment Officer** produce an access-controlled pack with calculation explanations.
6. **SRS** record late items and issue a versioned replacement or addendum.

## Alternative flows

### A1 — Variant

- **A1.1** Sub-board and final board stages retain their separate scopes.

### A2 — Variant

- **A2.1** Partner and professional-body representatives receive role-limited views.

## Exception flows

### E1 — Control exception

- **E1.1** Quorum or material data-quality failure postpones ratification.

### E2 — Control exception

- **E2.1** Late sensitive information is handled through controlled addendum.

## Postconditions

### Successful

- The board instance, agenda and reproducible data snapshot is authoritative, effective-dated and linked to its evidence and decision authority.
- Each required consumer has acknowledged the correct version or has an owned reconciliation item.

### Unsuccessful or incomplete

- No unapproved outcome is represented as final; the case retains reason, owner and next action.

## Business rules and controls

| ID | Classification | Rule/control | Applicability | Source |
|---|---|---|---|---|
| BR-1 | SECTOR | Apply the current authoritative requirement and provider regulation for the person, level, mode and nation | UK/configured | SRC-059 |
| BR-2 | INSTITUTION | Decision roles, deadlines, evidence and permitted discretion are policy-versioned | Provider | Provider regulations |
| BR-3 | REVELATION | W005 needs reproducible board snapshots, membership/quorum and pack versioning. | Revelation | SRC-015–SRC-019 |
| BR-4 | PROPOSED | Proposed, approved, rejected and superseded states remain distinguishable | Revelation target | Process control |
| BR-5 | PROPOSED | Corrections append provenance and trigger impact/reconciliation; they do not silently overwrite | Revelation target | Data governance |

## National and institutional variations

### England

Awarding-provider regulations and external examining arrangements apply within the English regulatory context.

### Scotland

SCQF levels, Scottish degree structures and provider senate regulations must be configurable.

### Wales

CQFW context, Welsh-language operation and awarding/partner responsibilities must be configurable.

### Northern Ireland

Provider regulations, external examining and any professional-body requirements apply.

### Institutional policy points

Terminology, authority, deadlines, evidence, thresholds, communication, appeals/reviews, partner responsibility and target-system ownership.

## Data impact

| Data concept | Action | System of record | Effective/provenance requirement | Sensitivity |
|---|---|---|---|---|
| board instance, agenda and reproducible data snapshot | Create/version | SRS or governed specialist source | Policy, actor, evidence, decision and effective/transaction times | Personal; may be sensitive |
| Workflow/case evidence | Append | Owning service | Immutable source and restricted access | Personal/confidential |
| Integration exchange | Append/update | SRS integration ledger | Contract version, correlation, attempts and acknowledgement | Personal |

## Integration impact

| From | To | Information/purpose | Contract/pattern | Failure and reconciliation |
|---|---|---|---|---|
| SRS/case systems | board workspace | snapshot | Versioned/idempotent contract | Retry, quarantine, acknowledge and reconcile |

## Sequence diagram

```mermaid
sequenceDiagram
    actor A1 as Assessment Officer
    participant A2 as Board Chair
    participant A3 as SRS
    participant A4 as Case/Support Systems
    A1->>A2: 1. defines board scope, membership, quorum, date and decision authority
    A2->>A3: 2. freezes the candidate/result population at a recorded cut-off
    A3->>A4: 3. joins only authorised EC, misconduct and support indicators
    A4->>A1: 4. runs completeness, anomaly and prior-decision checks
    A1->>A2: 5. produces an access-controlled pack with calculation explanations
    A3->>A3: 6. records late items and issues a versioned replacement or addendum
    alt Valid and authorised
        A3->>A2: Record and communicate outcome
    else Incomplete or exception
        A3->>A2: Retain case with owner and reason
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
| [SRC-059](../source-register.md) | External process, regulatory or sector evidence |
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
