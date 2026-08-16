# BP-04-004 — Manage a reasonable adjustment case

> Status: Draft — implemented (this repository's `modules/wellbeing` + `apps/admin`/`apps/portal`); process/national/data SME review still pending, see Review record
> Domain: 04 — Learning, engagement and support
> Owner: TBC
> Version: 0.2
> Last reviewed: 2026-08-15
> Review by: 2027-02-15

[Previous: BP-04-003](../04-learning-engagement-and-support/bp-04-003-review-pgr-progress-and-milestones.md) · [Domain index](README.md) · [Next: BP-04-005](../04-learning-engagement-and-support/bp-04-005-manage-exceptional-circumstances.md) · [Library home](../README.md)

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
| Revelation workflows | W002 |
| Reference-model flows | F-WELL-SIS-01 (adjustment handoff); F-WELL-SIS-02 (assessment venue). See integration contract catalogue; confirm detailed F-number mapping during architecture review |
| Functional requirements | See functional requirements; detailed mapping remains an SME/architecture review action |
| Data entities | `wellbeing.adjustment_case`, `adjustment_assessment`, `adjustment_panel_decision`, `adjustment_case_evidence` (module-owned process); `reasonable_adjustment`, `adjustment_distribution` (core-SRS-owned distributed outcome, linked back to the case via `source_case_id`) |
| Domain events | `srs.adjustment.approved`, `srs.adjustment.distributed`, `srs.adjustment.expired` (published by core SRS on the distributed-outcome record; the module-owned case process itself has no event stream — see Change history v0.2) |
| Integration contracts | Case system → SRS; SRS → exam/VLE/attendance |

## Purpose and outcome

This process manages an individual student's reasonable-adjustment case from disclosure through to an approved, implementable support plan. A disability adviser and specialist assessor gather only the evidence needed to identify the barriers a student faces in teaching, assessment and services, and turn that into concrete, approved adjustments. It exists to keep clinical or diagnostic detail inside the specialist service while the SRS and wider Registry receive only the minimum approved outcome needed to implement and track the adjustment across other systems.

## Scope

**Starts when:** A student declares a disability or requests disability-related support.

**Ends when:** The authorised outcome is recorded, communicated and reconciled, or the case is closed with an owned reason.

**In scope:** Intake, validation, evidence, decision, effective dating, communication and downstream reconciliation.

**Out of scope:** Upstream policy creation and later lifecycle processes referenced under Related processes.

## Actors and responsibilities

| Actor/system | Responsibility |
|---|---|
| Enrolled Student | Initiates or owns the principal business action |
| Disability Adviser | Provides evidence, decision, system processing or governed support |
| Specialist Assessor | Provides evidence, decision, system processing or governed support |
| Panel (Wellbeing Panel Chair) | Escalation-only: decides contested or specialist-assessor-referred cases. Not part of the main flow — most cases are decided on the specialist assessment alone (see Main flow step 4a) |
| Registry | Provides evidence, decision, system processing or governed support |

**Accountable owner:** Enrolled Student service owner or delegated authority (TBC)

**System of record:** SRS for the student-record outcome; specialist systems retain their governed source evidence.

## Preconditions

1. Canonical person, programme/period and source identifiers are available where applicable.
2. The current policy/rule version and decision authority are configured.
3. Required interfaces use stable identifiers, provenance and reconciliation controls.

## Trigger

A student declares a disability or requests disability-related support.

## Main flow

1. **Enrolled Student** open a confidential case and confirm communication/access needs — in practice, a self-service request naming the adjustment type and (optionally) a rationale; the case and its parent disability support case are opened automatically on first request.
2. **Disability Adviser** collect proportionate evidence or arrange assessment — evidence (e.g. a medical letter or DSA award letter) is attached directly to the case, checksummed and access-logged.
3. **Specialist Assessor** identify barriers across teaching, assessment and services.
4. **Specialist Assessor** draft reasonable and implementable adjustment outcomes, recording a `recommended` / `not-recommended` / `deferred` / `referred-to-panel` outcome.
   - **4a.** If the outcome is `referred-to-panel`, the **Panel** decides instead (escalation only — most cases are not referred).
5. **Disability Adviser** approve or review the plan under delegated authority — approval requires the recommending assessment or an upheld/modified panel decision to already exist; it is not accepted on referral information alone.
6. **Registry** send only the necessary approved outcome to the SRS for distribution, carrying a reference back to the case that approved it.

## Alternative flows

### A1 — Variant

- **A1.1** Temporary, anticipatory and placement adjustments carry their own review dates.

### A2 — Variant

- **A2.1** A student may request review or decline an offered adjustment — implemented as `request-review`, reopening an approved/rejected case.

## Exception flows

### E1 — Control exception

- **E1.1** Clinical evidence remains in the specialist service, not the general student record.

### E2 — Control exception

- **E2.1** An unimplementable adjustment is escalated for an effective alternative.

## Postconditions

### Successful

- The adjustment case and approved support plan is authoritative, effective-dated and linked to its evidence and decision authority.
- Each required consumer has acknowledged the correct version or has an owned reconciliation item.

### Unsuccessful or incomplete

- No unapproved outcome is represented as final; the case retains reason, owner and next action.

## Business rules and controls

| ID | Classification | Rule/control | Applicability | Source |
|---|---|---|---|---|
| BR-1 | SECTOR | Apply the current authoritative requirement and provider regulation for the person, level, mode and nation | UK/configured | SRC-055, SRC-057 |
| BR-2 | INSTITUTION | Decision roles, deadlines, evidence and permitted discretion are policy-versioned | Provider | Provider regulations |
| BR-3 | REVELATION | W002 needs explicit data-minimisation, review/effective dates and outcome-versus-evidence boundaries. | Revelation | SRC-015–SRC-019 |
| BR-4 | IMPLEMENTED | Case states are distinguishable and transitions are enforced by an explicit state machine (`referral_received` → `under_assessment` → `determination_made`/`under_review` → `approved`/`rejected` → `closed`); an illegal transition is rejected (409) | Revelation | `modules/wellbeing`'s adjustment-case repository |
| BR-5 | IMPLEMENTED | The distributed outcome is bitemporal (never overwritten — a correction is a new version); the case's own change history is likewise append-only bitemporal versions. A permission-gated administrative correction path exists separately from normal transitions, for exceptional data fixes only | Revelation | `reasonable_adjustment`/`adjustment_case` bitemporal schemas |

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
| adjustment case and approved support plan | Create/version | SRS or governed specialist source | Policy, actor, evidence, decision and effective/transaction times | Personal; may be sensitive |
| Workflow/case evidence | Append | Owning service (`packages/documents`, installed in the wellbeing module's own database) | Checksummed on upload, access-logged on every read/write, soft-deleted (never hard-deleted) | Personal/confidential |
| Integration exchange | Append/update | SRS integration ledger | Contract version, correlation, attempts and acknowledgement | Personal |

## Integration impact

| From | To | Information/purpose | Contract/pattern | Failure and reconciliation |
|---|---|---|---|---|
| Case system | SRS | approved adjustment | Versioned/idempotent contract | Retry, quarantine, acknowledge and reconcile |
| SRS | exam/VLE/attendance | outcome | Versioned/idempotent contract | Retry, quarantine, acknowledge and reconcile |

## Sequence diagram

```mermaid
sequenceDiagram
    actor Student as Enrolled Student
    participant Adviser as Disability Adviser
    participant Assessor as Specialist Assessor
    participant Registry
    participant SRS

    Student->>Adviser: 1. Open a confidential case and confirm communication/access needs
    Adviser->>Assessor: 2. Collect proportionate evidence or arrange assessment
    Assessor->>Assessor: 3. Identify barriers across teaching, assessment and services
    Assessor->>Adviser: 4. Draft reasonable and implementable adjustment outcomes
    Adviser->>Adviser: 5. Approve or review the plan under delegated authority
    Registry->>SRS: 6. Send only the necessary approved outcome to the SRS for distribution
    alt Valid and authorised
        Registry-->>Student: Record and communicate outcome
    else Incomplete or exception
        Registry-->>Student: Retain case with owner and reason
    end
```

## Open questions and decisions

| ID | Question/decision | Owner | Status |
|---|---|---|---|
| OQ-1 | Confirm the authoritative owner, workflow boundary and detailed requirement/contract mapping | Process owner/architect | Open |
| OQ-2 | Which national, provider-type and mode variants require configuration? | Four-nation SME | Open |
| OQ-3 | Which evidence stays in a specialist system and what minimum outcome enters the SRS? | Data protection/data owner | **Answered (2026-08-15):** evidence content (medical letters, assessor reports, DSA award letters) stays entirely in the wellbeing module's own document store (`packages/documents`) and is never replicated into SRS; SRS receives only the typed `reasonable_adjustment` outcome record (type, scope, validity dates) plus an opaque back-reference to the case, no evidence content or clinical narrative. Still open: whether a real institutional EDRMS should sit behind the same storage interface in production, or the built-in Postgres-backed store is sufficient at scale — a deployment decision, not a process one. |

## Sources

| Source | Supported content |
|---|---|
| [SRC-055, SRC-057](../source-register.md) | External process, regulatory or sector evidence |
| [SRC-015–SRC-019](../source-register.md) | Revelation workflows, actors, contracts, data and requirements |

## Related processes

[Process inventory](../process-inventory.md); adjacent lifecycle processes in the [process map](../process-map.md).

## Review record

| Review | Reviewer | Date | Outcome |
|---|---|---|---|
| Research/documentation | Codex implementation role | 2026-07-26 | Drafted |
| Implementation | Claude (production-hardening pass) | 2026-08-15 | Case workflow, document evidence, and core-SRS linkage built and tested; doc updated to match |
| Required reviews | Process, national, data and integration SMEs (TBC) | — | Pending |

## Change history

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1 | 2026-07-26 | Codex | Initial research draft |
| 0.2 | 2026-08-15 | Claude | Reflects the production-hardening pass: enforced state machine (BR-4/BR-5 moved from PROPOSED to IMPLEMENTED), evidence document storage (OQ-3 answered), "Panel" added as an escalation-only actor (was implemented in code but undocumented), core-SRS `source_case_id` traceability. The wellbeing-module case process itself remains eventless (no domain event stream) — the `srs.adjustment.*` events listed under Traceability belong to the core-SRS distributed-outcome record, not the case; this stayed out of scope for the same reason the module has no other event-publish capability today. |
