# Revelation SRS Change Backlog Derived from Business Processes

> Status: Proposed for architecture and product review
> Derived from: BP-001–BP-063 version 0.1
> Prepared: 2026-07-26

[Completion review](completion-review.md) · [Traceability matrix](traceability-matrix.md) · [Process inventory](process-inventory.md)

## Priority model

- **P0** — regulatory, academic-record integrity, privacy or identity control.
- **P1** — core workflow/data capability needed for faithful end-to-end operation.
- **P2** — resilience, usability or lower-volume lifecycle capability.

These proposed business-requirement IDs do not replace existing functional requirements until architecture governance accepts them.

## Workflow requirements

| ID | Priority | Requirement | Source | Acceptance evidence |
|---|---:|---|---|---|
| BPR-W01 | P1 | Decompose W001 into application intake, assessment, offer, confirmation, conversion and registration | BP-001–BP-010 | Independent states, owners, deadlines and history |
| BPR-W02 | P0 | Add governed CAS eligibility, approval, assignment and correction | BP-005, BP-052 | Guidance version, evidence, approver, SMS request and receipt retained |
| BPR-W03 | P1 | Add transfer, return, non-registration decision and leaver closure | BP-013, BP-015, BP-018–BP-019 | Effective dates, authority and per-target terminal outcomes |
| BPR-W04 | P1 | Add atomic curriculum/assessment publication and cohort-impact control | BP-020–BP-021, BP-033 | Complete version published or rejected as one unit |
| BPR-W05 | P1 | Add module proposal, approval/exception, waitlist and atomic add/drop | BP-022–BP-024 | Proposed and registered states cannot be confused |
| BPR-W06 | P1 | Add PGR supervision, progress, thesis examination and completion | BP-026, BP-029, BP-042, BP-049 | Panels, decisions, corrections and effective history retained |
| BPR-W07 | P0 | Separate engagement alert, support intervention, status decision and sponsor reporting | BP-027–BP-028, BP-052 | Raw attendance cannot directly cause an adverse status/report |
| BPR-W08 | P0 | Add privacy-preserving support/exceptional-circumstances distribution | BP-030–BP-032 | Specialist evidence restricted; target acknowledgements retained |
| BPR-W09 | P0 | Decompose W005 into setup, entry, mark, moderation, calculation, board, ratification and publication | BP-033–BP-041 | Rule versions and immutable stage authority are auditable |
| BPR-W10 | P0 | Add post-ratification correction and republication orchestration | BP-043 | Original/corrected outcomes and acknowledgements retained |
| BPR-W11 | P1 | Separate progression, reassessment, award recommendation, conferment, documents and ceremony | BP-044–BP-048 | Award existence is independent of issue/attendance |
| BPR-W12 | P0 | Add specification-versioned statutory submission, sign-off and quality correction | BP-050–BP-057 | Submitted values are reproducible from source/transformation |
| BPR-W13 | P0 | Add identity, individual-rights, retention/disposal and audit workflows | BP-058–BP-063 | Authority, propagation and immutable evidence demonstrable |

## Data-model requirements

| ID | Priority | Entity/capability | Essential content | Source |
|---|---:|---|---|---|
| BPR-D01 | P1 | `application_received_payload`, `application_assessment` | Channel/cycle, payload hash, criterion version, evidence, assessor, recommendation | BP-001–BP-002 |
| BPR-D02 | P1 | Versioned `offer_condition` and confirmation | Evidence, status, waiver authority, decision and response source | BP-003–BP-004 |
| BPR-D03 | P0 | `cas_case`, `cas_assignment_version` | Sponsor, guidance, eligibility, approval, assigned payload and SMS status | BP-005 |
| BPR-D04 | P1 | Registration/status case and target work item | Reason, evidence, authority, effective/transaction time and acknowledgement | BP-008–BP-019 |
| BPR-D05 | P1 | Curriculum publication and route/rule binding | Publication, cohort, route, rules, recognised credit, exception and interval | BP-020–BP-021 |
| BPR-D06 | P1 | Module proposal, validation, approval and waitlist | Preferences, rule version, failures, approver, capacity and registration transition | BP-022–BP-024 |
| BPR-D07 | P1 | Supervision case and PGR review | Roles, approval, interval, panel, evidence, milestone and outcome | BP-026, BP-029 |
| BPR-D08 | P0 | Expected engagement event/evidence/intervention | Expected/observed activity, source, mode, correction and intervention | BP-027–BP-028 |
| BPR-D09 | P0 | Scoped support outcome/distribution | Effective instruction, visibility, target, version and acknowledgement | BP-030–BP-032 |
| BPR-D10 | P0 | Assessment pattern, attempt, raw/confirmed mark, moderation | Rule, component, attempt, marker, sample, change and sign-off | BP-033–BP-037 |
| BPR-D11 | P0 | Board snapshot/decision and examiner sign-off | Scope, cut-off, quorum, pack hash, discretion, lock and release | BP-039–BP-041 |
| BPR-D12 | P1 | Thesis examination/correction | Versions, restriction, examiners, reports, viva, outcome and deadline | BP-042, BP-049 |
| BPR-D13 | P0 | Academic outcome amendment | Superseded version, error, evidence, authority and republication | BP-043 |
| BPR-D14 | P1 | Progression explanation, reassessment plan, conferred award | Rule inputs, calculation trace, discretion, attempt and conferment authority | BP-044–BP-046 |
| BPR-D15 | P1 | Issued document and ceremony attendance | Template, issue/revocation/verification and ceremony allocation | BP-047–BP-048 |
| BPR-D16 | P0 | Regulatory collection, lineage, submission and issue | Specification, snapshot, transform, validation, sign-off, receipt and correction | BP-050–BP-057 |
| BPR-D17 | P0 | Identity-resolution and bitemporal correction | Candidate facts, evidence, decision, survivor/link and propagation | BP-058–BP-059 |
| BPR-D18 | P0 | Rights, restriction, retention, hold and disposal | Legal basis, scope, deadline, recipients, trigger and evidence | BP-060–BP-062 |
| BPR-D19 | P0 | Tamper-evident access/change audit | Actor, role, purpose, object, action, time, before/after and correlation | BP-063 |

Material student-record entities require effective and transaction time whenever a historic fact can be corrected retrospectively.

## Integration requirements

| ID | Priority | Requirement | Source |
|---|---:|---|---|
| BPR-I01 | P1 | Reusable exchange ledger with target, schema, correlation/idempotency, attempt, acknowledgement and reconciliation | BP-007, BP-012, BP-019, BP-025, BP-032 |
| BPR-I02 | P1 | Admissions assessment/results, Clearing permission/choice and confirmation reconciliation contracts | BP-001–BP-006 |
| BPR-I03 | P0 | Bidirectional UKVI SMS evidence/correction without making SMS the academic record | BP-005, BP-009, BP-052 |
| BPR-I04 | P1 | Curriculum and assessment-pattern version contracts with atomic high-water marks | BP-020, BP-033 |
| BPR-I05 | P1 | Per-registration reconciliation across Timetabling, VLE, Attendance and Exam Scheduling | BP-024–BP-025, BP-034 |
| BPR-I06 | P1 | HR/CRIS supervision and PGR milestone reconciliation with canonical identifiers | BP-026, BP-029, BP-042, BP-049 |
| BPR-I07 | P0 | Minimum-necessary support contracts with correction and withdrawal | BP-030–BP-032, BP-034 |
| BPR-I08 | P0 | Mark-set, board-snapshot and ratified-result version identifiers | BP-035–BP-041 |
| BPR-I09 | P1 | Document issue, revocation and verification acknowledgements | BP-046–BP-048 |
| BPR-I10 | P0 | Explicit SFC, Medr and DfE contracts; preserve HESA/OfS specification versions | BP-050, BP-053–BP-057 |
| BPR-I11 | P0 | National finance scheme/response identifiers without collapsing SFE, SFW, SAAS and SFNI | BP-051 |
| BPR-I12 | P0 | Identity merge, correction, restriction, erasure and disposal propagation | BP-058–BP-062 |

## Domain-event requirements

Events represent completed authoritative facts, not requests or provisional selections.

| Family | Minimum events |
|---|---|
| Admissions | Application received/assessed; offer versioned/responded; conditions confirmed; CAS assigned; applicant converted |
| Status | Registration prepared/completed; transfer/interruption/return/withdrawal effective; closure completed |
| Curriculum | Curriculum published; route/rules assigned; selection approved; registration changed/provisioned |
| PGR | Supervision approved/changed; progress recorded; thesis submitted/examined; candidature completed |
| Support/assessment | Support effective/withdrawn; mark set confirmed; result ratified/corrected |
| Awards | Progression decided; reassessment created; award conferred; document issued/revoked |
| Regulatory/governance | Submission accepted/amended; identity resolved; fact corrected; processing restricted; record disposed |

## Architecture decision sequence

1. Approve business authority and state boundaries.
2. Approve entity ownership and temporal semantics.
3. Reconcile proposed entities with the physical model.
4. Assign or update functional requirement IDs.
5. Define privacy-classified contracts and events.
6. Decompose or add durable workflows.
7. Add acceptance scenarios linked to BP steps and alternatives.

