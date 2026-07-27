# Business Process Data-Model Delta Assessment

> Status: Proposed target-model assessment
> Date: 2026-07-27
> Scope: BPR-D01–BPR-D19

[Current logical model](data-model.md) · [Target model](business-process-target-data-model.md) · [Migration plan](business-process-data-migration-plan.md) · [Source backlog](../business-processes/revelation-change-backlog.md)

## Executive result

| Primary disposition | Count | Meaning |
|---|---:|---|
| Existing sufficient | 0 | No BPR-D capability is complete in both the documented logical and implemented physical model |
| Extend existing aggregate | 8 | A suitable implemented aggregate exists but requires fields, child entities or stronger semantics |
| New aggregate | 11 | No implemented authoritative aggregate covers the process outcome |

“New aggregate” does not mean every supporting table is absent. It means the authoritative process outcome cannot be represented faithfully by extending one existing root alone.

## Assessment method

Each item was checked against:

1. entity definitions in [data-model.md](data-model.md);
2. Drizzle schemas under `packages/db/src/schema`;
3. SQL migrations `0000`–`0033`;
4. the P0 requirements and ADR-016–ADR-022; and
5. lifecycle, temporal, authority and integration evidence required by its BP pages.

## Capability assessment

| ID | Priority | Logical model today | Physical model today | Disposition | Required delta |
|---|---:|---|---|---|---|
| BPR-D01 | P1 | `student_application` contains working application facts | `ucas_application` only; raw UCAS payload but no channel-neutral intake or assessment | **New aggregate** | Add `application_received_payload`, channel-neutral `student_application` root and `application_assessment`; bridge existing UCAS IDs/payloads |
| BPR-D02 | P1 | `admissions_offer` exists conceptually | No Drizzle `admissions_offer` or condition tables | **New aggregate** | Add bitemporal offer, versioned conditions, evidence/result mapping, waiver and confirmation decision |
| BPR-D03 | P0 | `cas_request`, `cas_assignment`, `ukvi_compliance_case` are described | `ukvi_cas_request` is narrow; no assignment version/check/evidence relationship | **Extend** | Evolve request into `cas_case`; add eligibility checks, approval, guidance version and immutable assignment/report versions |
| BPR-D04 | P1 | Enrolment, transitions and exchange work are described | `enrolment`, `enrolment_status_transition`, `enrolment_downstream_trigger` exist | **New aggregate** | Add governed `student_status_case`, evidence/decision/condition children and target work linked to existing transition |
| BPR-D05 | P1 | Programme route/rule sets exist | Route/rule tables exist, but enrolment has no explicit effective binding/publication root | **Extend** | Add `curriculum_publication`, `enrolment_rule_binding`, recognised-credit and authorised rule-exception records |
| BPR-D06 | P1 | `module_registration` represents confirmed registration | Physical registration goes directly to `registered`/withdrawn/completed | **New aggregate** | Add `module_selection_proposal`, choices/preferences, validation results, approvals/exceptions, waitlist/capacity hold and atomic change set |
| BPR-D07 | P1 | `staff_assignment` and `research_milestone` are described | Neither is implemented in Drizzle/migrations | **New aggregate** | Add supervision case/decision, bitemporal staff assignments, PGR review/panel/evidence and milestones |
| BPR-D08 | P0 | Attendance, absence alert and engagement summary are described | No attendance/engagement tables are implemented | **New aggregate** | Add expected engagement event, observed evidence/correction, alert and intervention case; retain judgement separately from evidence |
| BPR-D09 | P0 | Adjustment and per-target distribution are described | Both tables exist but lack decision reference, visibility, outcome version, contract/correlation, attempts and acknowledgement | **Extend** | Minimise outcome content; add source decision, review/supersession and full per-target exchange state |
| BPR-D10 | P0 | Assessment patterns/components/submissions/marks/results exist | Implemented, but attempt is embedded on mark and moderation is workflow/audit only | **Extend** | Add candidate attempt, mark-set, moderation sample/decision, rule-version binding and calculation evidence relationships |
| BPR-D11 | P0 | Board, pack, profile, attendance and sign-off exist | Implemented with source time/version; no pack hash, rule manifest, conflict/quorum decision, board-decision row or publication lock | **Extend** | Add pack hash/manifest, member conflicts, quorum decision, structured board decision and ratification/publication records |
| BPR-D12 | P1 | Research milestones only | No thesis submission, examiner, report, viva, correction or final deposit entities | **New aggregate** | Add `pgr_examination_case` and immutable thesis/examination/deposit children |
| BPR-D13 | P0 | Post-ratification case/amendment exists | Implemented but amendment lacks explicit superseded/result versions and per-consumer republication | **Extend** | Add error/evidence/authority fields, before/after version references and correction distribution |
| BPR-D14 | P1 | Progression decision and award exist | Implemented; no reusable reassessment plan, board recommendation/conferment separation or explanation manifest | **Extend** | Add `reassessment_plan`, progression evidence binding, award recommendation and immutable conferment event |
| BPR-D15 | P1 | `student_document` and archive acknowledgement are described | No document tables in Drizzle; HEAR is JSON on `award`; no ceremony model | **New aggregate** | Add issued document/version/revocation/verification and graduation cycle/invitation/attendance/allocation |
| BPR-D16 | P0 | HESA-specific return/submission/issue entities exist | HESA tables implemented; OfS is flat; no generic collection, field lineage, sign-off or SFC/Medr/DfE models | **New aggregate** | Add regulator-neutral collection/snapshot/lineage/validation/sign-off/submission model and adapt HESA/national returns |
| BPR-D17 | P0 | Person/identity/verification and bitemporal correction primitives exist | Implemented; no identity-resolution/correction case, survivor/link or propagation model | **New aggregate** | Add `identity_resolution_case`, candidate/decision/link/redirect and `data_correction_case` |
| BPR-D18 | P0 | No general rights/retention/hold/disposal model | FOI and person anonymisation timestamp only | **New aggregate** | Add rights request/decision/search/disclosure, processing restriction, retention schedule/assignment, hold and disposition certificate |
| BPR-D19 | P0 | Append-only `audit_record` described | Implemented but lacks role/purpose/request metadata, hash chaining/seal and review case | **Extend** | Extend audit metadata; add partition/seal verification and `audit_review_case`/finding |

## Principal model findings

### Logical model ahead of implementation

Attendance, engagement, staff assignment, research milestone, student document and archive-confirmation entities appear in `data-model.md` but not in the Drizzle schema or migrations. They must not be counted as implemented capabilities.

### Physical model ahead of business semantics

Workflow configuration and several assessment/regulatory tables are implemented, but their business authority is too implicit:

- a workflow decision audit is not a substitute for an authoritative case decision;
- `locked = true` does not by itself identify the board pack and decision that created the lock;
- one integration-exchange row per attempt does not provide one durable target item with application acknowledgement;
- an anonymisation timestamp is not a retention schedule, legal hold or disposal certificate.

### Temporal rules

- Continue ADR-013 four-column bitemporal storage for mutable facts.
- Use append-only rows for received payloads, submissions, evidence manifests, board packs, sign-offs, reports, issued documents, exchange attempts and disposal certificates.
- Use immutable event/decision rows for conferment and ratification.
- Reference both logical IDs and exact version IDs where a decision must be reproduced.

## Recommended implementation order

1. Shared case, evidence-reference, exact-version and target-exchange primitives.
2. P0 CAS, engagement/support and assessment authority.
3. P0 regulatory lineage and record governance.
4. P1 admissions, status, curriculum/module selection and PGR.
5. P1 progression, award documentation and graduation.

## Decision required

Architecture governance must approve ADR-016–ADR-022 and the target aggregates before physical migrations are authored. This assessment deliberately does not treat a proposed table name as an accepted API or storage contract.

