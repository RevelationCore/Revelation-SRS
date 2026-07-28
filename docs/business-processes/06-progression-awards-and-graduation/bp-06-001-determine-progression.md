# BP-06-001 — Determine progression

> Status: Draft
> Domain: 06 — Progression, awards and graduation
> Owner: TBC
> Version: 0.1
> Last reviewed: 2026-07-26
> Review by: 2027-01-26

[Previous: BP-05-011](../05-assessment-and-results/bp-05-011-correct-a-ratified-academic-outcome.md) · [Domain index](README.md) · [Next: BP-06-002](../06-progression-awards-and-graduation/bp-06-002-manage-reassessment-referral-or-repeat-study.md) · [Library home](../README.md)

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
| Data entities | progression decision and rule explanation; supporting identity, evidence, decision and integration-exchange records |
| Domain events | Proposed: `srs.determine.progression.completed` |
| Integration contracts | SRS → portal/registration |

## Purpose and outcome

Progression decisions tell a student whether they may proceed to the next stage of study, on what basis, and with what conditions, once their assessment results for a progression point have been ratified. This process applies the correct rule set for the student's cohort, lets the progression board apply legitimate discretion to individual cases, and records the resulting decision as an authoritative, dated fact rather than a provisional note. Downstream services such as registration and the student portal need this outcome immediately and reliably, so the decision is published with enough explanation that the student, the board and later reviewers can all see why it was reached.

## Scope

**Starts when:** Ratified results for a progression point are available.

**Ends when:** The authorised outcome is recorded, communicated and reconciled, or the case is closed with an owned reason.

**In scope:** Intake, validation, evidence, decision, effective dating, communication and downstream reconciliation.

**Out of scope:** Upstream policy creation and later lifecycle processes referenced under Related processes.

## Actors and responsibilities

| Actor/system | Responsibility |
|---|---|
| Progression Board | Initiates or owns the principal business action |
| Assessment Officer | Provides evidence, decision, system processing or governed support |
| SRS | Provides evidence, decision, system processing or governed support |
| Enrolled Student | Provides evidence, decision, system processing or governed support |

**Accountable owner:** Progression Board service owner or delegated authority (TBC)

**System of record:** SRS for the student-record outcome; specialist systems retain their governed source evidence.

## Preconditions

1. Canonical person, programme/period and source identifiers are available where applicable.
2. The current policy/rule version and decision authority are configured.
3. Required interfaces use stable identifiers, provenance and reconciliation controls.

## Trigger

Ratified results for a progression point are available.

## Main flow

1. **Progression Board** confirms the progression-rule version applicable to the cohort's progression point, so the enrolment is bound to that version.
2. **Assessment Officer** assembles ratified credit, attempts and approved case effects for the board's consideration.
3. **SRS** calculates the default progression outcome with explanation.
4. **Enrolled Student** submits documented exceptions and evidence supporting permitted discretion for the board's consideration.
5. **Assessment Officer** records the authorised decision, reason and next study state on the board's behalf.
6. **SRS** publishes the decision and triggers registration/reassessment actions.

## Alternative flows

### A1 — Variant

- **A1.1** Part-time, placement, integrated masters and professional programmes use configured progression points.

### A2 — Variant

- **A2.1** PGR progression is handled by BP-04-003.

## Exception flows

### E1 — Control exception

- **E1.1** Missing/uncertain results defer rather than fail progression.

### E2 — Control exception

- **E2.1** Unconfigured discretion cannot be applied as a free-text override.

## Postconditions

### Successful

- The progression decision and rule explanation is authoritative, effective-dated and linked to its evidence and decision authority.
- Each required consumer has acknowledged the correct version or has an owned reconciliation item.

### Unsuccessful or incomplete

- No unapproved outcome is represented as final; the case retains reason, owner and next action.

## Business rules and controls

| ID | Classification | Rule/control | Applicability | Source |
|---|---|---|---|---|
| BR-1 | SECTOR | Apply the current authoritative requirement and provider regulation for the person, level, mode and nation | UK/configured | SRC-059, SRC-062 |
| BR-2 | INSTITUTION | Decision roles, deadlines, evidence and permitted discretion are policy-versioned | Provider | Provider regulations |
| BR-3 | REVELATION | Progression rule binding and explainable board discretion need first-class records. | Revelation | SRC-015–SRC-019 |
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
| progression decision and rule explanation | Create/version | SRS or governed specialist source | Policy, actor, evidence, decision and effective/transaction times | Personal; may be sensitive |
| Workflow/case evidence | Append | Owning service | Immutable source and restricted access | Personal/confidential |
| Integration exchange | Append/update | SRS integration ledger | Contract version, correlation, attempts and acknowledgement | Personal |

## Integration impact

| From | To | Information/purpose | Contract/pattern | Failure and reconciliation |
|---|---|---|---|---|
| SRS | portal/registration | progression outcome | Versioned/idempotent contract | Retry, quarantine, acknowledge and reconcile |

## Sequence diagram

```mermaid
sequenceDiagram
    actor Board as Progression Board
    participant AO as Assessment Officer
    participant SRS
    actor Student as Enrolled Student

    Board->>SRS: 1. Confirm progression-rule version; bind enrolment
    AO->>Board: 2. Assemble ratified credit, attempts and approved case effects
    SRS->>SRS: 3. Calculate the default progression outcome with explanation
    Student->>Board: 4. Submit documented exceptions and discretion evidence
    AO->>SRS: 5. Record the authorised decision, reason and next study state
    SRS->>SRS: 6. Publish the decision; trigger registration/reassessment actions
    alt E1 — Missing or uncertain results
        SRS-->>AO: E1.1 Defer the case rather than fail progression
    else E2 — Unconfigured discretion requested
        SRS-->>Board: E2.1 Reject the free-text override; require configured discretion
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
| [SRC-059, SRC-062](../source-register.md) | External process, regulatory or sector evidence |
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
