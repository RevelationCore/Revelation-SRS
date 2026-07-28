# BP-04-005 — Manage exceptional circumstances

> Status: Draft
> Domain: 04 — Learning, engagement and support
> Owner: TBC
> Version: 0.1
> Last reviewed: 2026-07-26
> Review by: 2027-01-26

[Previous: BP-04-004](../04-learning-engagement-and-support/bp-04-004-manage-a-reasonable-adjustment-case.md) · [Domain index](README.md) · [Next: BP-04-006](../04-learning-engagement-and-support/bp-04-006-distribute-an-approved-support-outcome.md) · [Library home](../README.md)

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
| Revelation workflows | W003 |
| Reference-model flows | See integration contract catalogue; confirm detailed F-number mapping during architecture review |
| Functional requirements | See functional requirements; detailed mapping remains an SME/architecture review action |
| Data entities | exceptional-circumstances claim and determination; supporting identity, evidence, decision and integration-exchange records |
| Domain events | Proposed: `srs.manage.exceptional.circumstances.completed` |
| Integration contracts | Case system → SRS/exam board |

## Purpose and outcome

This process manages a student's claim that specific circumstances affected their ability to complete or perform in named assessments, from submission through to an authorised, policy-based determination. It exists to keep the sensitive evidence behind a claim restricted to those who need it, while giving exam boards only the minimum decided flag or remedy needed to adjust an assessment outcome — the exam board acts on that authorised determination rather than adjudicating the personal circumstances behind it.

## Scope

**Starts when:** A student submits circumstances affecting specified assessment or study.

**Ends when:** The authorised outcome is recorded, communicated and reconciled, or the case is closed with an owned reason.

**In scope:** Intake, validation, evidence, decision, effective dating, communication and downstream reconciliation.

**Out of scope:** Upstream policy creation and later lifecycle processes referenced under Related processes.

## Actors and responsibilities

| Actor/system | Responsibility |
|---|---|
| Enrolled Student | Initiates or owns the principal business action |
| Case Officer | Provides evidence, decision, system processing or governed support |
| Authorised Decision Maker | Provides evidence, decision, system processing or governed support |
| Exam Board Chair | Provides evidence, decision, system processing or governed support |

**Accountable owner:** Enrolled Student service owner or delegated authority (TBC)

**System of record:** SRS for the student-record outcome; specialist systems retain their governed source evidence.

## Preconditions

1. Canonical person, programme/period and source identifiers are available where applicable.
2. The current policy/rule version and decision authority are configured.
3. Required interfaces use stable identifiers, provenance and reconciliation controls.

## Trigger

A student submits circumstances affecting specified assessment or study.

## Main flow

1. **Enrolled Student** record the claim, affected period/assessments and requested remedy.
2. **Case Officer** check timeliness, evidence requirement and accessibility.
3. **Case Officer** collect proportionate evidence with restricted access.
4. **Authorised Decision Maker** assess against the policy version without deciding academic marks.
5. **Case Officer** record upheld, partly upheld, not upheld or referred and any review route.
6. **Authorised Decision Maker** publish the minimum approved flag/remedy for assessment decision making.

## Alternative flows

### A1 — Variant

- **A1.1** Self-certification, late claim and ongoing-condition routes use configured evidence rules.

### A2 — Variant

- **A2.1** A review/appeal is linked but does not overwrite the original decision.

## Exception flows

### E1 — Control exception

- **E1.1** Immediate wellbeing risk is referred separately.

### E2 — Control exception

- **E2.1** A conflict of interest reassigns the decision.

## Postconditions

### Successful

- The exceptional-circumstances claim and determination is authoritative, effective-dated and linked to its evidence and decision authority.
- Each required consumer has acknowledged the correct version or has an owned reconciliation item.

### Unsuccessful or incomplete

- No unapproved outcome is represented as final; the case retains reason, owner and next action.

## Business rules and controls

| ID | Classification | Rule/control | Applicability | Source |
|---|---|---|---|---|
| BR-1 | SECTOR | Apply the current authoritative requirement and provider regulation for the person, level, mode and nation | UK/configured | SRC-055, SRC-058 |
| BR-2 | INSTITUTION | Decision roles, deadlines, evidence and permitted discretion are policy-versioned | Provider | Provider regulations |
| BR-3 | REVELATION | W003 models the basic states but not assessment scope, remedy version or privacy boundary. | Revelation | SRC-015–SRC-019 |
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
| exceptional-circumstances claim and determination | Create/version | SRS or governed specialist source | Policy, actor, evidence, decision and effective/transaction times | Personal; may be sensitive |
| Workflow/case evidence | Append | Owning service | Immutable source and restricted access | Personal/confidential |
| Integration exchange | Append/update | SRS integration ledger | Contract version, correlation, attempts and acknowledgement | Personal |

## Integration impact

| From | To | Information/purpose | Contract/pattern | Failure and reconciliation |
|---|---|---|---|---|
| Case system | SRS/exam board | approved outcome | Versioned/idempotent contract | Retry, quarantine, acknowledge and reconcile |

## Sequence diagram

```mermaid
sequenceDiagram
    actor Student as Enrolled Student
    participant Officer as Case Officer
    participant Decider as Authorised Decision Maker
    participant Chair as Exam Board Chair

    Student->>Officer: 1. Record the claim, affected period/assessments and requested remedy
    Officer->>Officer: 2. Check timeliness, evidence requirement and accessibility
    Officer->>Decider: 3. Collect proportionate evidence with restricted access
    Decider->>Decider: 4. Assess against the policy version without deciding academic marks
    Officer->>Officer: 5. Record upheld, partly upheld, not upheld or referred and any review route
    Decider->>Chair: 6. Publish the minimum approved flag/remedy for assessment decision making
    alt Valid and authorised
        Decider-->>Student: Record and communicate outcome
    else Incomplete or exception
        Decider-->>Student: Retain case with owner and reason
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
| [SRC-055, SRC-058](../source-register.md) | External process, regulatory or sector evidence |
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
