# Business Process Data-Model Delta Assessment

> Status: Living assessment, re-baselined against the schema
> Originally assessed: 2026-07-27 · Re-baselined: 2026-11-15
> Scope: BPR-D01–BPR-D19

[Current logical model](data-model.md) · [Target model](business-process-target-data-model.md) · [Migration plan](business-process-data-migration-plan.md) · [Source backlog](../business-processes/revelation-change-backlog.md) · [Current capabilities](../product/current-capabilities.md)

## Executive result

| Primary disposition | Count | Meaning |
|---|---:|---|
| Existing sufficient | 0 | No BPR-D capability is complete in both the data model and the services, APIs and UI that use it |
| Partial implementation | 18 | The authoritative aggregate (the first table the target model names) exists; remaining work is tracked as limitations in [current capabilities](../product/current-capabilities.md) |
| Extend existing aggregate | 0 | A suitable implemented aggregate exists outside the target tables, which are still to be added |
| New aggregate | 0 | No implemented authoritative aggregate covers the process outcome |
| Resolved — no extension planned | 1 | The existing model was confirmed as the target and nothing further is planned |

“New aggregate” does not mean every supporting table is absent. It means the authoritative process outcome cannot be represented faithfully by extending one existing root alone.

`npm run check:business-process-data-model` keeps this table honest. It reads the tables each row names in the [target model](business-process-target-data-model.md), and finds which of them the core, module and adapter migrations create. A row marked New aggregate or Extend whose tables all exist fails, as does a Partial implementation row whose root table does not exist.

### Re-baseline, 2026-11-15

The original assessment (2026-07-27) predated the 2026-08-02 migration squash, which carried most of the P0 data model into the baseline. Until 2026-11-15 the assessment was not updated to match, and the check enforced the old counts. Ten rows marked New aggregate or Extend already had every target table. The re-baseline moved D03, D06, D10, D11, D13 and D16–D19 to Partial implementation. Two target-table names were also corrected to match what was built: D05 (`enrolment_curriculum_binding`) and D06 (`module_selection_proposal_item`).

## Assessment method

Each item was checked against:

1. entity definitions in [data-model.md](data-model.md);
2. Drizzle schemas under `packages/db/src/schema` and the module schemas;
3. SQL migrations under `packages/db/migrations`, `modules/*/migrations` and `adapters/*/migrations`;
4. the P0 requirements and ADR-016–ADR-023; and
5. lifecycle, temporal, authority and integration evidence required by its BP pages.

## Capability assessment

| ID | Priority | Logical model today | Physical model today | Disposition | Remaining delta |
|---|---:|---|---|---|---|
| BPR-D01 | P1 | `student_application` contains working application facts | Append-only `application_received_payload` (idempotent per channel, reference and hash), channel-neutral `student_application` (applicant matched only on certain evidence; uncertain matches routed for review, never merged; incomplete/duplicate/restricted worklists) and append-only `application_assessment` with assessor and evidence version (migration `0011_applications_and_offers`) | **Partial implementation** | The UCAS adapter still writes `ucas_application` and does not yet create `student_application` (the `ucas_application_id` bridge column is unused); no channel acknowledgement or application-received event |
| BPR-D02 | P1 | `admissions_offer` exists conceptually | `admissions_offer` (decided by someone other than the recommender; an authorised change is a new version; expiry enforced against the channel timestamp), `offer_condition`, `condition_evidence` with provenance (met only on verified evidence; waivers need a reason) and append-only `offer_confirmation_decision` freezing the tested conditions and starting the enrolment hand-off (migration `0011_applications_and_offers`) | **Partial implementation** | Offers are versioned rows rather than bitemporal; offers are not yet published to UCAS; results are not mapped to conditions automatically |
| BPR-D03 | P0 | `cas_request`, `cas_assignment`, `ukvi_compliance_case` are described | `cas_case`, `cas_eligibility_check`, `cas_assignment_version`, `sponsor_report_version` exist beside the older `ukvi_cas_request` | **Partial implementation** | Bridge `cas_case` and `ukvi_cas_request` (the UKVI page's CAS tab still uses the latter) |
| BPR-D04 | P1 | Enrolment, transitions and exchange work are described | `student_status_case` (rooted on `business_case`; interruption, suspension, return, withdrawal, transfer, leaver closure), `status_case_assessment` and `status_case_condition` (migration `0007_student_status_cases`). Approval applies the change to the enrolment and references the resulting `enrolment_status_transition`; a return waits for the interruption's conditions | **Partial implementation** | Non-registration decisions; reduced-intensity study (BP-02-007 A5); recognised-credit mapping on transfer (with D05); fee and SLC/UKVI recalculation beyond the existing transition triggers; admin and portal screens |
| BPR-D05 | P1 | Programme route/rule sets exist | `curriculum_publication`/`curriculum_publication_item` (versioned release from the curriculum system, classified add/change/close/unchanged, rejected whole if any item is invalid, applied in one transaction and refused if the catalogue changed since receipt), `recognised_credit` and `rule_exception` (proposed and approved by different people), with `enrolment_curriculum_binding` (migration `0008_curriculum_publication`) | **Partial implementation** | Publications cover programmes and modules only (not routes, rule sets, outcomes or offerings); the rules engine does not yet read in-force rule exceptions or recognised credit; no cohort-transition rules (BP-03-001 A5) |
| BPR-D06 | P1 | `module_registration` represents confirmed registration | `module_selection_proposal` and `module_selection_proposal_item` (choices with preference rank and per-item validation state), decision authority on the proposal, approval through the workflow bridge | **Partial implementation** | Add `module_capacity_hold` and `registration_change_set`; ranked oversubscription allocation, selection windows, timetable clash |
| BPR-D07 | P1 | `staff_assignment` and `research_milestone` are described | `pgr_supervision_case`/`pgr_supervisor_nomination`/`staff_assignment` (BP-03-007) and `pgr_progress_review`/`pgr_review_member`/`research_milestone` (BP-04-003), rooted on `business_case` per ADR-023, with services, APIs and admin UI | **Partial implementation** | No portal-facing student/supervisor views yet; HR/CRIS exchanges are recorded but not integrated with a live external system |
| BPR-D08 | P0 | Attendance, absence alert and engagement summary are described | The attendance module (`modules/attendance`, schema `attendance`) implements policy, expected event, observation and revision, alert, intervention, contact, action and referral storage, with services, APIs and admin workspaces | **Partial implementation** | Institution-specific policy, authority, retention and live UKVI transport approval remain deployment responsibilities |
| BPR-D09 | P0 | Adjustment and per-target distribution are described | `adjustment_distribution` (per-target status) is the live, tested path: per-target instructions, acknowledge/failure/withdrawal replies, fulfilment modes and a manual queue, expiry cascade and domain events. A `support_outcome`/shared `distribution_item` alternative was retired (2026-08-17) rather than extended to parity: it never gained an acknowledge path, events or supersede handling, and had no caller in the real workflow | **Resolved — no extension planned** | None. `business_case`/`distribution_item`/`distribution_attempt`/`distribution_acknowledgement` remain available as shared primitives for other domains (used today by BPR-D13 corrections); reasonable-adjustments distribution is not a target consumer of them |
| BPR-D10 | P0 | Assessment patterns/components/submissions/marks/results exist | `assessment_candidate_attempt`, `mark_set`, `mark_set_member`, `moderation_review`, `moderation_sample` exist | **Partial implementation** | Complete rule-version explanation for calculation |
| BPR-D11 | P0 | Board, pack, profile, attendance and sign-off exist | `board_member_conflict`, `board_quorum_decision`, `exam_board_decision`, `ratification_record`, `result_publication` exist; pack `pack_hash`/`rule_manifest_ref` columns exist | **Partial implementation** | Populate `pack_hash` and `rule_manifest_ref` during pack generation |
| BPR-D12 | P1 | Research milestones only | `pgr_examination_case`/`thesis_submission`/`examiner_appointment`/`examiner_report`/`viva_event`/`pgr_examination_outcome`/`thesis_correction_requirement` (BP-05-010) and `pgr_completion_case`/`final_thesis_deposit` (BP-06-006), following ADR-020's staged-authority pattern, with services, APIs and admin UI; `award` additively relaxed for research-award conferral | **Partial implementation** | No portal-facing student/examiner views yet; no live repository integration for thesis deposit |
| BPR-D13 | P0 | Post-ratification case/amendment exists | Case and amendment carry error category, evidence and authority; correction distribution uses `distribution_item` | **Partial implementation** | Populate before/after version references from `source_version_reference` rows |
| BPR-D14 | P1 | Progression decision and award exist | `reassessment_plan` (from a ratified resit/repeat-year decision; attempt numbering, mark cap, deferral as first-attempt treatment), `award_recommendation` (bound to the calculated classification; discretion recorded with a reason; aegrotat/posthumous cite policy authority) and append-only `award_conferment` by a delegated authority who is not the recommender, which creates the award (migration `0009_reassessment_and_conferment`) | **Partial implementation** | The direct `POST /enrolments/{id}/award` route still confers without a recommendation; reassessment plans are not yet created automatically at ratification or linked to new marks; no joint/dual award responsibilities (BP-06-003 A2); no progression explanation manifest |
| BPR-D15 | P1 | `student_document` and archive acknowledgement are described | `student_document`, numbered `document_issue` (content snapshot, SHA-256 hash, verification code; replacement and corrected-name issues supersede, history kept), append-only `document_revocation`, `document_verification` log; `graduation_cycle`, `graduation_ceremony`, `graduation_invitation` (derived from conferred awards; deferrals re-invited) and capacity-checked `ceremony_allocation` with attendance recorded apart from the award (migration `0010_documents_and_graduation`) | **Partial implementation** | Documents record content and a hash but no rendered PDF or cryptographic signature yet; verification is an authenticated API (no public verification page); HEAR still lives as JSON on `award`; no partner/joint/bilingual templates; no ticketing |
| BPR-D16 | P0 | HESA-specific return/submission/issue entities exist | Regulator-neutral `regulatory_collection`, `collection_snapshot`, `regulatory_record`, `regulatory_field_lineage`, `regulatory_validation_issue`, `regulatory_signoff`, `regulatory_submission` exist beside the HESA tables | **Partial implementation** | Adapt HESA and the other national returns onto the neutral model; SFC/Medr/DfE specifics |
| BPR-D17 | P0 | Person/identity/verification and bitemporal correction primitives exist | `identity_resolution_case`, candidate, decision, `person_identity_link`, `identity_redirect` and `data_correction_case` exist with service and admin UI | **Partial implementation** | Propagate a merge decision to dependent records (the redirect row is created but nothing consumes it yet) |
| BPR-D18 | P0 | No general rights/retention/hold/disposal model | Rights request, scope, search manifest, decision, processing restriction, retention schedule/assignment, record hold and disposition exist | **Partial implementation** | Connect the retention-anonymisation worker to retention schedules (no historical backfill) |
| BPR-D19 | P0 | Append-only `audit_record` described | `audit_record` extended with hash chaining; `audit_partition_seal`, `audit_review_case`, `audit_review_finding` exist | **Partial implementation** | Audit rows written before hash chaining have no hash and are not retroactively covered by tamper evidence (by design) |

## Principal model findings

### Logical model ahead of implementation

Student document and archive-confirmation entities, admissions offers and student status cases appear in `data-model.md` but not in the schema. (Staff assignment, research milestone and attendance/engagement storage, listed here originally, have since been built.)

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

ADR-016, ADR-017, ADR-019 and ADR-022 are accepted for generic product implementation. The remaining ADRs retain their domain-specific gates.
