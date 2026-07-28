# BP-07-006 — Produce Medr regulatory and funding returns

> Status: Draft
> Domain: 07 — Regulatory and statutory reporting
> Owner: TBC
> Version: 0.1
> Last reviewed: 2026-07-26
> Review by: 2027-01-26

[Previous: BP-07-005](../07-regulatory-and-statutory-reporting/bp-07-005-produce-scottish-funding-council-returns.md) · [Domain index](README.md) · [Next: BP-07-007](../07-regulatory-and-statutory-reporting/bp-07-007-produce-department-for-the-economy-returns.md) · [Library home](../README.md)

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
| Data entities | Medr return/analysis output and sign-off; supporting identity, evidence, decision and integration-exchange records |
| Domain events | Proposed: `srs.produce.medr.regulatory.and.funding.returns.completed` |
| Integration contracts | SRS/HESA snapshot → Medr |

## Purpose and outcome

Producing Medr regulatory and funding returns turns the institution's Welsh-medium, funding and apprenticeship data into the return Medr requires, built from a frozen population and definitions so the figures cannot silently drift while the return is being prepared. Validating funding, equality, apprenticeship and Welsh-medium classifications against the institution's own records before sign-off catches a misclassification before it reaches the regulator. Outputs, queries, corrections and a reproducible snapshot of what was submitted are all retained together.

## Scope

**Starts when:** A Medr data requirement or funding return reaches its extraction date.

**Ends when:** The authorised outcome is recorded, communicated and reconciled, or the case is closed with an owned reason.

**In scope:** Intake, validation, evidence, decision, effective dating, communication and downstream reconciliation.

**Out of scope:** Upstream policy creation and later lifecycle processes referenced under Related processes.

## Actors and responsibilities

| Actor/system | Responsibility |
|---|---|
| Medr Returns Officer | Initiates or owns the principal business action |
| Data Owners | Provides evidence, decision, system processing or governed support |
| Accountable Signatory | Provides evidence, decision, system processing or governed support |
| Medr | Provides evidence, decision, system processing or governed support |

**Accountable owner:** Medr Returns Officer service owner or delegated authority (TBC)

**System of record:** SRS for the student-record outcome; specialist systems retain their governed source evidence.

## Preconditions

1. Canonical person, programme/period and source identifiers are available where applicable.
2. The current policy/rule version and decision authority are configured.
3. Required interfaces use stable identifiers, provenance and reconciliation controls.

## Trigger

A Medr data requirement or funding return reaches its extraction date.

## Main flow

1. **Medr Returns Officer** confirm provider type, requirement, HESA dependency and deadline.
2. **Data Owners** freeze population, Welsh-medium and funding definitions.
3. **Data Owners** extract with lineage and applicable IRIS/data-quality mappings.
4. **Medr Returns Officer** validate funding, equality, apprenticeship and Welsh-medium uses.
5. **Data Owners** sign off and submit through the specified channel.
6. **Accountable Signatory** retain outputs, queries, corrections and reproducible snapshot.

## Alternative flows

### A1 — Variant

- **A1.1** Funded HE, FE-delivered HE and specifically designated provision have different scope.

### A2 — Variant

- **A2.1** HESA-derived analysis is reconciled to the signed HESA version.

## Exception flows

### E1 — Control exception

- **E1.1** Provider-scope ambiguity is resolved with Medr.

### E2 — Control exception

- **E2.1** Quality-query correction follows BP-07-008.

## Postconditions

### Successful

- The Medr return/analysis output and sign-off is authoritative, effective-dated and linked to its evidence and decision authority.
- Each required consumer has acknowledged the correct version or has an owned reconciliation item.

### Unsuccessful or incomplete

- No unapproved outcome is represented as final; the case retains reason, owner and next action.

## Business rules and controls

| ID | Classification | Rule/control | Applicability | Source |
|---|---|---|---|---|
| BR-1 | SECTOR | Apply the current authoritative requirement and provider regulation for the person, level, mode and nation | UK/configured | SRC-068 |
| BR-2 | INSTITUTION | Decision roles, deadlines, evidence and permitted discretion are policy-versioned | Provider | Provider regulations |
| BR-3 | REVELATION | No Medr-specific workflow or Welsh-medium/funding lineage exists. | Revelation | SRC-015–SRC-019 |
| BR-4 | PROPOSED | Proposed, approved, rejected and superseded states remain distinguishable | Revelation target | Process control |
| BR-5 | PROPOSED | Corrections append provenance and trigger impact/reconciliation; they do not silently overwrite | Revelation target | Data governance |

## National and institutional variations

### England

OfS and other England-specific requirements apply only to providers in scope.

### Scotland

SFC and SAAS requirements apply in addition to UK-wide collections; do not reuse England-only codes.

### Wales

Medr and Student Finance Wales requirements apply, including Welsh-medium data uses.

### Northern Ireland

Department for the Economy and Student Finance NI requirements apply.

### Institutional policy points

Terminology, authority, deadlines, evidence, thresholds, communication, appeals/reviews, partner responsibility and target-system ownership.

## Data impact

| Data concept | Action | System of record | Effective/provenance requirement | Sensitivity |
|---|---|---|---|---|
| Medr return/analysis output and sign-off | Create/version | SRS or governed specialist source | Policy, actor, evidence, decision and effective/transaction times | Personal; may be sensitive |
| Workflow/case evidence | Append | Owning service | Immutable source and restricted access | Personal/confidential |
| Integration exchange | Append/update | SRS integration ledger | Contract version, correlation, attempts and acknowledgement | Personal |

## Integration impact

| From | To | Information/purpose | Contract/pattern | Failure and reconciliation |
|---|---|---|---|---|
| SRS/HESA snapshot | Medr | return/quality evidence | Versioned/idempotent contract | Retry, quarantine, acknowledge and reconcile |

## Sequence diagram

```mermaid
sequenceDiagram
    actor A1 as Medr Returns Officer
    participant A2 as Data Owners
    participant A3 as Accountable Signatory
    participant A4 as Medr
    A1->>A2: 1. confirms provider type, requirement, HESA dependency and deadline
    A2->>A2: 2. freezes population, Welsh-medium and funding definitions
    A2->>A1: 3. extracts with lineage and applicable IRIS/data-quality mappings
    A1->>A2: 4. validates funding, equality, apprenticeship and Welsh-medium uses
    A2->>A4: 5. signs off and submits through the specified channel
    A3->>A3: 6. retains outputs, queries, corrections and reproducible snapshot
    alt Valid and authorised
        A3->>A1: Record and communicate outcome
    else Incomplete or exception
        A3->>A1: Retain case with owner and reason
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
| [SRC-068](../source-register.md) | External process, regulatory or sector evidence |
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
