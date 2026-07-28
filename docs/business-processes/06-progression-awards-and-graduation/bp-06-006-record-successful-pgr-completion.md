# BP-06-006 — Record successful PGR completion

> Status: Draft
> Domain: 06 — Progression, awards and graduation
> Owner: TBC
> Version: 0.1
> Last reviewed: 2026-07-26
> Review by: 2027-01-26

[Previous: BP-06-005](../06-progression-awards-and-graduation/bp-06-005-determine-graduation-eligibility-and-attendance.md) · [Domain index](README.md) · [Next: BP-07-001](../07-regulatory-and-statutory-reporting/bp-07-001-prepare-and-submit-hesa-student-data.md) · [Library home](../README.md)

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
| Revelation workflows | W011 partial |
| Reference-model flows | See integration contract catalogue; confirm detailed F-number mapping during architecture review |
| Functional requirements | See functional requirements; detailed mapping remains an SME/architecture review action |
| Data entities | PGR completion, final thesis deposit and research-profile closure; supporting identity, evidence, decision and integration-exchange records |
| Domain events | Proposed: `srs.record.successful.pgr.completion.completed` |
| Integration contracts | Repository/CRIS ↔ SRS |

## Purpose and outcome

Recording successful PGR completion turns a ratified thesis examination outcome into the institution's confirmed record that a research candidature is complete, with the final thesis deposited under any approved access restriction and its intellectual-property declarations confirmed. Conferring the resulting award is deliberately routed through the same authority as any other award (BP-06-003), rather than treated as an automatic side effect of completion, so a research degree is conferred with the same rigour as a taught one. Supervision, milestones and the researcher's CRIS profile are closed or synchronised without deleting their history, preserving the full record of how the candidature progressed.

## Scope

**Starts when:** A ratified successful PGR examination outcome and corrections are complete.

**Ends when:** The authorised outcome is recorded, communicated and reconciled, or the case is closed with an owned reason.

**In scope:** Intake, validation, evidence, decision, effective dating, communication and downstream reconciliation.

**Out of scope:** Upstream policy creation and later lifecycle processes referenced under Related processes.

## Actors and responsibilities

| Actor/system | Responsibility |
|---|---|
| Enrolled Student | Initiates or owns the principal business action |
| PGR Administrator | Provides evidence, decision, system processing or governed support |
| Repository | Provides evidence, decision, system processing or governed support |
| Award Authority | Provides evidence, decision, system processing or governed support |

**Accountable owner:** Enrolled Student service owner or delegated authority (TBC)

**System of record:** SRS for the student-record outcome; specialist systems retain their governed source evidence.

## Preconditions

1. Canonical person, programme/period and source identifiers are available where applicable.
2. The current policy/rule version and decision authority are configured.
3. Required interfaces use stable identifiers, provenance and reconciliation controls.

## Trigger

A ratified successful PGR examination outcome and corrections are complete.

## Main flow

1. **PGR Administrator** verify ratified examination outcome and correction approval.
2. **PGR Administrator** receive the final thesis and enforce any approved access restriction.
3. **Repository** confirm deposit, metadata and intellectual-property declarations.
4. **Award Authority** record research candidature completion and effective date.
5. **Award Authority** confer the research award through BP-06-003 authority.
6. **Repository** close/synchronise supervision, milestones and CRIS profile without deleting history.

## Alternative flows

### A1 — Variant

- **A1.1** Embargoed/restricted thesis records the basis and review date.

### A2 — Variant

- **A2.1** Professional doctorate outputs may include approved non-thesis components.

## Exception flows

### E1 — Control exception

- **E1.1** Missing final deposit holds completion where regulations require it.

### E2 — Control exception

- **E2.1** CRIS/repository failure does not duplicate the award.

## Postconditions

### Successful

- The PGR completion, final thesis deposit and research-profile closure is authoritative, effective-dated and linked to its evidence and decision authority.
- Each required consumer has acknowledged the correct version or has an owned reconciliation item.

### Unsuccessful or incomplete

- No unapproved outcome is represented as final; the case retains reason, owner and next action.

## Business rules and controls

| ID | Classification | Rule/control | Applicability | Source |
|---|---|---|---|---|
| BR-1 | SECTOR | Apply the current authoritative requirement and provider regulation for the person, level, mode and nation | UK/configured | SRC-056, SRC-062 |
| BR-2 | INSTITUTION | Decision roles, deadlines, evidence and permitted discretion are policy-versioned | Provider | Provider regulations |
| BR-3 | REVELATION | PGR completion, deposit and research-profile closure are not orchestrated by W011. | Revelation | SRC-015–SRC-019 |
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
| PGR completion, final thesis deposit and research-profile closure | Create/version | SRS or governed specialist source | Policy, actor, evidence, decision and effective/transaction times | Personal; may be sensitive |
| Workflow/case evidence | Append | Owning service | Immutable source and restricted access | Personal/confidential |
| Integration exchange | Append/update | SRS integration ledger | Contract version, correlation, attempts and acknowledgement | Personal |

## Integration impact

| From | To | Information/purpose | Contract/pattern | Failure and reconciliation |
|---|---|---|---|---|
| Repository/CRIS ↔ SRS | Connected system | final thesis and completion | Versioned/idempotent contract | Retry, quarantine, acknowledge and reconcile |

## Sequence diagram

```mermaid
sequenceDiagram
    actor A1 as Enrolled Student
    participant A2 as PGR Administrator
    participant A3 as Repository
    participant A4 as Award Authority
    A2->>A2: 1. verifies ratified examination outcome and correction approval
    A2->>A3: 2. receives the final thesis and enforces any approved access restriction
    A3->>A4: 3. confirms deposit, metadata and intellectual-property declarations
    A4->>A4: 4. records research candidature completion and effective date
    A4->>A3: 5. confers the research award through BP-06-003 authority
    A3->>A3: 6. closes/synchronises supervision, milestones and CRIS profile without deleting history
    alt Valid and authorised
        A3->>A1: Record and communicate outcome
    else Incomplete or exception
        A3->>A1: Retain case with owner and reason
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
| [SRC-056, SRC-062](../source-register.md) | External process, regulatory or sector evidence |
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
