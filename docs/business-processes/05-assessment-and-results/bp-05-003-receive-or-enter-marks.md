# BP-05-003 — Receive or enter marks

> Status: Draft
> Domain: 05 — Assessment and results
> Owner: TBC
> Version: 0.1
> Last reviewed: 2026-07-26
> Review by: 2027-01-26

[Previous: BP-05-002](../05-assessment-and-results/bp-05-002-create-examination-entries-and-accommodations.md) · [Domain index](README.md) · [Next: BP-05-004](../05-assessment-and-results/bp-05-004-moderate-and-confirm-marks.md) · [Library home](../README.md)

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
| Data entities | raw mark, grade, absence and submission evidence; supporting identity, evidence, decision and integration-exchange records |
| Domain events | Proposed: `srs.receive.or.enter.marks.completed` |
| Integration contracts | Assessment/VLE → SRS |

## Purpose and outcome

Receiving or entering marks turns a marker's assessment of a candidate's work into a validated, provenance-tracked raw result the institution can rely on. Marks are checked against the marking scale, the marker's authority to mark that assessment, and the correct candidate before they are accepted, so an out-of-range, unauthorised or misattributed entry is caught before it ever reaches moderation. Keeping the raw entry and its source distinct from any later moderated value preserves an honest record of what was first submitted and by whom.

## Scope

**Starts when:** An authorised marker submits a mark or approved results feed arrives.

**Ends when:** The authorised outcome is recorded, communicated and reconciled, or the case is closed with an owned reason.

**In scope:** Intake, validation, evidence, decision, effective dating, communication and downstream reconciliation.

**Out of scope:** Upstream policy creation and later lifecycle processes referenced under Related processes.

## Actors and responsibilities

| Actor/system | Responsibility |
|---|---|
| Marker | Initiates or owns the principal business action |
| Module Leader | Provides evidence, decision, system processing or governed support |
| Assessment System | Provides evidence, decision, system processing or governed support |
| SRS | Provides evidence, decision, system processing or governed support |

**Accountable owner:** Marker service owner or delegated authority (TBC)

**System of record:** SRS for the student-record outcome; specialist systems retain their governed source evidence.

## Preconditions

1. Canonical person, programme/period and source identifiers are available where applicable.
2. The current policy/rule version and decision authority are configured.
3. Required interfaces use stable identifiers, provenance and reconciliation controls.

## Trigger

An authorised marker submits a mark or approved results feed arrives.

## Main flow

1. **Marker** open the correct assessment instance and candidate attempt.
2. **Module Leader** receive mark, grade, absence/non-submission code and source evidence.
3. **Assessment System** validate range, scale, marker authority and candidate mapping.
4. **SRS** store the raw result with provenance and transaction time.
5. **Module Leader** flag missing, anomalous or conflicting entries.
6. **Assessment System** close the entry window and hand the complete set to moderation.

## Alternative flows

### A1 — Variant

- **A1.1** Anonymous marking resolves candidate identity only at the authorised stage.

### A2 — Variant

- **A2.1** Group, pass/fail and competency assessments use configured scales.

## Exception flows

### E1 — Control exception

- **E1.1** Unknown candidate or out-of-range value is rejected.

### E2 — Control exception

- **E2.1** A resubmission never overwrites an earlier attempt.

## Postconditions

### Successful

- The raw mark, grade, absence and submission evidence is authoritative, effective-dated and linked to its evidence and decision authority.
- Each required consumer has acknowledged the correct version or has an owned reconciliation item.

### Unsuccessful or incomplete

- No unapproved outcome is represented as final; the case retains reason, owner and next action.

## Business rules and controls

| ID | Classification | Rule/control | Applicability | Source |
|---|---|---|---|---|
| BR-1 | SECTOR | Apply the current authoritative requirement and provider regulation for the person, level, mode and nation | UK/configured | SRC-059 |
| BR-2 | INSTITUTION | Decision roles, deadlines, evidence and permitted discretion are policy-versioned | Provider | Provider regulations |
| BR-3 | REVELATION | Raw, moderated and ratified marks need distinct states and immutable provenance. | Revelation | SRC-015–SRC-019 |
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
| raw mark, grade, absence and submission evidence | Create/version | SRS or governed specialist source | Policy, actor, evidence, decision and effective/transaction times | Personal; may be sensitive |
| Workflow/case evidence | Append | Owning service | Immutable source and restricted access | Personal/confidential |
| Integration exchange | Append/update | SRS integration ledger | Contract version, correlation, attempts and acknowledgement | Personal |

## Integration impact

| From | To | Information/purpose | Contract/pattern | Failure and reconciliation |
|---|---|---|---|---|
| Assessment/VLE | SRS | marks and submission facts | Versioned/idempotent contract | Retry, quarantine, acknowledge and reconcile |

## Sequence diagram

```mermaid
sequenceDiagram
    actor A1 as Marker
    participant A2 as Module Leader
    participant A3 as Assessment System
    participant A4 as SRS
    A1->>A2: 1. opens the correct assessment instance and candidate attempt
    A2->>A3: 2. receives mark, grade, absence/non-submission code and source evidence
    A3->>A4: 3. validates range, scale, marker authority and candidate mapping
    A4->>A2: 4. stores the raw result with provenance and transaction time
    A2->>A3: 5. flags missing, anomalous or conflicting entries
    A3->>A4: 6. closes the entry window and hands the complete set to moderation
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
