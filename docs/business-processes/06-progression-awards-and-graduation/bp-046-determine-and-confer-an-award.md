# BP-046 — Determine and confer an award

> Status: Draft
> Domain: 06 — Progression, awards and graduation
> Owner: TBC
> Version: 0.1
> Last reviewed: 2026-07-26
> Review by: 2027-01-26

[Previous: BP-045](../06-progression-awards-and-graduation/bp-045-manage-reassessment-referral-or-repeat-study.md) · [Domain index](README.md) · [Next: BP-047](../06-progression-awards-and-graduation/bp-047-issue-award-documentation-and-hear.md) · [Library home](../README.md)

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
| Revelation workflows | W011 |
| Reference-model flows | See integration contract catalogue; confirm detailed F-number mapping during architecture review |
| Functional requirements | See functional requirements; detailed mapping remains an SME/architecture review action |
| Data entities | award recommendation, conferment and classification; supporting identity, evidence, decision and integration-exchange records |
| Domain events | Proposed: `srs.determine.and.confer.an.award.completed` |
| Integration contracts | SRS → documents/HESA/portal |

## Purpose and outcome

Determine and confer an award creates a controlled, explainable and effective-dated award recommendation, conferment and classification. The outcome preserves the evidence, authority and cross-system state needed for the Revelation SRS rather than reducing the process to a status update.

## Scope

**Starts when:** A student reaches an award decision point with ratified results.

**Ends when:** The authorised outcome is recorded, communicated and reconciled, or the case is closed with an owned reason.

**In scope:** Intake, validation, evidence, decision, effective dating, communication and downstream reconciliation.

**Out of scope:** Upstream policy creation and later lifecycle processes referenced under Related processes.

## Actors and responsibilities

| Actor/system | Responsibility |
|---|---|
| Award Board | Initiates or owns the principal business action |
| Registry | Provides evidence, decision, system processing or governed support |
| SRS Calculation Service | Provides evidence, decision, system processing or governed support |
| Delegated Conferment Authority | Provides evidence, decision, system processing or governed support |

**Accountable owner:** Award Board service owner or delegated authority (TBC)

**System of record:** SRS for the student-record outcome; specialist systems retain their governed source evidence.

## Preconditions

1. Canonical person, programme/period and source identifiers are available where applicable.
2. The current policy/rule version and decision authority are configured.
3. Required interfaces use stable identifiers, provenance and reconciliation controls.

## Trigger

A student reaches an award decision point with ratified results.

## Main flow

1. **Award Board** bind the student to award and classification regulations.
2. **Registry** assemble eligible credit, level, residency and professional requirements.
3. **SRS Calculation Service** calculate the default award/classification and exit alternatives.
4. **Delegated Conferment Authority** record board recommendation and authorised discretion.
5. **Registry** obtain conferment under delegated institutional authority.
6. **SRS Calculation Service** create the immutable conferred award and publish the event.

## Alternative flows

### A1 — Variant

- **A1.1** Aegrotat, posthumous and exit awards follow explicit authority/policy.

### A2 — Variant

- **A2.1** Joint, dual and collaborative awards record each awarding responsibility.

## Exception flows

### E1 — Control exception

- **E1.1** Outstanding academic decision defers award.

### E2 — Control exception

- **E2.1** Revocation or correction cannot overwrite the conferred record.

## Postconditions

### Successful

- The award recommendation, conferment and classification is authoritative, effective-dated and linked to its evidence and decision authority.
- Each required consumer has acknowledged the correct version or has an owned reconciliation item.

### Unsuccessful or incomplete

- No unapproved outcome is represented as final; the case retains reason, owner and next action.

## Business rules and controls

| ID | Classification | Rule/control | Applicability | Source |
|---|---|---|---|---|
| BR-1 | SECTOR | Apply the current authoritative requirement and provider regulation for the person, level, mode and nation | UK/configured | SRC-059, SRC-062 |
| BR-2 | INSTITUTION | Decision roles, deadlines, evidence and permitted discretion are policy-versioned | Provider | Provider regulations |
| BR-3 | REVELATION | W011 needs separate recommendation, conferment authority and immutable award fact. | Revelation | SRC-015–SRC-019 |
| BR-4 | PROPOSED | Proposed, approved, rejected and superseded states remain distinguishable | Revelation target | Process control |
| BR-5 | PROPOSED | Corrections append provenance and trigger impact/reconciliation; they do not silently overwrite | Revelation target | Data governance |

## National and institutional variations

### England

Provider award regulations apply within the English regulatory framework.

### Scotland

SCQF levels, ordinary/honours routes and Scottish degree structures require configurable rules.

### Wales

CQFW context, bilingual documentation and awarding/partner responsibilities may apply.

### Northern Ireland

Provider award regulations and Department for the Economy context apply.

### Institutional policy points

Terminology, authority, deadlines, evidence, thresholds, communication, appeals/reviews, partner responsibility and target-system ownership.

## Data impact

| Data concept | Action | System of record | Effective/provenance requirement | Sensitivity |
|---|---|---|---|---|
| award recommendation, conferment and classification | Create/version | SRS or governed specialist source | Policy, actor, evidence, decision and effective/transaction times | Personal; may be sensitive |
| Workflow/case evidence | Append | Owning service | Immutable source and restricted access | Personal/confidential |
| Integration exchange | Append/update | SRS integration ledger | Contract version, correlation, attempts and acknowledgement | Personal |

## Integration impact

| From | To | Information/purpose | Contract/pattern | Failure and reconciliation |
|---|---|---|---|---|
| SRS | documents/HESA/portal | award | Versioned/idempotent contract | Retry, quarantine, acknowledge and reconcile |

## Sequence diagram

```mermaid
sequenceDiagram
    actor A1 as Award Board
    participant A2 as Registry
    participant A3 as SRS Calculation Service
    participant A4 as Delegated Conferment Authority
    A1->>A2: 1. bind the student to award and classification regulations
    A2->>A3: 2. assemble eligible credit, level, residency and professional requirements
    A3->>A4: 3. calculate the default award/classification and exit alternatives
    A4->>A1: 4. record board recommendation and authorised discretion
    A1->>A2: 5. obtain conferment under delegated institutional authority
    A2->>A3: 6. create the immutable conferred award and publish the event
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
| [SRC-059, SRC-062](../source-register.md) | External process, regulatory or sector evidence |
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
