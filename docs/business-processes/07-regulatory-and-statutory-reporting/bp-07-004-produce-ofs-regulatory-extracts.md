# BP-07-004 — Produce OfS regulatory extracts

> Status: Draft
> Domain: 07 — Regulatory and statutory reporting
> Owner: TBC
> Version: 0.1
> Last reviewed: 2026-07-26
> Review by: 2027-01-26

[Previous: BP-07-003](../07-regulatory-and-statutory-reporting/bp-07-003-manage-student-sponsor-reporting-and-compliance.md) · [Domain index](README.md) · [Next: BP-07-005](../07-regulatory-and-statutory-reporting/bp-07-005-produce-scottish-funding-council-returns.md) · [Library home](../README.md)

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
| Data entities | England regulatory extract, evidence and sign-off; supporting identity, evidence, decision and integration-exchange records |
| Domain events | Proposed: `srs.produce.ofs.regulatory.extracts.completed` |
| Integration contracts | SRS/data platform → OfS |

## Purpose and outcome

Producing OfS regulatory extracts turns the institution's live student records into the frozen, lineage-tracked data set the Office for Students requires for a specific regulatory return, with disclosure controls applied before anything leaves the institution. Freezing definitions and the population at a source cut-off, and validating the extract against prior submissions and source totals before it is signed off, catches a definitional drift or a totals mismatch before it reaches the regulator rather than after. The accountable officer's sign-off and the reproducible version of what was actually submitted are retained together, so the institution can always explain a past return.

## Scope

**Starts when:** An OfS requirement, monitoring request or scheduled return is due.

**Ends when:** The authorised outcome is recorded, communicated and reconciled, or the case is closed with an owned reason.

**In scope:** Intake, validation, evidence, decision, effective dating, communication and downstream reconciliation.

**Out of scope:** Upstream policy creation and later lifecycle processes referenced under Related processes.

## Actors and responsibilities

| Actor/system | Responsibility |
|---|---|
| Regulatory Data Officer | Initiates or owns the principal business action |
| Data Owner | Provides evidence, decision, system processing or governed support |
| Accountable Officer | Provides evidence, decision, system processing or governed support |
| OfS | Provides evidence, decision, system processing or governed support |

**Accountable owner:** Regulatory Data Officer service owner or delegated authority (TBC)

**System of record:** SRS for the student-record outcome; specialist systems retain their governed source evidence.

## Preconditions

1. Canonical person, programme/period and source identifiers are available where applicable.
2. The current policy/rule version and decision authority are configured.
3. Required interfaces use stable identifiers, provenance and reconciliation controls.

## Trigger

An OfS requirement, monitoring request or scheduled return is due.

## Main flow

1. **Regulatory Data Officer** confirm provider category, requirement, notice and deadline.
2. **Data Owner** freeze definitions, population and source cut-off.
3. **Data Owner** extract with field/metric lineage and disclosure controls.
4. **Regulatory Data Officer** validate against prior submissions and source totals.
5. **Data Owner** obtain accountable sign-off and submit securely.
6. **Accountable Officer** retain receipt, queries, corrections and reproducible version.

## Alternative flows

### A1 — Variant

- **A1.1** Ad hoc monitoring and scheduled returns retain distinct legal/notice bases.

### A2 — Variant

- **A2.1** FE providers may source specified data through ILR rather than the SRS.

## Exception flows

### E1 — Control exception

- **E1.1** Scope uncertainty is escalated before disclosure.

### E2 — Control exception

- **E2.1** A rejected extract is versioned and resubmitted.

## Postconditions

### Successful

- The England regulatory extract, evidence and sign-off is authoritative, effective-dated and linked to its evidence and decision authority.
- Each required consumer has acknowledged the correct version or has an owned reconciliation item.

### Unsuccessful or incomplete

- No unapproved outcome is represented as final; the case retains reason, owner and next action.

## Business rules and controls

| ID | Classification | Rule/control | Applicability | Source |
|---|---|---|---|---|
| BR-1 | SECTOR | Apply the current authoritative requirement and provider regulation for the person, level, mode and nation | UK/configured | SRC-066 |
| BR-2 | INSTITUTION | Decision roles, deadlines, evidence and permitted discretion are policy-versioned | Provider | Provider regulations |
| BR-3 | REVELATION | No durable OfS extract workflow, definition version or sign-off evidence exists. | Revelation | SRC-015–SRC-019 |
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
| England regulatory extract, evidence and sign-off | Create/version | SRS or governed specialist source | Policy, actor, evidence, decision and effective/transaction times | Personal; may be sensitive |
| Workflow/case evidence | Append | Owning service | Immutable source and restricted access | Personal/confidential |
| Integration exchange | Append/update | SRS integration ledger | Contract version, correlation, attempts and acknowledgement | Personal |

## Integration impact

| From | To | Information/purpose | Contract/pattern | Failure and reconciliation |
|---|---|---|---|---|
| SRS/data platform | OfS | regulatory extract | Versioned/idempotent contract | Retry, quarantine, acknowledge and reconcile |

## Sequence diagram

```mermaid
sequenceDiagram
    actor A1 as Regulatory Data Officer
    participant A2 as Data Owner
    participant A3 as Accountable Officer
    participant A4 as OfS
    A1->>A2: 1. confirms provider category, requirement, notice and deadline
    A2->>A2: 2. freezes definitions, population and source cut-off
    A2->>A1: 3. extracts with field/metric lineage and disclosure controls
    A1->>A2: 4. validates against prior submissions and source totals
    A2->>A4: 5. obtains accountable sign-off and submits securely
    A3->>A3: 6. retains receipt, queries, corrections and reproducible version
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
| [SRC-066](../source-register.md) | External process, regulatory or sector evidence |
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
