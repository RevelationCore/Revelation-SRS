# BP-050 — Prepare and submit HESA student data

> Status: Draft
> Domain: 07 — Regulatory and statutory reporting
> Owner: TBC
> Version: 0.1
> Last reviewed: 2026-07-26
> Review by: 2027-01-26

[Previous: BP-049](../06-progression-awards-and-graduation/bp-049-record-successful-pgr-completion.md) · [Domain index](README.md) · [Next: BP-051](../07-regulatory-and-statutory-reporting/bp-051-exchange-registration-attendance-and-changes-with-student-finance-bodies.md) · [Library home](../README.md)

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
| Revelation workflows | W008 |
| Reference-model flows | See integration contract catalogue; confirm detailed F-number mapping during architecture review |
| Functional requirements | See functional requirements; detailed mapping remains an SME/architecture review action |
| Data entities | collection snapshot, validation, submission and sign-off; supporting identity, evidence, decision and integration-exchange records |
| Domain events | Proposed: `srs.prepare.and.submit.hesa.student.data.completed` |
| Integration contracts | SRS → HESA/Jisc |

## Purpose and outcome

Prepare and submit HESA student data creates a controlled, explainable and effective-dated collection snapshot, validation, submission and sign-off. The outcome preserves the evidence, authority and cross-system state needed for the Revelation SRS rather than reducing the process to a status update.

## Scope

**Starts when:** A HESA collection/reference period reaches an extraction or quality checkpoint.

**Ends when:** The authorised outcome is recorded, communicated and reconciled, or the case is closed with an owned reason.

**In scope:** Intake, validation, evidence, decision, effective dating, communication and downstream reconciliation.

**Out of scope:** Upstream policy creation and later lifecycle processes referenced under Related processes.

## Actors and responsibilities

| Actor/system | Responsibility |
|---|---|
| Statutory Data Officer | Initiates or owns the principal business action |
| Data Owners | Provides evidence, decision, system processing or governed support |
| SRS | Provides evidence, decision, system processing or governed support |
| HESA/Jisc Platform | Provides evidence, decision, system processing or governed support |

**Accountable owner:** Statutory Data Officer service owner or delegated authority (TBC)

**System of record:** SRS for the student-record outcome; specialist systems retain their governed source evidence.

## Preconditions

1. Canonical person, programme/period and source identifiers are available where applicable.
2. The current policy/rule version and decision authority are configured.
3. Required interfaces use stable identifiers, provenance and reconciliation controls.

## Trigger

A HESA collection/reference period reaches an extraction or quality checkpoint.

## Main flow

1. **Statutory Data Officer** freeze collection specification, reference dates and provider scope.
2. **Data Owners** extract source facts with field-level lineage.
3. **SRS** transform to the required entities/codes without changing source meaning.
4. **HESA/Jisc Platform** run local and platform validation and triage quality queries.
5. **Data Owners** obtain accountable sign-off and submit the versioned return.
6. **SRS** retain receipt, quality outputs, amendments and reproducible snapshot.

## Alternative flows

### A1 — Variant

- **A1.1** Student, staff-linked or in-year collection variants use their own specification.

### A2 — Variant

- **A2.1** Partner provision records reporting responsibility.

## Exception flows

### E1 — Control exception

- **E1.1** Specification ambiguity is logged as a decision, not silently coded.

### E2 — Control exception

- **E2.1** Submission rejection returns to controlled correction and resubmission.

## Postconditions

### Successful

- The collection snapshot, validation, submission and sign-off is authoritative, effective-dated and linked to its evidence and decision authority.
- Each required consumer has acknowledged the correct version or has an owned reconciliation item.

### Unsuccessful or incomplete

- No unapproved outcome is represented as final; the case retains reason, owner and next action.

## Business rules and controls

| ID | Classification | Rule/control | Applicability | Source |
|---|---|---|---|---|
| BR-1 | SECTOR | Apply the current authoritative requirement and provider regulation for the person, level, mode and nation | UK/configured | SRC-064 |
| BR-2 | INSTITUTION | Decision roles, deadlines, evidence and permitted discretion are policy-versioned | Provider | Provider regulations |
| BR-3 | REVELATION | W008 needs field lineage, specification version, sign-off and reproducible snapshot. | Revelation | SRC-015–SRC-019 |
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
| collection snapshot, validation, submission and sign-off | Create/version | SRS or governed specialist source | Policy, actor, evidence, decision and effective/transaction times | Personal; may be sensitive |
| Workflow/case evidence | Append | Owning service | Immutable source and restricted access | Personal/confidential |
| Integration exchange | Append/update | SRS integration ledger | Contract version, correlation, attempts and acknowledgement | Personal |

## Integration impact

| From | To | Information/purpose | Contract/pattern | Failure and reconciliation |
|---|---|---|---|---|
| SRS | HESA/Jisc | statutory return | Versioned/idempotent contract | Retry, quarantine, acknowledge and reconcile |

## Sequence diagram

```mermaid
sequenceDiagram
    actor A1 as Statutory Data Officer
    participant A2 as Data Owners
    participant A3 as SRS
    participant A4 as HESA/Jisc Platform
    A1->>A2: 1. freeze collection specification, reference dates and provider scope
    A2->>A3: 2. extract source facts with field-level lineage
    A3->>A4: 3. transform to the required entities/codes without changing source meaning
    A4->>A1: 4. run local and platform validation and triage quality queries
    A1->>A2: 5. obtain accountable sign-off and submit the versioned return
    A2->>A3: 6. retain receipt, quality outputs, amendments and reproducible snapshot
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
| [SRC-064](../source-register.md) | External process, regulatory or sector evidence |
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
