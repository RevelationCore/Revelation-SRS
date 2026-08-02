# Current Capability Matrix

> Status: Authoritative working baseline
> Evidence date: 2026-08-02
> Application maturity: Alpha — analysis and implementation convergence

[Product documentation](README.md) · [Business process inventory](../business-processes/process-inventory.md) · [Target data-model delta](../architecture/business-process-data-model-delta.md)

## Status definitions

| Status | Required meaning |
|---|---|
| **Implemented baseline** | Relevant physical schema and application service/API exist, with a usable UI or integration surface where appropriate and automated evidence for the principal path |
| **Partial** | Useful implementation exists, but the reviewed process boundary, authority, data lifecycle, integration or verification is incomplete |
| **Approved target** | Architecture and requirements are approved for delivery but the application is not complete |
| **Proposed target** | Research/design exists but still requires SME or architecture approval |
| **Not assessed** | Evidence has not yet been reconciled |

“Implemented baseline” does not mean production-ready for every institution or process variant.

## Capability matrix

| Capability | Status | Implemented evidence | Material limitation / target |
|---|---|---|---|
| Tenant, temporal and value-set foundations | **Implemented baseline** | PostgreSQL RLS migrations; bitemporal helper; tenant/value-set services | Not every reviewed future entity exists; new tables must repeat these controls |
| Workflow, feature flag and environment platform | **Implemented baseline** | Workflow definition/runtime, task, gateway, feature-flag and environment schemas/services | Reviewed domain processes remain combined or service-driven; ADR-016 is accepted but not yet applied across all domains |
| Person identity and student profile | **Implemented baseline** | Person/identity/contact schemas, student service and portal profile routes; `identity_resolution_case`/`identity_resolution_candidate`/`identity_resolution_decision`/`person_identity_link`/`identity_redirect`/`data_correction_case` (migration `0051`) add candidate-only duplicate resolution and correction cases via API; admin UI (`IdentityResolutionPage`) covers open-case→candidates→decision, direct person linking and opening a correction case, plus a "Browse cases" tab (`GET /identity-resolution/cases`, `GET /identity-resolution/correction-cases`, joined against `business_case` for status/owner) so staff can find existing cases by ID/subject/status rather than only creating new ones blind | Browsing surfaces IDs/status only, not a resume-and-continue-editing flow; rights propagation from a merge decision (updating dependent records) is not implemented — the redirect row is created but nothing consumes it yet |
| Admissions and applicant conversion | **Partial** | UCAS application schema/service, admissions workflow hand-off and communications | No channel-neutral application assessment, offer-condition aggregate, Clearing permission or governed conversion boundary |
| CAS and Student sponsor compliance | **Partial** | UKVI CAS request, visa status, attendance report/alert schemas and UKVI service/admin UI; `cas_case`/`cas_eligibility_check`/`cas_assignment_version`/`sponsor_report_version` (migration `0045`) add governed eligibility checks, guidance version, approval evidence and immutable assignment/report versions via API, with a per-enrolment admin UI (`StudentDetailPage` CAS tab) for open-case→eligibility-check→assignment-version→sponsor-report-version | `cas_case` remains a separate aggregate from `ukvi_cas_request` (UkviPage's existing CAS tab) — no bridge between the two yet; Temporal workflow orchestration is not implemented |
| Initial/annual registration and status | **Partial** | Enrolment, status transition, fee liability, re-enrolment schemas/services and portal views | Transfer, return, non-registration decision and leaver closure cases are incomplete |
| Curriculum and catalogue | **Partial** | Programme, route, rule-set, module, relationships, assessment-pattern and calendar schemas/services; `module_group`/`module_group_member` (migration `0005`) give `programme_rule_set` its first real diet content (compulsory/optional-pool/elective-pool groups with count/credit/level bounds) via API; `enrolment_curriculum_binding` (migration `0005`) resolves the explicit effective-enrolment rule binding via `ModuleSelectionService`, automatic on first proposal or explicit via API | No atomic curriculum publication (multi-entity versioned release) |
| Module selection and registration | **Partial** | `ModuleSelectionService`/`module_selection_proposal`/`module_selection_proposal_item` (migration `0005`) add the draft→submitted→validated→approved/returned/waitlisted/rejected→confirmed proposal lifecycle via API, with diet-group/credit-load/level-composition/prerequisite/co-requisite/exclusion/capacity validation, a `module-selection-approval` workflow instance for capacity exceptions, and portal (`ModuleSelectionPage`) + admin (`ModuleSelectionProposalsPage`) UI; direct confirmed registration via `module-registrations` still exists unchanged for the no-diet-rules path | No timetable-clash detection (policy is configurable but no timetable-slot entity exists to check against), joint-honours-balance and repeat-module-requirement rule types are not consumed by validation yet, no ranked/oversubscribed preference allocation (capacity conflict is all-or-nothing per module, not ranked across students), and no selection-window (open/close date) enforcement |
| Attendance and academic engagement | **Implemented baseline** | The completed vertical slice uses migrations `0037`–`0040`, APIs and admin workspaces for evidence, policy evaluation, explainable alerts, intervention casework, minimum referrals, an immutable UKVI evidence snapshot, separate human sponsor decisions, independent authorisation and operational status. Under OrbStack, focused database, API, golden-data and browser scenarios pass | Institution-specific policy, authority, retention and live UKVI transport approval remain deployment responsibilities |
| Reasonable adjustments and exceptional circumstances | **Partial** | Adjustment/distribution, EC and board-visibility schemas/services; portal surfaces; wellbeing module; `support_outcome` (migration `0046`) adds a minimum-necessary outcome boundary with per-target `distribution_item` delivery via API | No admin/portal UI for the new support-outcome aggregate; attempt/acknowledgement reconciliation is created but not yet consumed by a dashboard |
| Assessment marks and module results | **Partial** | Assessment component/submission, mark, result, calculation services and portal result views; `assessment_candidate_attempt`/`mark_set`/`moderation_review`/`moderation_sample` (migration `0047`) add moderation evidence via API, bridged from `mark.attempt_number`, with an admin console (`ModerationPage`) walking mark-set→review→sample→outcome plus a reviews list (`GET /moderation/reviews`, filterable to open-only) | Complete rule-version explanation for calculation still needs extension |
| Exam Boards and ratification | **Partial** | Board, immutable pack/profile, attendance/sign-off schemas, Board service and admin UI; `board_member_conflict`/`board_quorum_decision`/`exam_board_decision`/`ratification_record`/`result_publication` (migration `0048`) add structured decisions, quorum and a publication lifecycle via API, additive to the existing ratify/lock action, with a dedicated "authority" tab on `ExamBoardDetailPage` covering conflicts, quorum, decision, ratification and publish end-to-end | pack_hash/rule_manifest_ref columns exist but are not yet populated by pack generation |
| Post-ratification correction | **Partial** | Correction case/amendment schemas and correction service; migration `0049` adds error category/evidence/authority to the case and before/after version references plus per-consumer `distribution_item` delivery to the amendment, and repoints the case-status value set at the one whose members actually match what the service writes; admin UI (`StudentDetailPage` Corrections tab) now captures error category/evidence/authorised-by on case creation and drives amendment distribution | Before/after version references are stored but not yet populated from `source_version_reference` rows |
| Progression, awards and HEAR | **Partial** | Progression/award schemas and services, calculation evidence and HEAR service | Reassessment plan, recommendation/conferment separation, issued document lifecycle and ceremony are absent |
| PGR lifecycle | **Proposed target** | CRIS/HR contracts, value sets and logical concepts | Supervision, progress review, thesis examination, completion and physical PGR schemas are not implemented |
| HESA and regulatory exchanges | **Partial** | HESA return/submission/validation, UCAS, SLC, UKVI and OfS schemas/services/admin pages; `regulatory_collection`/`collection_snapshot`/`regulatory_record`/`regulatory_field_lineage`/`regulatory_validation_issue`/`regulatory_signoff`/`regulatory_submission` (migration `0050`) add a regulator-neutral collection/lineage/sign-off/submission model via API, with `HESA\|OFS\|SFC\|MEDR\|DFE-NI` regulator codes so Scotland/Wales/NI collections use the same model, and an admin console (`RegulatoryCollectionsPage`) walking collection→snapshot→records→validation→signoff→submit plus a collections list (`GET /regulatory/collections`, filterable by regulator/academic year) | No route for `recordFieldLineage` yet; SFC/Medr/DfE-NI get generic collection support only, not their specific field-format specifications (not available in this repo); HESA/OfS bridge columns exist but existing services don't yet populate them |
| Integration registry and exchange operations | **Partial** | Contract/registration/exchange schemas, registry service, VLE adapter and operations UI | Attempt rows do not yet form the proposed durable target/application-acknowledgement model |
| Individual rights, retention and audit | **Partial** | Append-only audit, audit UI/service, FOI records and retention anonymisation worker; `individual_rights_request`/`rights_decision`/`processing_restriction`/`retention_schedule`/`retention_assignment`/`record_hold`/`record_disposition` (migration `0052`) add DSAR, restriction and hold-gated disposal via API, extending `business_case`; migration `0053` adds a SHA-256 hash chain computed in `AuditService.record()` (every call site unchanged) plus `audit_partition_seal`/`audit_review_case`/`audit_review_finding`; admin UI (`RightsRequestsPage`, `AuditReviewPage`) covers the DSAR/restriction/retention chain and audit-review case/finding/partition-seal actions, each now with a browsable list (`GET /rights-requests`, `GET /retention-schedules`, `GET /retention-assignments` with derived hold/disposed status, `GET /audit-review/cases`) | The retention-anonymisation worker is untouched (no historical backfill); pre-migration audit rows have `record_hash = NULL` and are not retroactively covered by tamper evidence, matching the migration plan's rule against claiming pre-seal integrity |
| Student portal and administration UI | **Partial** | Profile, enrolment, modules, results, exams, adjustments, circumstances and regulatory/admin pages | Pages expose existing capabilities but do not prove all documented end-to-end process variants |
| Demo and migration tooling | **Partial** | Demo scenarios, data loaders and SITS/Banner migration tools | Clean-clone bootstrap and full verification are not currently demonstrated by one passing command |

## Approved-target position

ADR-016, ADR-017, ADR-019 and ADR-022 are accepted for generic product implementation. ADR-018, ADR-020 and ADR-021 remain proposed. Institutional policy, privacy, records, integration and sponsor approvals remain deployment responsibilities and must not be inferred from generic product status.

## Verification snapshot

| Check | Result on 2026-07-27 | Interpretation |
|---|---|---|
| Business-process documentation | Pass — 63 pages | Structural documentation integrity only |
| P0 requirement/ADR coverage | Pass — 23 P0 items, 76 requirements, 7 ADRs | Traceability complete; ADRs remain proposed |
| Data-model delta coverage | Pass — 19 capabilities | Target design complete; migrations not implemented |
| Repository typecheck | Pass | `pnpm typecheck` passes across all 13 checked workspace projects; PostgreSQL telemetry uses the supported typed request hook |
| Repository unit-test command | Pass under OrbStack | `pnpm test` completes across the workspace; focused attendance runtime evidence also includes 5 database invariant tests, 13 API integration scenarios and 18 CI-golden integration tests |
| Clean-clone application bootstrap | **Not verified in this review** | Must pass before collaborator preview |

## Current launch blockers

1. Make test prerequisites explicit and ensure `pnpm test` does not ambiguously mix unit and container-dependent suites.
2. Demonstrate clean-clone bootstrap, migration, demo load and selected UI journeys.
3. Approve or revise the remaining target ADRs before implementing their proposed P0 schema.

## Status governance

- A capability moves to **Implemented baseline** only with code, schema where required and repeatable verification evidence.
- A proposed ADR or requirement does not change application status.
- Each pull request changing capability status must update this matrix and cite tests.
- The historical phase roadmap does not override this matrix.
