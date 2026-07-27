# Current Capability Matrix

> Status: Authoritative working baseline
> Evidence date: 2026-07-27
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
| Person identity and student profile | **Implemented baseline** | Person/identity/contact schemas, student service and portal profile routes | Duplicate resolution, correction cases and rights propagation are not implemented |
| Admissions and applicant conversion | **Partial** | UCAS application schema/service, admissions workflow hand-off and communications | No channel-neutral application assessment, offer-condition aggregate, Clearing permission or governed conversion boundary |
| CAS and Student sponsor compliance | **Partial** | UKVI CAS request, visa status, attendance report/alert schemas and UKVI service/admin UI | Eligibility checks, guidance version, approval evidence, immutable assignment versions and decision/report separation are absent |
| Initial/annual registration and status | **Partial** | Enrolment, status transition, fee liability, re-enrolment schemas/services and portal views | Transfer, return, non-registration decision and leaver closure cases are incomplete |
| Curriculum and catalogue | **Partial** | Programme, route, rule-set, module, relationships, assessment-pattern and calendar schemas/services | No atomic curriculum publication or explicit effective enrolment rule binding |
| Module selection and registration | **Partial** | Module registration service, registration table and portal module-add route | Selection proposal, approval/exception, waitlist and atomic substitution are absent; service currently creates confirmed registration directly |
| Attendance and academic engagement | **Partial** | Migration `0037` and APIs implement expected events, idempotent observation correction, approved policy versions, deterministic evidence evaluation and explainable or reconciliation-suspended alerts | Integration tests await a container runtime; no intervention workflow or end-to-end application journey |
| Reasonable adjustments and exceptional circumstances | **Partial** | Adjustment/distribution, EC and board-visibility schemas/services; portal surfaces; wellbeing module | Minimum-necessary outcome boundary, target contract version, attempts and reconciliation are incomplete |
| Assessment marks and module results | **Partial** | Assessment component/submission, mark, result, calculation services and portal result views | Candidate attempt, mark-set/moderation evidence and complete rule-version explanation need extension |
| Exam Boards and ratification | **Partial** | Board, immutable pack/profile, attendance/sign-off schemas, Board service and admin UI | Structured board decisions, pack hash/rule manifest, ratification record and publication lifecycle are incomplete |
| Post-ratification correction | **Partial** | Correction case/amendment schemas and correction service | Exact before/after versions and per-consumer correction reconciliation are incomplete |
| Progression, awards and HEAR | **Partial** | Progression/award schemas and services, calculation evidence and HEAR service | Reassessment plan, recommendation/conferment separation, issued document lifecycle and ceremony are absent |
| PGR lifecycle | **Proposed target** | CRIS/HR contracts, value sets and logical concepts | Supervision, progress review, thesis examination, completion and physical PGR schemas are not implemented |
| HESA and regulatory exchanges | **Partial** | HESA return/submission/validation, UCAS, SLC, UKVI and OfS schemas/services/admin pages | Generic collection lineage/sign-off and explicit SFC, Medr and DfE returns are absent |
| Integration registry and exchange operations | **Partial** | Contract/registration/exchange schemas, registry service, VLE adapter and operations UI | Attempt rows do not yet form the proposed durable target/application-acknowledgement model |
| Individual rights, retention and audit | **Partial** | Append-only audit, audit UI/service, FOI records and retention anonymisation worker | DSAR, restriction/erasure decisions, legal holds, disposal certificates, tamper seals and audit-review cases are absent |
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
| Repository typecheck | **Fail** | VLE connector PostgreSQL telemetry option `dbStatementSerializer` does not match the installed instrumentation type; callback parameter is implicitly `any` |
| Repository unit-test command | **Blocked/fail in this environment** | Database suites require a working Testcontainers container runtime; workflow unit tests passed before the database package stopped the recursive run |
| Clean-clone application bootstrap | **Not verified in this review** | Must pass before collaborator preview |

## Current launch blockers

1. Fix the VLE connector type error and restore repository-wide type checking.
2. Make test prerequisites explicit and ensure `pnpm test` does not ambiguously mix unit and container-dependent suites.
3. Demonstrate clean-clone bootstrap, migration, demo load and selected UI journeys.
4. Approve or revise the first target ADRs before implementing proposed P0 schema.
5. Select and implement a coherent vertical slice rather than claiming BP-001–BP-063 coverage.

## Status governance

- A capability moves to **Implemented baseline** only with code, schema where required and repeatable verification evidence.
- A proposed ADR or requirement does not change application status.
- Each pull request changing capability status must update this matrix and cite tests.
- The historical phase roadmap does not override this matrix.
