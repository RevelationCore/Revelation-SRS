# BP-034 — Create examination entries and accommodations

> Status: Draft
> Domain: 05 — Assessment and results
> Owner: TBC
> Version: 0.1
> Last reviewed: 2026-07-26
> Review by: 2027-01-26

[Previous: BP-033](../05-assessment-and-results/bp-033-establish-assessment-structures.md) · [Domain index](README.md) · [Next: BP-035](../05-assessment-and-results/bp-035-receive-or-enter-marks.md) · [Library home](../README.md)

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
| Revelation workflows | W005 partial |
| Reference-model flows | See integration contract catalogue; confirm detailed F-number mapping during architecture review |
| Functional requirements | See functional requirements; detailed mapping remains an SME/architecture review action |
| Data entities | exam entry, candidate and accommodation; supporting identity, evidence, decision and integration-exchange records |
| Domain events | Proposed: `srs.create.examination.entries.and.accommodations.completed` |
| Integration contracts | SRS ↔ exam scheduling |

## Purpose and outcome

Create examination entries and accommodations creates a controlled, explainable and effective-dated exam entry, candidate and accommodation. The outcome preserves the evidence, authority and cross-system state needed for the Revelation SRS rather than reducing the process to a status update.

## Scope

**Starts when:** Confirmed registrations and assessment patterns require exam scheduling.

**Ends when:** The authorised outcome is recorded, communicated and reconciled, or the case is closed with an owned reason.

**In scope:** Intake, validation, evidence, decision, effective dating, communication and downstream reconciliation.

**Out of scope:** Upstream policy creation and later lifecycle processes referenced under Related processes.

## Actors and responsibilities

| Actor/system | Responsibility |
|---|---|
| Examinations Officer | Initiates or owns the principal business action |
| SRS | Provides evidence, decision, system processing or governed support |
| Exam Scheduling | Provides evidence, decision, system processing or governed support |
| Disability Support | Provides evidence, decision, system processing or governed support |

**Accountable owner:** Examinations Officer service owner or delegated authority (TBC)

**System of record:** SRS for the student-record outcome; specialist systems retain their governed source evidence.

## Preconditions

1. Canonical person, programme/period and source identifiers are available where applicable.
2. The current policy/rule version and decision authority are configured.
3. Required interfaces use stable identifiers, provenance and reconciliation controls.

## Trigger

Confirmed registrations and assessment patterns require exam scheduling.

## Main flow

1. **Examinations Officer** derive eligible candidates from effective registrations and attempt status.
2. **SRS** apply approved accommodations as minimum operational instructions.
3. **Exam Scheduling** validate identity, clashes, location and assessment eligibility.
4. **Disability Support** publish entries and accommodation requirements to scheduling.
5. **SRS** receive seat/session allocations and expose them securely.
6. **Exam Scheduling** reconcile adds, withdrawals and late changes before the examination.

## Alternative flows

### A1 — Variant

- **A1.1** Alternative assessment, overseas or remote arrangements use approved entry types.

### A2 — Variant

- **A2.1** Late approved accommodations trigger controlled rescheduling.

## Exception flows

### E1 — Control exception

- **E1.1** Missing eligibility or conflicting attempt is held.

### E2 — Control exception

- **E2.1** Sensitive evidence is never sent with the accommodation instruction.

## Postconditions

### Successful

- The exam entry, candidate and accommodation is authoritative, effective-dated and linked to its evidence and decision authority.
- Each required consumer has acknowledged the correct version or has an owned reconciliation item.

### Unsuccessful or incomplete

- No unapproved outcome is represented as final; the case retains reason, owner and next action.

## Business rules and controls

| ID | Classification | Rule/control | Applicability | Source |
|---|---|---|---|---|
| BR-1 | SECTOR | Apply the current authoritative requirement and provider regulation for the person, level, mode and nation | UK/configured | SRC-017, SRC-057, SRC-059 |
| BR-2 | INSTITUTION | Decision roles, deadlines, evidence and permitted discretion are policy-versioned | Provider | Provider regulations |
| BR-3 | REVELATION | W005 lacks a durable candidate-entry and accommodation reconciliation lifecycle. | Revelation | SRC-015–SRC-019 |
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
| exam entry, candidate and accommodation | Create/version | SRS or governed specialist source | Policy, actor, evidence, decision and effective/transaction times | Personal; may be sensitive |
| Workflow/case evidence | Append | Owning service | Immutable source and restricted access | Personal/confidential |
| Integration exchange | Append/update | SRS integration ledger | Contract version, correlation, attempts and acknowledgement | Personal |

## Integration impact

| From | To | Information/purpose | Contract/pattern | Failure and reconciliation |
|---|---|---|---|---|
| SRS ↔ exam scheduling | Connected system | entries/accommodations | Versioned/idempotent contract | Retry, quarantine, acknowledge and reconcile |

## Sequence diagram

```mermaid
sequenceDiagram
    actor A1 as Examinations Officer
    participant A2 as SRS
    participant A3 as Exam Scheduling
    participant A4 as Disability Support
    A1->>A2: 1. derive eligible candidates from effective registrations and attempt status
    A2->>A3: 2. apply approved accommodations as minimum operational instructions
    A3->>A4: 3. validate identity, clashes, location and assessment eligibility
    A4->>A1: 4. publish entries and accommodation requirements to scheduling
    A1->>A2: 5. receive seat/session allocations and expose them securely
    A2->>A3: 6. reconcile adds, withdrawals and late changes before the examination
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
| [SRC-017, SRC-057, SRC-059](../source-register.md) | External process, regulatory or sector evidence |
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
