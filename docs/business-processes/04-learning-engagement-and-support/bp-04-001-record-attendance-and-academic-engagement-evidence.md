# BP-027 — Record attendance and academic engagement evidence

> Status: Draft
> Domain: 04 — Learning, engagement and support
> Owner: TBC
> Version: 0.1
> Last reviewed: 2026-07-26
> Review by: 2027-01-26

[Previous: BP-026](../03-curriculum-and-module-registration/bp-026-establish-pgr-supervision.md) · [Domain index](README.md) · [Next: BP-028](../04-learning-engagement-and-support/bp-028-investigate-and-respond-to-non-engagement.md) · [Library home](../README.md)

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
| Revelation workflows | W009 partial |
| Reference-model flows | See integration contract catalogue; confirm detailed F-number mapping during architecture review |
| Functional requirements | See functional requirements; detailed mapping remains an SME/architecture review action |
| Data entities | attendance and engagement evidence; supporting identity, evidence, decision and integration-exchange records |
| Domain events | Proposed: `srs.record.attendance.and.academic.engagement.evidence.completed` |
| Integration contracts | Timetabling/VLE/attendance → SRS |

## Purpose and outcome

Record attendance and academic engagement evidence creates a controlled, explainable and effective-dated attendance and engagement evidence. The outcome preserves the evidence, authority and cross-system state needed for the Revelation SRS rather than reducing the process to a status update.

## Scope

**Starts when:** A scheduled or recognised academic engagement event occurs.

**Ends when:** The authorised outcome is recorded, communicated and reconciled, or the case is closed with an owned reason.

**In scope:** Intake, validation, evidence, decision, effective dating, communication and downstream reconciliation.

**Out of scope:** Upstream policy creation and later lifecycle processes referenced under Related processes.

## Actors and responsibilities

| Actor/system | Responsibility |
|---|---|
| Enrolled Student | Initiates or owns the principal business action |
| Teaching Staff | Provides evidence, decision, system processing or governed support |
| Attendance Monitoring | Provides evidence, decision, system processing or governed support |
| SRS | Provides evidence, decision, system processing or governed support |

**Accountable owner:** Enrolled Student service owner or delegated authority (TBC)

**System of record:** SRS for the student-record outcome; specialist systems retain their governed source evidence.

## Preconditions

1. Canonical person, programme/period and source identifiers are available where applicable.
2. The current policy/rule version and decision authority are configured.
3. Required interfaces use stable identifiers, provenance and reconciliation controls.

## Trigger

A scheduled or recognised academic engagement event occurs.

## Main flow

1. **Enrolled Student** derive expected engagement events from authoritative study activity.
2. **Teaching Staff** capture attended, absent, authorised absence or other evidenced outcome.
3. **Attendance Monitoring** retain event, source, capture method and correction provenance.
4. **SRS** distinguish raw attendance from the provider engagement judgement.
5. **Teaching Staff** publish new evidence to the student engagement view.
6. **Attendance Monitoring** reconcile missing rosters, duplicate scans and late corrections.

## Alternative flows

### A1 — Variant

- **A1.1** PGR, placement, distance and asynchronous activity use approved evidence types.

### A2 — Variant

- **A2.1** Accessibility-related alternative engagement is recorded without exposing diagnosis.

## Exception flows

### E1 — Control exception

- **E1.1** Offline capture is queued with device/time provenance.

### E2 — Control exception

- **E2.1** Disputed evidence is annotated and corrected without destructive overwrite.

## Postconditions

### Successful

- The attendance and engagement evidence is authoritative, effective-dated and linked to its evidence and decision authority.
- Each required consumer has acknowledged the correct version or has an owned reconciliation item.

### Unsuccessful or incomplete

- No unapproved outcome is represented as final; the case retains reason, owner and next action.

## Business rules and controls

| ID | Classification | Rule/control | Applicability | Source |
|---|---|---|---|---|
| BR-1 | SECTOR | Apply the current authoritative requirement and provider regulation for the person, level, mode and nation | UK/configured | SRC-001–SRC-003, SRC-055 |
| BR-2 | INSTITUTION | Decision roles, deadlines, evidence and permitted discretion are policy-versioned | Provider | Provider regulations |
| BR-3 | REVELATION | Current coverage lacks a canonical expected-event/evidence model and source-level correction history. | Revelation | SRC-015–SRC-019 |
| BR-4 | PROPOSED | Proposed, approved, rejected and superseded states remain distinguishable | Revelation target | Process control |
| BR-5 | PROPOSED | Corrections append provenance and trigger impact/reconciliation; they do not silently overwrite | Revelation target | Data governance |

## National and institutional variations

### England

Provider policy operates alongside English regulatory conditions and, where applicable, Student sponsor duties.

### Scotland

Provider regulations and Scottish academic terminology apply; funding and support ownership may differ.

### Wales

Provider regulations, Welsh-language communication and Medr context apply.

### Northern Ireland

Provider regulations and Department for the Economy context apply.

### Institutional policy points

Terminology, authority, deadlines, evidence, thresholds, communication, appeals/reviews, partner responsibility and target-system ownership.

## Data impact

| Data concept | Action | System of record | Effective/provenance requirement | Sensitivity |
|---|---|---|---|---|
| attendance and engagement evidence | Create/version | SRS or governed specialist source | Policy, actor, evidence, decision and effective/transaction times | Personal; may be sensitive |
| Workflow/case evidence | Append | Owning service | Immutable source and restricted access | Personal/confidential |
| Integration exchange | Append/update | SRS integration ledger | Contract version, correlation, attempts and acknowledgement | Personal |

## Integration impact

| From | To | Information/purpose | Contract/pattern | Failure and reconciliation |
|---|---|---|---|---|
| Timetabling/VLE/attendance | SRS | engagement evidence | Versioned/idempotent contract | Retry, quarantine, acknowledge and reconcile |

## Sequence diagram

```mermaid
sequenceDiagram
    actor A1 as Enrolled Student
    participant A2 as Teaching Staff
    participant A3 as Attendance Monitoring
    participant A4 as SRS
    A1->>A2: 1. derive expected engagement events from authoritative study activity
    A2->>A3: 2. capture attended, absent, authorised absence or other evidenced outcome
    A3->>A4: 3. retain event, source, capture method and correction provenance
    A4->>A1: 4. distinguish raw attendance from the provider engagement judgement
    A1->>A2: 5. publish new evidence to the student engagement view
    A2->>A3: 6. reconcile missing rosters, duplicate scans and late corrections
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
| [SRC-001–SRC-003, SRC-055](../source-register.md) | External process, regulatory or sector evidence |
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
