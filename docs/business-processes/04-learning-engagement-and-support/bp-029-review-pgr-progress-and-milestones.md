# BP-029 — Review PGR progress and milestones

> Status: Draft
> Domain: 04 — Learning, engagement and support
> Owner: TBC
> Version: 0.1
> Last reviewed: 2026-07-26
> Review by: 2027-01-26

[Previous: BP-028](../04-learning-engagement-and-support/bp-028-investigate-and-respond-to-non-engagement.md) · [Domain index](README.md) · [Next: BP-030](../04-learning-engagement-and-support/bp-030-manage-a-reasonable-adjustment-case.md) · [Library home](../README.md)

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
| Data entities | PGR review, evidence, milestone and progression outcome; supporting identity, evidence, decision and integration-exchange records |
| Domain events | Proposed: `srs.review.pgr.progress.and.milestones.completed` |
| Integration contracts | CRIS ↔ SRS; SRS → portal/communications |

## Purpose and outcome

Review PGR progress and milestones creates a controlled, explainable and effective-dated PGR review, evidence, milestone and progression outcome. The outcome preserves the evidence, authority and cross-system state needed for the Revelation SRS rather than reducing the process to a status update.

## Scope

**Starts when:** A scheduled or exceptional PGR progress review is due.

**Ends when:** The authorised outcome is recorded, communicated and reconciled, or the case is closed with an owned reason.

**In scope:** Intake, validation, evidence, decision, effective dating, communication and downstream reconciliation.

**Out of scope:** Upstream policy creation and later lifecycle processes referenced under Related processes.

## Actors and responsibilities

| Actor/system | Responsibility |
|---|---|
| Enrolled Student | Initiates or owns the principal business action |
| Research Supervisor | Provides evidence, decision, system processing or governed support |
| Independent Reviewer/Panel | Provides evidence, decision, system processing or governed support |
| PGR Administrator | Provides evidence, decision, system processing or governed support |

**Accountable owner:** Enrolled Student service owner or delegated authority (TBC)

**System of record:** SRS for the student-record outcome; specialist systems retain their governed source evidence.

## Preconditions

1. Canonical person, programme/period and source identifiers are available where applicable.
2. The current policy/rule version and decision authority are configured.
3. Required interfaces use stable identifiers, provenance and reconciliation controls.

## Trigger

A scheduled or exceptional PGR progress review is due.

## Main flow

1. **Enrolled Student** open the review against the candidature and current supervision period.
2. **Research Supervisor** collect student report, supervisory evidence, training and milestone status.
3. **Independent Reviewer/Panel** check independence, conflicts and required panel composition.
4. **PGR Administrator** conduct the review and record evidence considered.
5. **Research Supervisor** decide satisfactory progress, conditions, referral, transfer or escalation under regulations.
6. **Independent Reviewer/Panel** publish the authorised milestone/outcome and schedule follow-up.

## Alternative flows

### A1 — Variant

- **A1.1** Initial, annual, upgrade/confirmation and return-from-interruption reviews use configured outcome sets.

### A2 — Variant

- **A2.1** Collaborative provision records each partner authority.

## Exception flows

### E1 — Control exception

- **E1.1** Missing evidence or conflicted reviewer postpones with an owner.

### E2 — Control exception

- **E2.1** Unsatisfactory progress does not alter candidature until due process is complete.

## Postconditions

### Successful

- The PGR review, evidence, milestone and progression outcome is authoritative, effective-dated and linked to its evidence and decision authority.
- Each required consumer has acknowledged the correct version or has an owned reconciliation item.

### Unsuccessful or incomplete

- No unapproved outcome is represented as final; the case retains reason, owner and next action.

## Business rules and controls

| ID | Classification | Rule/control | Applicability | Source |
|---|---|---|---|---|
| BR-1 | SECTOR | Apply the current authoritative requirement and provider regulation for the person, level, mode and nation | UK/configured | SRC-047–SRC-050, SRC-056 |
| BR-2 | INSTITUTION | Decision roles, deadlines, evidence and permitted discretion are policy-versioned | Provider | Provider regulations |
| BR-3 | REVELATION | Research milestones exist but no review case, panel, evidence or governed outcome workflow exists. | Revelation | SRC-015–SRC-019 |
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
| PGR review, evidence, milestone and progression outcome | Create/version | SRS or governed specialist source | Policy, actor, evidence, decision and effective/transaction times | Personal; may be sensitive |
| Workflow/case evidence | Append | Owning service | Immutable source and restricted access | Personal/confidential |
| Integration exchange | Append/update | SRS integration ledger | Contract version, correlation, attempts and acknowledgement | Personal |

## Integration impact

| From | To | Information/purpose | Contract/pattern | Failure and reconciliation |
|---|---|---|---|---|
| CRIS ↔ SRS | Connected system | PGR milestones | Versioned/idempotent contract | Retry, quarantine, acknowledge and reconcile |
| SRS | portal/communications | outcome | Versioned/idempotent contract | Retry, quarantine, acknowledge and reconcile |

## Sequence diagram

```mermaid
sequenceDiagram
    actor A1 as Enrolled Student
    participant A2 as Research Supervisor
    participant A3 as Independent Reviewer/Panel
    participant A4 as PGR Administrator
    A1->>A2: 1. open the review against the candidature and current supervision period
    A2->>A3: 2. collect student report, supervisory evidence, training and milestone status
    A3->>A4: 3. check independence, conflicts and required panel composition
    A4->>A1: 4. conduct the review and record evidence considered
    A1->>A2: 5. decide satisfactory progress, conditions, referral, transfer or escalation under regulations
    A2->>A3: 6. publish the authorised milestone/outcome and schedule follow-up
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
| [SRC-047–SRC-050, SRC-056](../source-register.md) | External process, regulatory or sector evidence |
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
