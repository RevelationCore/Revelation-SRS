# BP-051 — Exchange registration, attendance and changes with student finance bodies

> Status: Draft
> Domain: 07 — Regulatory and statutory reporting
> Owner: TBC
> Version: 0.1
> Last reviewed: 2026-07-26
> Review by: 2027-01-26

[Previous: BP-050](../07-regulatory-and-statutory-reporting/bp-050-prepare-and-submit-hesa-student-data.md) · [Domain index](README.md) · [Next: BP-052](../07-regulatory-and-statutory-reporting/bp-052-manage-student-sponsor-reporting-and-compliance.md) · [Library home](../README.md)

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
| Revelation workflows | W001/W007/W010 |
| Reference-model flows | See integration contract catalogue; confirm detailed F-number mapping during architecture review |
| Functional requirements | See functional requirements; detailed mapping remains an SME/architecture review action |
| Data entities | finance-body confirmation/notification and response; supporting identity, evidence, decision and integration-exchange records |
| Domain events | Proposed: `srs.exchange.registration.attendance.and.changes.with.student.finance.bodies.completed` |
| Integration contracts | SRS ↔ SLC/SAAS/national body |

## Purpose and outcome

Exchange registration, attendance and changes with student finance bodies creates a controlled, explainable and effective-dated finance-body confirmation/notification and response. The outcome preserves the evidence, authority and cross-system state needed for the Revelation SRS rather than reducing the process to a status update.

## Scope

**Starts when:** A funded student reaches a reportable registration, attendance or circumstance event.

**Ends when:** The authorised outcome is recorded, communicated and reconciled, or the case is closed with an owned reason.

**In scope:** Intake, validation, evidence, decision, effective dating, communication and downstream reconciliation.

**Out of scope:** Upstream policy creation and later lifecycle processes referenced under Related processes.

## Actors and responsibilities

| Actor/system | Responsibility |
|---|---|
| Student Finance Officer | Initiates or owns the principal business action |
| SRS | Provides evidence, decision, system processing or governed support |
| SLC/National Finance Body | Provides evidence, decision, system processing or governed support |
| Enrolled Student | Provides evidence, decision, system processing or governed support |

**Accountable owner:** Student Finance Officer service owner or delegated authority (TBC)

**System of record:** SRS for the student-record outcome; specialist systems retain their governed source evidence.

## Preconditions

1. Canonical person, programme/period and source identifiers are available where applicable.
2. The current policy/rule version and decision authority are configured.
3. Required interfaces use stable identifiers, provenance and reconciliation controls.

## Trigger

A funded student reaches a reportable registration, attendance or circumstance event.

## Main flow

1. **Student Finance Officer** identify scheme, domicile, course and reporting responsibility.
2. **SRS** validate identity, attendance/registration status and effective dates.
3. **SLC/National Finance Body** create the scheme-specific confirmation or change notification.
4. **Enrolled Student** submit with correlation/idempotency identifiers.
5. **SRS** record response, rejection and payment-impact status.
6. **SLC/National Finance Body** reconcile periodic lists and correct authoritative source facts where needed.

## Alternative flows

### A1 — Variant

- **A1.1** SFE, SFW, SAAS and SFNI rules and channels remain explicit.

### A2 — Variant

- **A2.1** Suspension, withdrawal, transfer and repeat study use event-specific effective dates.

## Exception flows

### E1 — Control exception

- **E1.1** Do not infer attendance solely from fee payment.

### E2 — Control exception

- **E2.1** Identifier mismatch is investigated before creating another student record.

## Postconditions

### Successful

- The finance-body confirmation/notification and response is authoritative, effective-dated and linked to its evidence and decision authority.
- Each required consumer has acknowledged the correct version or has an owned reconciliation item.

### Unsuccessful or incomplete

- No unapproved outcome is represented as final; the case retains reason, owner and next action.

## Business rules and controls

| ID | Classification | Rule/control | Applicability | Source |
|---|---|---|---|---|
| BR-1 | SECTOR | Apply the current authoritative requirement and provider regulation for the person, level, mode and nation | UK/configured | SRC-003–SRC-005, SRC-065 |
| BR-2 | INSTITUTION | Decision roles, deadlines, evidence and permitted discretion are policy-versioned | Provider | Provider regulations |
| BR-3 | REVELATION | No common exchange ledger preserving national scheme and response lifecycle exists. | Revelation | SRC-015–SRC-019 |
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
| finance-body confirmation/notification and response | Create/version | SRS or governed specialist source | Policy, actor, evidence, decision and effective/transaction times | Personal; may be sensitive |
| Workflow/case evidence | Append | Owning service | Immutable source and restricted access | Personal/confidential |
| Integration exchange | Append/update | SRS integration ledger | Contract version, correlation, attempts and acknowledgement | Personal |

## Integration impact

| From | To | Information/purpose | Contract/pattern | Failure and reconciliation |
|---|---|---|---|---|
| SRS ↔ SLC/SAAS/national body | Connected system | attendance and changes | Versioned/idempotent contract | Retry, quarantine, acknowledge and reconcile |

## Sequence diagram

```mermaid
sequenceDiagram
    actor A1 as Student Finance Officer
    participant A2 as SRS
    participant A3 as SLC/National Finance Body
    participant A4 as Enrolled Student
    A1->>A2: 1. identify scheme, domicile, course and reporting responsibility
    A2->>A3: 2. validate identity, attendance/registration status and effective dates
    A3->>A4: 3. create the scheme-specific confirmation or change notification
    A4->>A1: 4. submit with correlation/idempotency identifiers
    A1->>A2: 5. record response, rejection and payment-impact status
    A2->>A3: 6. reconcile periodic lists and correct authoritative source facts where needed
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
| [SRC-003–SRC-005, SRC-065](../source-register.md) | External process, regulatory or sector evidence |
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
