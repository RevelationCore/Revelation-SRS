# BP-01-007 — Convert an accepted applicant to a prospective student record

> Status: Draft
> Domain: 01 — Recruitment and admissions
> Owner: TBC
> Version: 0.1
> Last reviewed: 2026-07-26
> Review by: 2027-01-26

[Previous: BP-01-006](../01-recruitment-and-admissions/bp-01-006-place-an-applicant-through-clearing.md) · [Domain index](README.md) · [Next: BP-02-001](../02-registration-and-student-status/bp-02-001-prepare-initial-registration.md) · [Library home](../README.md)

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
| Data entities | person, accepted application and registration precursor; supporting identity, evidence, decision and integration-exchange records |
| Domain events | Proposed: `srs.convert.an.accepted.applicant.to.a.prospective.student.record.completed` |
| Integration contracts | SRS → IAM/portal; Admissions → SRS |

## Purpose and outcome

Converting an accepted applicant to a prospective student record turns admissions data into the identity and access foundation the student needs before arrival, without creating a second, disconnected record for the same person. Identifiers are allocated once and reused if the person already has one, only governed facts — not the whole application — are copied forward, and pre-arrival services such as IT accounts are provisioned from that single, traceable source, so the student's eventual registration in BP-02-001 starts from one clean, correctly identified record.

## Scope

**Starts when:** An accepted and sufficiently confirmed applicant becomes eligible for pre-registration.

**Ends when:** The authorised outcome is recorded, communicated and reconciled, or the case is closed with an owned reason.

**In scope:** Intake, validation, evidence, decision, effective dating, communication and downstream reconciliation.

**Out of scope:** Upstream policy creation and later lifecycle processes referenced under Related processes.

## Actors and responsibilities

| Actor/system | Responsibility |
|---|---|
| Admissions System | Initiates or owns the principal business action |
| Registry | Provides evidence, decision, system processing or governed support |
| Identity and Access Management | Provides evidence, decision, system processing or governed support |
| Prospective Student | Provides evidence, decision, system processing or governed support |

**Accountable owner:** Admissions System service owner or delegated authority (TBC)

**System of record:** SRS for the student-record outcome; specialist systems retain their governed source evidence.

## Preconditions

1. Canonical person, programme/period and source identifiers are available where applicable.
2. The current policy/rule version and decision authority are configured.
3. Required interfaces use stable identifiers, provenance and reconciliation controls.

## Trigger

An accepted and sufficiently confirmed applicant becomes eligible for pre-registration.

## Main flow

1. **Admissions System** verify the accepted application, offer and identity resolution status.
2. **Registry** allocate or reuse the canonical person and student identifiers.
3. **Identity and Access Management** copy only governed facts with source provenance rather than duplicating the application.
4. **Registry** create the prospective-student/registration-precursor state.
5. **Registry** publish identifiers to authorised pre-arrival services.
6. **Identity and Access Management** reconcile downstream acknowledgements and route the person to BP-02-001.

## Alternative flows

### A1 — Variant

- **A1.1** Multiple accepted applications resolve to one selected enrolment intention.

### A2 — Variant

- **A2.1** Deferred entry creates a future precursor without premature active-student status.

## Exception flows

### E1 — Control exception

- **E1.1** Uncertain identity routes to BP-08-001.

### E2 — Control exception

- **E2.1** A failed downstream account does not cause a second person/student record.

## Postconditions

### Successful

- The person, accepted application and registration precursor is authoritative, effective-dated and linked to its evidence and decision authority.
- Each required consumer has acknowledged the correct version or has an owned reconciliation item.

### Unsuccessful or incomplete

- No unapproved outcome is represented as final; the case retains reason, owner and next action.

## Business rules and controls

| ID | Classification | Rule/control | Applicability | Source |
|---|---|---|---|---|
| BR-1 | SECTOR | Apply the current authoritative requirement and provider regulation for the person, level, mode and nation | UK/configured | SRC-015–SRC-019 |
| BR-2 | INSTITUTION | Decision roles, deadlines, evidence and permitted discretion are policy-versioned | Provider | Provider regulations |
| BR-3 | REVELATION | The conversion boundary and idempotent identity/identifier allocation need explicit controls. | Revelation | SRC-015–SRC-019 |
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
| person, accepted application and registration precursor | Create/version | SRS or governed specialist source | Policy, actor, evidence, decision and effective/transaction times | Personal; may be sensitive |
| Workflow/case evidence | Append | Owning service | Immutable source and restricted access | Personal/confidential |
| Integration exchange | Append/update | SRS integration ledger | Contract version, correlation, attempts and acknowledgement | Personal |

## Integration impact

| From | To | Information/purpose | Contract/pattern | Failure and reconciliation |
|---|---|---|---|---|
| SRS | IAM/portal | pre-arrival identity | Versioned/idempotent contract | Retry, quarantine, acknowledge and reconcile |
| Admissions | SRS | accepted applicant | Versioned/idempotent contract | Retry, quarantine, acknowledge and reconcile |

## Sequence diagram

```mermaid
sequenceDiagram
    actor A1 as Admissions System
    participant A2 as Registry
    participant A3 as Identity and Access Management
    participant A4 as Prospective Student
    A1->>A2: 1. verifies the accepted application, offer and identity resolution status
    A2->>A3: 2. allocates or reuses the canonical person and student identifiers
    A3->>A2: 3. copies only governed facts with source provenance rather than duplicating the application
    A2->>A2: 4. creates the prospective-student/registration-precursor state
    A2->>A3: 5. publishes identifiers to authorised pre-arrival services
    A3->>A4: 6. reconciles downstream acknowledgements and routes the person to BP-02-001
    alt Valid and authorised
        A3->>A4: Record and communicate outcome
    else Incomplete or exception
        A3->>A4: Retain case with owner and reason
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
| [SRC-015–SRC-019](../source-register.md) | External process, regulatory or sector evidence |
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
