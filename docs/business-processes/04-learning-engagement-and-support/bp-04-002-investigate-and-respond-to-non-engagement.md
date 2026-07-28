# BP-04-002 — Investigate and respond to non-engagement

> Status: Draft
> Domain: 04 — Learning, engagement and support
> Owner: TBC
> Version: 0.1
> Last reviewed: 2026-07-26
> Review by: 2027-01-26

[Previous: BP-04-001](../04-learning-engagement-and-support/bp-04-001-record-attendance-and-academic-engagement-evidence.md) · [Domain index](README.md) · [Next: BP-04-003](../04-learning-engagement-and-support/bp-04-003-review-pgr-progress-and-milestones.md) · [Library home](../README.md)

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
| Revelation workflows | W009 |
| Reference-model flows | See integration contract catalogue; confirm detailed F-number mapping during architecture review |
| Functional requirements | See functional requirements; detailed mapping remains an SME/architecture review action |
| Data entities | engagement alert, intervention case and outcome; supporting identity, evidence, decision and integration-exchange records |
| Domain events | Proposed: `srs.investigate.and.respond.to.non.engagement.completed` |
| Integration contracts | SRS ↔ case/communications; SRS → UKVI compliance |

## Purpose and outcome

This process turns a non-engagement signal into a governed case: an engagement officer triages the alert, a personal tutor makes contact and records the student's response, and the case is closed, continued or referred for a formal decision — with the evidence, contact history and decision authority kept together and effective-dated. It exists to keep pastoral contact separate from compliance and academic-status decisions, so that a welfare risk is routed to safeguarding rather than treated as an automatic sanction, and so that any sponsor-reporting duty (for example to UKVI) follows an authorised decision rather than the alert itself.

## Scope

**Starts when:** Configured evidence indicates possible non-engagement.

**Ends when:** The authorised outcome is recorded, communicated and reconciled, or the case is closed with an owned reason.

**In scope:** Intake, validation, evidence, decision, effective dating, communication and downstream reconciliation.

**Out of scope:** Upstream policy creation and later lifecycle processes referenced under Related processes.

## Actors and responsibilities

| Actor/system | Responsibility |
|---|---|
| Engagement Officer | Initiates or owns the principal business action |
| Enrolled Student | Provides evidence, decision, system processing or governed support |
| Personal Tutor | Provides evidence, decision, system processing or governed support |
| Wellbeing/Compliance Teams | Provides evidence, decision, system processing or governed support |

**Accountable owner:** Engagement Officer service owner or delegated authority (TBC)

**System of record:** SRS for the student-record outcome; specialist systems retain their governed source evidence.

## Preconditions

1. Canonical person, programme/period and source identifiers are available where applicable.
2. The current policy/rule version and decision authority are configured.
3. Required interfaces use stable identifiers, provenance and reconciliation controls.

## Trigger

Configured evidence indicates possible non-engagement.

## Main flow

1. **Engagement Officer** create an alert using the applicable cohort policy and evidence window.
2. **Engagement Officer** triage data quality, authorised absence, support and immediate-risk indicators.
3. **Personal Tutor** contact the student through accessible channels.
4. **Personal Tutor** record response, context and agreed re-engagement actions.
5. **Enrolled Student** submit new evidence by the policy deadline.
6. **Engagement Officer** close, continue support or refer to Wellbeing/Compliance Teams for an authorised status/sponsor decision.

## Alternative flows

### A1 — Variant

- **A1.1** Sponsored students follow the current academic-engagement policy and recorded reporting thresholds.

### A2 — Variant

- **A2.1** PGR, placement and distance students use mode-appropriate contacts.

## Exception flows

### E1 — Control exception

- **E1.1** Welfare risk follows safeguarding routes, not automated academic sanction.

### E2 — Control exception

- **E2.1** Bad or missing source data suspends adverse action and triggers reconciliation.

## Postconditions

### Successful

- The engagement alert, intervention case and outcome is authoritative, effective-dated and linked to its evidence and decision authority.
- Each required consumer has acknowledged the correct version or has an owned reconciliation item.

### Unsuccessful or incomplete

- No unapproved outcome is represented as final; the case retains reason, owner and next action.

## Business rules and controls

| ID | Classification | Rule/control | Applicability | Source |
|---|---|---|---|---|
| BR-1 | SECTOR | Apply the current authoritative requirement and provider regulation for the person, level, mode and nation | UK/configured | SRC-001–SRC-002, SRC-055 |
| BR-2 | INSTITUTION | Decision roles, deadlines, evidence and permitted discretion are policy-versioned | Provider | Provider regulations |
| BR-3 | REVELATION | W009 conflates alert, support intervention, academic status and sponsor reporting decisions. | Revelation | SRC-015–SRC-019 |
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
| engagement alert, intervention case and outcome | Create/version | SRS or governed specialist source | Policy, actor, evidence, decision and effective/transaction times | Personal; may be sensitive |
| Workflow/case evidence | Append | Owning service | Immutable source and restricted access | Personal/confidential |
| Integration exchange | Append/update | SRS integration ledger | Contract version, correlation, attempts and acknowledgement | Personal |

## Integration impact

| From | To | Information/purpose | Contract/pattern | Failure and reconciliation |
|---|---|---|---|---|
| SRS ↔ case/communications | Connected system | intervention | Versioned/idempotent contract | Retry, quarantine, acknowledge and reconcile |
| SRS | UKVI compliance | governed referral | Versioned/idempotent contract | Retry, quarantine, acknowledge and reconcile |

## Sequence diagram

```mermaid
sequenceDiagram
    participant Officer as Engagement Officer
    actor Student as Enrolled Student
    participant Tutor as Personal Tutor
    participant Wellbeing as Wellbeing/Compliance Teams

    Officer->>Officer: 1. Create an alert using the applicable cohort policy and evidence window
    Officer->>Officer: 2. Triage data quality, authorised absence, support and immediate-risk indicators
    Tutor->>Student: 3. Contact the student through accessible channels
    Tutor->>Officer: 4. Record response, context and agreed re-engagement actions
    Student->>Officer: 5. Submit new evidence by the policy deadline
    Officer->>Wellbeing: 6. Close, continue support or refer for an authorised status/sponsor decision
    alt Valid and authorised
        Officer-->>Student: Record and communicate outcome
    else Incomplete or exception
        Officer-->>Student: Retain case with owner and reason
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
| [SRC-001–SRC-002, SRC-055](../source-register.md) | External process, regulatory or sector evidence |
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
