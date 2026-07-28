# BP-01-004 — Confirm offer conditions

> Status: Draft
> Domain: 01 — Recruitment and admissions
> Owner: TBC
> Version: 0.1
> Last reviewed: 2026-07-26
> Review by: 2027-01-26

[Previous: BP-01-003](../01-recruitment-and-admissions/bp-01-003-make-and-manage-an-offer.md) · [Domain index](README.md) · [Next: BP-01-005](../01-recruitment-and-admissions/bp-01-005-create-and-assign-a-cas.md) · [Library home](../README.md)

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
| Revelation workflows | W001 |
| Reference-model flows | See integration contract catalogue; confirm detailed F-number mapping during architecture review |
| Functional requirements | See functional requirements; detailed mapping remains an SME/architecture review action |
| Data entities | condition evidence, verification and confirmation decision; supporting identity, evidence, decision and integration-exchange records |
| Domain events | Proposed: `srs.confirm.offer.conditions.completed` |
| Integration contracts | Awarding/results services → SRS; SRS ↔ UCAS |

## Purpose and outcome

Confirming offer conditions turns exam results or other required evidence into a definitive decision on whether a conditional offer is met. Each condition is tested individually against verified evidence, so a partial or borderline result can be resolved fairly rather than defaulting to an all-or-nothing outcome, and the institution retains a clear record of what evidence supported the confirmation and who authorised it.

## Scope

**Starts when:** Evidence or examination results become available for a conditional offer.

**Ends when:** The authorised outcome is recorded, communicated and reconciled, or the case is closed with an owned reason.

**In scope:** Intake, validation, evidence, decision, effective dating, communication and downstream reconciliation.

**Out of scope:** Upstream policy creation and later lifecycle processes referenced under Related processes.

## Actors and responsibilities

| Actor/system | Responsibility |
|---|---|
| Prospective Student | Initiates or owns the principal business action |
| Admissions Officer | Provides evidence, decision, system processing or governed support |
| Qualification/Results Service | Provides evidence, decision, system processing or governed support |
| Admissions System | Provides evidence, decision, system processing or governed support |

**Accountable owner:** Prospective Student service owner or delegated authority (TBC)

**System of record:** SRS for the student-record outcome; specialist systems retain their governed source evidence.

## Preconditions

1. Canonical person, programme/period and source identifiers are available where applicable.
2. The current policy/rule version and decision authority are configured.
3. Required interfaces use stable identifiers, provenance and reconciliation controls.

## Trigger

Evidence or examination results become available for a conditional offer.

## Main flow

1. **Admissions System** freeze the offer and condition versions being tested.
2. **Admissions Officer** receive results or applicant evidence and record their provenance.
3. **Qualification/Results Service** verify authenticity and map evidence to each condition.
4. **Admissions System** record met, waived, unmet or pending per condition with authority.
5. **Admissions Officer** make the overall confirmation decision including authorised alternatives.
6. **Admissions System** publish and reconcile the outcome with the applicant channel.

## Alternative flows

### A1 — Variant

- **A1.1** A narrowly missed condition may produce an authorised changed-course offer.

### A2 — Variant

- **A2.1** A non-academic condition can remain pending after academic confirmation only where policy permits.

## Exception flows

### E1 — Control exception

- **E1.1** Embargoed results remain access-controlled until release.

### E2 — Control exception

- **E2.1** Conflicting or unverifiable evidence holds confirmation for review.

## Postconditions

### Successful

- The condition evidence, verification and confirmation decision is authoritative, effective-dated and linked to its evidence and decision authority.
- Each required consumer has acknowledged the correct version or has an owned reconciliation item.

### Unsuccessful or incomplete

- No unapproved outcome is represented as final; the case retains reason, owner and next action.

## Business rules and controls

| ID | Classification | Rule/control | Applicability | Source |
|---|---|---|---|---|
| BR-1 | SECTOR | Apply the current authoritative requirement and provider regulation for the person, level, mode and nation | UK/configured | SRC-051–SRC-053 |
| BR-2 | INSTITUTION | Decision roles, deadlines, evidence and permitted discretion are policy-versioned | Provider | Provider regulations |
| BR-3 | REVELATION | Per-condition evidence and confirmation authority are not fully modelled. | Revelation | SRC-015–SRC-019 |
| BR-4 | PROPOSED | Proposed, approved, rejected and superseded states remain distinguishable | Revelation target | Process control |
| BR-5 | PROPOSED | Corrections append provenance and trigger impact/reconciliation; they do not silently overwrite | Revelation target | Data governance |

## National and institutional variations

### England

UCAS cycle rules and provider admissions policy apply; qualification and safeguarding routes may differ by applicant.

### Scotland

Qualifications Scotland result dates, Scottish qualifications and typically four-year degree entry patterns must be configurable.

### Wales

Welsh-language service and communication preferences, Welsh qualifications and provider policy must be preserved.

### Northern Ireland

Northern Ireland qualifications, cross-border applicants and provider admissions policy must be supported.

### Institutional policy points

Terminology, authority, deadlines, evidence, thresholds, communication, appeals/reviews, partner responsibility and target-system ownership.

## Data impact

| Data concept | Action | System of record | Effective/provenance requirement | Sensitivity |
|---|---|---|---|---|
| condition evidence, verification and confirmation decision | Create/version | SRS or governed specialist source | Policy, actor, evidence, decision and effective/transaction times | Personal; may be sensitive |
| Workflow/case evidence | Append | Owning service | Immutable source and restricted access | Personal/confidential |
| Integration exchange | Append/update | SRS integration ledger | Contract version, correlation, attempts and acknowledgement | Personal |

## Integration impact

| From | To | Information/purpose | Contract/pattern | Failure and reconciliation |
|---|---|---|---|---|
| Awarding/results services | SRS | results | Versioned/idempotent contract | Retry, quarantine, acknowledge and reconcile |
| SRS ↔ UCAS | Connected system | confirmation decision | Versioned/idempotent contract | Retry, quarantine, acknowledge and reconcile |

## Sequence diagram

```mermaid
sequenceDiagram
    actor A1 as Prospective Student
    participant A2 as Admissions Officer
    participant A3 as Qualification/Results Service
    participant A4 as Admissions System
    A4->>A4: 1. freezes the offer and condition versions being tested
    A1->>A2: 2. Admissions Officer receives results or applicant evidence and records their provenance
    A2->>A3: 3. verifies authenticity and maps evidence to each condition
    A3->>A4: 4. records met, waived, unmet or pending per condition with authority
    A4->>A2: 5. Admissions Officer makes the overall confirmation decision including authorised alternatives
    A4->>A1: 6. publishes and reconciles the outcome with the applicant channel
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
| [SRC-051–SRC-053](../source-register.md) | External process, regulatory or sector evidence |
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
