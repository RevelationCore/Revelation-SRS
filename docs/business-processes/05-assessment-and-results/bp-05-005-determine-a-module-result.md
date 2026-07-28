# BP-037 — Determine a module result

> Status: Draft
> Domain: 05 — Assessment and results
> Owner: TBC
> Version: 0.1
> Last reviewed: 2026-07-26
> Review by: 2027-01-26

[Previous: BP-036](../05-assessment-and-results/bp-036-moderate-and-confirm-marks.md) · [Domain index](README.md) · [Next: BP-038](../05-assessment-and-results/bp-038-investigate-academic-misconduct.md) · [Library home](../README.md)

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
| Data entities | module result, credit and reassessment entitlement; supporting identity, evidence, decision and integration-exchange records |
| Domain events | Proposed: `srs.determine.a.module.result.completed` |
| Integration contracts | SRS calculation → exam board |

## Purpose and outcome

Determine a module result creates a controlled, explainable and effective-dated module result, credit and reassessment entitlement. The outcome preserves the evidence, authority and cross-system state needed for the Revelation SRS rather than reducing the process to a status update.

## Scope

**Starts when:** All required confirmed component outcomes are available or formally absent.

**Ends when:** The authorised outcome is recorded, communicated and reconciled, or the case is closed with an owned reason.

**In scope:** Intake, validation, evidence, decision, effective dating, communication and downstream reconciliation.

**Out of scope:** Upstream policy creation and later lifecycle processes referenced under Related processes.

## Actors and responsibilities

| Actor/system | Responsibility |
|---|---|
| SRS Calculation Service | Initiates or owns the principal business action |
| Assessment Officer | Provides evidence, decision, system processing or governed support |
| Module Board | Provides evidence, decision, system processing or governed support |
| Enrolled Student | Provides evidence, decision, system processing or governed support |

**Accountable owner:** SRS Calculation Service service owner or delegated authority (TBC)

**System of record:** SRS for the student-record outcome; specialist systems retain their governed source evidence.

## Preconditions

1. Canonical person, programme/period and source identifiers are available where applicable.
2. The current policy/rule version and decision authority are configured.
3. Required interfaces use stable identifiers, provenance and reconciliation controls.

## Trigger

All required confirmed component outcomes are available or formally absent.

## Main flow

1. **SRS Calculation Service** bind the student attempt to the applicable assessment-rule version.
2. **Assessment Officer** calculate aggregate outcome with rounding, compensation and mandatory-component rules.
3. **Module Board** apply approved exceptional-circumstance and misconduct effects.
4. **Enrolled Student** derive pass/fail, credit and reassessment eligibility.
5. **Assessment Officer** present exceptions for authorised review rather than manual hidden override.
6. **Module Board** record the provisional module result for ratification.

## Alternative flows

### A1 — Variant

- **A1.1** Pass/fail, competency and professional-body modules use configured result sets.

### A2 — Variant

- **A2.1** Incomplete or deferred assessment produces a non-final outcome.

## Exception flows

### E1 — Control exception

- **E1.1** Missing required marks prevents a false fail.

### E2 — Control exception

- **E2.1** Rule/configuration errors invalidate the calculation batch and trigger rerun.

## Postconditions

### Successful

- The module result, credit and reassessment entitlement is authoritative, effective-dated and linked to its evidence and decision authority.
- Each required consumer has acknowledged the correct version or has an owned reconciliation item.

### Unsuccessful or incomplete

- No unapproved outcome is represented as final; the case retains reason, owner and next action.

## Business rules and controls

| ID | Classification | Rule/control | Applicability | Source |
|---|---|---|---|---|
| BR-1 | SECTOR | Apply the current authoritative requirement and provider regulation for the person, level, mode and nation | UK/configured | SRC-059 |
| BR-2 | INSTITUTION | Decision roles, deadlines, evidence and permitted discretion are policy-versioned | Provider | Provider regulations |
| BR-3 | REVELATION | Rule-version binding and explainable calculation evidence need strengthening. | Revelation | SRC-015–SRC-019 |
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
| module result, credit and reassessment entitlement | Create/version | SRS or governed specialist source | Policy, actor, evidence, decision and effective/transaction times | Personal; may be sensitive |
| Workflow/case evidence | Append | Owning service | Immutable source and restricted access | Personal/confidential |
| Integration exchange | Append/update | SRS integration ledger | Contract version, correlation, attempts and acknowledgement | Personal |

## Integration impact

| From | To | Information/purpose | Contract/pattern | Failure and reconciliation |
|---|---|---|---|---|
| SRS calculation | exam board | provisional result | Versioned/idempotent contract | Retry, quarantine, acknowledge and reconcile |

## Sequence diagram

```mermaid
sequenceDiagram
    actor A1 as SRS Calculation Service
    participant A2 as Assessment Officer
    participant A3 as Module Board
    participant A4 as Enrolled Student
    A1->>A2: 1. bind the student attempt to the applicable assessment-rule version
    A2->>A3: 2. calculate aggregate outcome with rounding, compensation and mandatory-component rules
    A3->>A4: 3. apply approved exceptional-circumstance and misconduct effects
    A4->>A1: 4. derive pass/fail, credit and reassessment eligibility
    A1->>A2: 5. present exceptions for authorised review rather than manual hidden override
    A2->>A3: 6. record the provisional module result for ratification
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
| [SRC-059](../source-register.md) | External process, regulatory or sector evidence |
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
