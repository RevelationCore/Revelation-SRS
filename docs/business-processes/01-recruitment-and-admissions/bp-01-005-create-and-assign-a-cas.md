# BP-005 — Create and assign a CAS

> Status: Draft
> Domain: 01 — Recruitment and admissions
> Owner: TBC
> Version: 0.1
> Last reviewed: 2026-07-26
> Review by: 2027-01-26

[Previous: BP-004](../01-recruitment-and-admissions/bp-004-confirm-offer-conditions.md) · [Domain index](README.md) · [Next: BP-006](../01-recruitment-and-admissions/bp-006-place-an-applicant-through-clearing.md) · [Library home](../README.md)

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
| Revelation workflows | W012 |
| Reference-model flows | See integration contract catalogue; confirm detailed F-number mapping during architecture review |
| Functional requirements | See functional requirements; detailed mapping remains an SME/architecture review action |
| Data entities | CAS request, evidence, assignment and sponsor history; supporting identity, evidence, decision and integration-exchange records |
| Domain events | Proposed: `srs.create.and.assign.a.cas.completed` |
| Integration contracts | SRS ↔ UKVI SMS |

## Purpose and outcome

Create and assign a CAS creates a controlled, explainable and effective-dated CAS request, evidence, assignment and sponsor history. The outcome preserves the evidence, authority and cross-system state needed for the Revelation SRS rather than reducing the process to a status update.

## Scope

**Starts when:** An eligible international applicant needs Student-route sponsorship.

**Ends when:** The authorised outcome is recorded, communicated and reconciled, or the case is closed with an owned reason.

**In scope:** Intake, validation, evidence, decision, effective dating, communication and downstream reconciliation.

**Out of scope:** Upstream policy creation and later lifecycle processes referenced under Related processes.

## Actors and responsibilities

| Actor/system | Responsibility |
|---|---|
| Prospective Student | Initiates or owns the principal business action |
| International Compliance Officer | Provides evidence, decision, system processing or governed support |
| SRS | Provides evidence, decision, system processing or governed support |
| UKVI Sponsor Management System | Provides evidence, decision, system processing or governed support |

**Accountable owner:** Prospective Student service owner or delegated authority (TBC)

**System of record:** SRS for the student-record outcome; specialist systems retain their governed source evidence.

## Preconditions

1. Canonical person, programme/period and source identifiers are available where applicable.
2. The current policy/rule version and decision authority are configured.
3. Required interfaces use stable identifiers, provenance and reconciliation controls.

## Trigger

An eligible international applicant needs Student-route sponsorship.

## Main flow

1. **Prospective Student** confirm the current Student sponsor guidance version and responsible sponsor.
2. **International Compliance Officer** validate unconditional status, identity, immigration history, course and financial evidence.
3. **SRS** assess academic progression, English language and genuine-student evidence where required.
4. **UKVI Sponsor Management System** approve the CAS request using segregation of duties.
5. **International Compliance Officer** create and assign the CAS through the Sponsor Management System.
6. **SRS** record the CAS number, assigned data, evidence snapshot and later status changes.

## Alternative flows

### A1 — Variant

- **A1.1** A continuing student or course change follows the applicable in-country/overseas route.

### A2 — Variant

- **A2.1** A partner or study-abroad arrangement records the actual sponsor and teaching locations.

## Exception flows

### E1 — Control exception

- **E1.1** Do not assign when evidence, licence scope or course eligibility is unresolved.

### E2 — Control exception

- **E2.1** Correct an SMS error through the governed sponsor route and retain both versions.

## Postconditions

### Successful

- The CAS request, evidence, assignment and sponsor history is authoritative, effective-dated and linked to its evidence and decision authority.
- Each required consumer has acknowledged the correct version or has an owned reconciliation item.

### Unsuccessful or incomplete

- No unapproved outcome is represented as final; the case retains reason, owner and next action.

## Business rules and controls

| ID | Classification | Rule/control | Applicability | Source |
|---|---|---|---|---|
| BR-1 | SECTOR | Apply the current authoritative requirement and provider regulation for the person, level, mode and nation | UK/configured | SRC-001–SRC-002 |
| BR-2 | INSTITUTION | Decision roles, deadlines, evidence and permitted discretion are policy-versioned | Provider | Provider regulations |
| BR-3 | REVELATION | W012 needs a durable eligibility checklist, approval and exact assigned-CAS snapshot. | Revelation | SRC-015–SRC-019 |
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
| CAS request, evidence, assignment and sponsor history | Create/version | SRS or governed specialist source | Policy, actor, evidence, decision and effective/transaction times | Personal; may be sensitive |
| Workflow/case evidence | Append | Owning service | Immutable source and restricted access | Personal/confidential |
| Integration exchange | Append/update | SRS integration ledger | Contract version, correlation, attempts and acknowledgement | Personal |

## Integration impact

| From | To | Information/purpose | Contract/pattern | Failure and reconciliation |
|---|---|---|---|---|
| SRS ↔ UKVI SMS | Connected system | CAS assignment/reporting | Versioned/idempotent contract | Retry, quarantine, acknowledge and reconcile |

## Sequence diagram

```mermaid
sequenceDiagram
    actor A1 as Prospective Student
    participant A2 as International Compliance Officer
    participant A3 as SRS
    participant A4 as UKVI Sponsor Management System
    A1->>A2: 1. confirm the current Student sponsor guidance version and responsible sponsor
    A2->>A3: 2. validate unconditional status, identity, immigration history, course and financial evidence
    A3->>A4: 3. assess academic progression, English language and genuine-student evidence where required
    A4->>A1: 4. approve the CAS request using segregation of duties
    A1->>A2: 5. create and assign the CAS through the Sponsor Management System
    A2->>A3: 6. record the CAS number, assigned data, evidence snapshot and later status changes
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
| [SRC-001–SRC-002](../source-register.md) | External process, regulatory or sector evidence |
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
