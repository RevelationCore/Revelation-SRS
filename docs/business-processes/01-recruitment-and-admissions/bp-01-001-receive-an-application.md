# BP-001 — Receive an application

> Status: Draft
> Domain: 01 — Recruitment and admissions
> Owner: TBC
> Version: 0.1
> Last reviewed: 2026-07-26
> Review by: 2027-01-26

[Domain index](README.md) · [Domain index](README.md) · [Next: BP-002](../01-recruitment-and-admissions/bp-002-assess-an-application.md) · [Library home](../README.md)

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
| Data entities | application and applicant identity; supporting identity, evidence, decision and integration-exchange records |
| Domain events | Proposed: `srs.receive.an.application.completed` |
| Integration contracts | UCAS/application service → SRS; SRS → Applicant portal |

## Purpose and outcome

Receive an application creates a controlled, explainable and effective-dated application and applicant identity. The outcome preserves the evidence, authority and cross-system state needed for the Revelation SRS rather than reducing the process to a status update.

## Scope

**Starts when:** A UCAS, other admissions-service or direct application arrives.

**Ends when:** The authorised outcome is recorded, communicated and reconciled, or the case is closed with an owned reason.

**In scope:** Intake, validation, evidence, decision, effective dating, communication and downstream reconciliation.

**Out of scope:** Upstream policy creation and later lifecycle processes referenced under Related processes.

## Actors and responsibilities

| Actor/system | Responsibility |
|---|---|
| Prospective Student | Initiates or owns the principal business action |
| Admissions System | Provides evidence, decision, system processing or governed support |
| Admissions Officer | Provides evidence, decision, system processing or governed support |
| Identity Service | Provides evidence, decision, system processing or governed support |

**Accountable owner:** Prospective Student service owner or delegated authority (TBC)

**System of record:** SRS for the student-record outcome; specialist systems retain their governed source evidence.

## Preconditions

1. Canonical person, programme/period and source identifiers are available where applicable.
2. The current policy/rule version and decision authority are configured.
3. Required interfaces use stable identifiers, provenance and reconciliation controls.

## Trigger

A UCAS, other admissions-service or direct application arrives.

## Main flow

1. **Prospective Student** receive the application with channel and cycle identifiers.
2. **Admissions System** validate schema, course/intake and minimum required fields.
3. **Admissions Officer** match or create the applicant identity without merging uncertain matches.
4. **Identity Service** store the immutable received payload and create the working application.
5. **Admissions System** acknowledge receipt and publish the application-received state.
6. **Admissions Officer** route incomplete, duplicate or restricted applications to an owned worklist.

## Alternative flows

### A1 — Variant

- **A1.1** Direct, agent, PGR or partner application uses the same canonical application with channel-specific evidence.

### A2 — Variant

- **A2.1** A later corrected payload creates a version and preserves the original.

## Exception flows

### E1 — Control exception

- **E1.1** Unknown course/intake is quarantined rather than guessed.

### E2 — Control exception

- **E2.1** Probable duplicate identity is held for BP-058.

## Postconditions

### Successful

- The application and applicant identity is authoritative, effective-dated and linked to its evidence and decision authority.
- Each required consumer has acknowledged the correct version or has an owned reconciliation item.

### Unsuccessful or incomplete

- No unapproved outcome is represented as final; the case retains reason, owner and next action.

## Business rules and controls

| ID | Classification | Rule/control | Applicability | Source |
|---|---|---|---|---|
| BR-1 | SECTOR | Apply the current authoritative requirement and provider regulation for the person, level, mode and nation | UK/configured | SRC-051–SRC-053 |
| BR-2 | INSTITUTION | Decision roles, deadlines, evidence and permitted discretion are policy-versioned | Provider | Provider regulations |
| BR-3 | REVELATION | Current W001 does not separate immutable received payload, identity resolution and working application. | Revelation | SRC-015–SRC-019 |
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
| application and applicant identity | Create/version | SRS or governed specialist source | Policy, actor, evidence, decision and effective/transaction times | Personal; may be sensitive |
| Workflow/case evidence | Append | Owning service | Immutable source and restricted access | Personal/confidential |
| Integration exchange | Append/update | SRS integration ledger | Contract version, correlation, attempts and acknowledgement | Personal |

## Integration impact

| From | To | Information/purpose | Contract/pattern | Failure and reconciliation |
|---|---|---|---|---|
| UCAS/application service | SRS | application | Versioned/idempotent contract | Retry, quarantine, acknowledge and reconcile |
| SRS | Applicant portal | acknowledgement | Versioned/idempotent contract | Retry, quarantine, acknowledge and reconcile |

## Sequence diagram

```mermaid
sequenceDiagram
    actor A1 as Prospective Student
    participant A2 as Admissions System
    participant A3 as Admissions Officer
    participant A4 as Identity Service
    A1->>A2: 1. receive the application with channel and cycle identifiers
    A2->>A3: 2. validate schema, course/intake and minimum required fields
    A3->>A4: 3. match or create the applicant identity without merging uncertain matches
    A4->>A1: 4. store the immutable received payload and create the working application
    A1->>A2: 5. acknowledge receipt and publish the application-received state
    A2->>A3: 6. route incomplete, duplicate or restricted applications to an owned worklist
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
