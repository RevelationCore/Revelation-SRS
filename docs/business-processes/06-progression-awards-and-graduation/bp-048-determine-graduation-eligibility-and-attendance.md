# BP-048 — Determine graduation eligibility and attendance

> Status: Draft
> Domain: 06 — Progression, awards and graduation
> Owner: TBC
> Version: 0.1
> Last reviewed: 2026-07-26
> Review by: 2027-01-26

[Previous: BP-047](../06-progression-awards-and-graduation/bp-047-issue-award-documentation-and-hear.md) · [Domain index](README.md) · [Next: BP-049](../06-progression-awards-and-graduation/bp-049-record-successful-pgr-completion.md) · [Library home](../README.md)

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
| Data entities | ceremony eligibility, invitation, response and allocation; supporting identity, evidence, decision and integration-exchange records |
| Domain events | Proposed: `srs.determine.graduation.eligibility.and.attendance.completed` |
| Integration contracts | SRS ↔ ceremony service |

## Purpose and outcome

Determine graduation eligibility and attendance creates a controlled, explainable and effective-dated ceremony eligibility, invitation, response and allocation. The outcome preserves the evidence, authority and cross-system state needed for the Revelation SRS rather than reducing the process to a status update.

## Scope

**Starts when:** A conferred or expected award enters a graduation cycle.

**Ends when:** The authorised outcome is recorded, communicated and reconciled, or the case is closed with an owned reason.

**In scope:** Intake, validation, evidence, decision, effective dating, communication and downstream reconciliation.

**Out of scope:** Upstream policy creation and later lifecycle processes referenced under Related processes.

## Actors and responsibilities

| Actor/system | Responsibility |
|---|---|
| Graduation Team | Initiates or owns the principal business action |
| Graduate | Provides evidence, decision, system processing or governed support |
| SRS | Provides evidence, decision, system processing or governed support |
| Ceremony Service | Provides evidence, decision, system processing or governed support |

**Accountable owner:** Graduation Team service owner or delegated authority (TBC)

**System of record:** SRS for the student-record outcome; specialist systems retain their governed source evidence.

## Preconditions

1. Canonical person, programme/period and source identifiers are available where applicable.
2. The current policy/rule version and decision authority are configured.
3. Required interfaces use stable identifiers, provenance and reconciliation controls.

## Trigger

A conferred or expected award enters a graduation cycle.

## Main flow

1. **Graduation Team** define ceremony cycle, eligibility rules and capacity.
2. **Graduate** derive eligible invitees from authoritative award status.
3. **SRS** send invitation and capture attendance/deferral/accessibility choices.
4. **Ceremony Service** allocate ceremony, guest/ticket and presentation details.
5. **Graduate** freeze the presentation list and reconcile late award changes.
6. **SRS** record attendance/presentation separately from award conferment.

## Alternative flows

### A1 — Variant

- **A1.1** In absentia, deferred attendance and accessibility arrangements retain the same conferred award.

### A2 — Variant

- **A2.1** PGR and partner ceremonies may use different cycles.

## Exception flows

### E1 — Control exception

- **E1.1** Ceremony capacity or late award decision moves attendance, not academic status.

### E2 — Control exception

- **E2.1** Safety/access needs are shared minimally.

## Postconditions

### Successful

- The ceremony eligibility, invitation, response and allocation is authoritative, effective-dated and linked to its evidence and decision authority.
- Each required consumer has acknowledged the correct version or has an owned reconciliation item.

### Unsuccessful or incomplete

- No unapproved outcome is represented as final; the case retains reason, owner and next action.

## Business rules and controls

| ID | Classification | Rule/control | Applicability | Source |
|---|---|---|---|---|
| BR-1 | SECTOR | Apply the current authoritative requirement and provider regulation for the person, level, mode and nation | UK/configured | SRC-062 |
| BR-2 | INSTITUTION | Decision roles, deadlines, evidence and permitted discretion are policy-versioned | Provider | Provider regulations |
| BR-3 | REVELATION | Graduation attendance is not clearly separated from conferment in W011. | Revelation | SRC-015–SRC-019 |
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
| ceremony eligibility, invitation, response and allocation | Create/version | SRS or governed specialist source | Policy, actor, evidence, decision and effective/transaction times | Personal; may be sensitive |
| Workflow/case evidence | Append | Owning service | Immutable source and restricted access | Personal/confidential |
| Integration exchange | Append/update | SRS integration ledger | Contract version, correlation, attempts and acknowledgement | Personal |

## Integration impact

| From | To | Information/purpose | Contract/pattern | Failure and reconciliation |
|---|---|---|---|---|
| SRS ↔ ceremony service | Connected system | eligibility and attendance | Versioned/idempotent contract | Retry, quarantine, acknowledge and reconcile |

## Sequence diagram

```mermaid
sequenceDiagram
    actor A1 as Graduation Team
    participant A2 as Graduate
    participant A3 as SRS
    participant A4 as Ceremony Service
    A1->>A2: 1. define ceremony cycle, eligibility rules and capacity
    A2->>A3: 2. derive eligible invitees from authoritative award status
    A3->>A4: 3. send invitation and capture attendance/deferral/accessibility choices
    A4->>A1: 4. allocate ceremony, guest/ticket and presentation details
    A1->>A2: 5. freeze the presentation list and reconcile late award changes
    A2->>A3: 6. record attendance/presentation separately from award conferment
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
| [SRC-062](../source-register.md) | External process, regulatory or sector evidence |
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
