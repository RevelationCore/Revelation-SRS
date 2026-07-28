# BP-06-003 — Determine and confer an award

> Status: Draft
> Domain: 06 — Progression, awards and graduation
> Owner: TBC
> Version: 0.1
> Last reviewed: 2026-07-26
> Review by: 2027-01-26

[Previous: BP-06-002](../06-progression-awards-and-graduation/bp-06-002-manage-reassessment-referral-or-repeat-study.md) · [Domain index](README.md) · [Next: BP-06-004](../06-progression-awards-and-graduation/bp-06-004-issue-award-documentation-and-hear.md) · [Library home](../README.md)

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

This process turns a student's accumulated, ratified results into a formal award decision: what qualification they have earned, at what classification, and under whose authority it was conferred. Because conferment is a legally and reputationally significant act, the process keeps the board's recommendation, the exercise of delegated conferment authority, and the resulting immutable award fact as distinct, evidenced steps rather than a single undifferentiated approval. Once conferred, the award record cannot be silently changed; any later correction or revocation is applied as a new, evidenced event so the qualification's history remains fully accountable.

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

1. **Award Board** confirms the award and classification regulations applicable to the student, so the record is bound to that regulation set.
2. **Registry** assembles eligible credit, level, residency and professional requirements.
3. **SRS Calculation Service** calculates the default award/classification and exit alternatives.
4. **Registry** records the board's recommendation and any authorised discretion.
5. **Delegated Conferment Authority** confers the award under delegated institutional authority.
6. **SRS Calculation Service** creates the immutable conferred award and publishes the event.

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
    actor Board as Award Board
    participant Registry
    participant Calc as SRS Calculation Service
    actor DCA as Delegated Conferment Authority

    Board->>Registry: 1. Confirm award/classification regulations; bind student record
    Registry->>Calc: 2. Assemble eligible credit, level, residency and professional requirements
    Calc->>Registry: 3. Calculate the default award/classification and exit alternatives
    Registry->>DCA: 4. Record the board's recommendation and authorised discretion
    DCA->>Calc: 5. Confer the award under delegated institutional authority
    Calc->>Calc: 6. Create the immutable conferred award; publish the event
    alt E1 — Outstanding academic decision
        Board-->>Registry: E1.1 Defer the award pending the outstanding decision
    else E2 — Revocation or correction required
        Calc-->>Registry: E2.1 Record revocation/correction without overwriting the conferred record
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
