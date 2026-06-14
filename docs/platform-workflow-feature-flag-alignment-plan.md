# Platform Workflow, Feature Flag, and Environment Alignment Plan

> Date: 2026-06-13
> Status: Proposed
> Purpose: Bring the existing SRS code and data architecture into line with the updated principles for workflow-driven process variation, feature flags, environment promotion, and the Admissions refactor.

---

## Summary

The SRS already has strong foundations: bitemporal records, tenant isolation, value sets, domain events, integration exchange ledgers, a rules engine, audit records, and a Temporal package. However, several implemented domain processes still encode workflow decisions directly inside service methods or database check constraints.

The updated principles make three things explicit:

- Long-running institutional processes should be workflow-managed, not hidden in ad hoc state flags or procedural service logic.
- Process variation and optional capabilities should be controlled by feature flags and tenant configuration administered through the product.
- The same artefacts should promote through test, UAT, pre-production, and production with isolated configuration, data, secrets, integrations, and flag state.

This plan introduces a lightweight platform workflow and feature flag substrate before the Admissions module refactor becomes the first large source-neutral workflow consumer.

Target shape:

```text
Stable Core Data
  - person
  - enrolment
  - module registration
  - assessment
  - regulatory exchange

Configurable Platform Controls
  - workflow definitions
  - workflow instances and tasks
  - decision gateway audit
  - feature flags
  - trigger rules
  - role/responsibility assignment rules
  - environment-scoped deployment configuration

Domain Services
  - enforce data invariants
  - execute commands
  - publish events
  - do not own institution-specific process shape
```

---

## Current Alignment

Already aligned:

- Bitemporal storage patterns exist for core records and rules.
- `academic_rule` supports versioned institutional business rules.
- `value_set` and `field_value_set` provide configurable validation for many code fields.
- `integration_contract`, `integration_registration`, and `integration_exchange` provide a strong integration substrate.
- `audit_record.workflow_instance_id` exists and can connect workflow activity to audit.
- `packages/workflow` provides a Temporal worker scaffold.
- Tenant configuration exists and can be read/merged through tenant admin APIs.

Not yet aligned:

- Domain workflows are mostly not represented as reusable workflow instances/tasks.
- Temporal has a minimal audit workflow scaffold, but no domain workflow implementations.
- Role responsibilities are mostly static in `PERMISSION_ROLES`.
- Status transitions are hard-coded in services such as enrolment, module registration, correction cases, UCAS ingest, and exam board ratification.
- Downstream trigger creation is hard-coded inside enrolment creation and status transition logic.
- Database migrations still contain fixed `CHECK (...) IN (...)` constraints for several codes that are also represented through value sets.
- No first-class feature flag model exists yet.
- No environment-scoped configuration model exists beyond tenant configuration and runtime environment variables.

---

## Design Principles

1. **Do not replace stable data with workflow state.**
   Workflow controls process. Core data remains authoritative.

2. **Keep domain invariants in domain services.**
   A workflow may decide when to call `createEnrolment`; `EnrolmentService` still enforces what a valid enrolment is.

3. **Make process decisions inspectable.**
   Decision points, route labels, conditions, owners, policy sources, flags, actors, and evidence references must be recorded.

4. **Use feature flags for variation, not data integrity.**
   Flags can enable workflow steps, communication paths, adapters, and rollout paths. They must not bypass statutory, audit, privacy, or bitemporal requirements.

5. **Prefer value-set-driven codes over migration-bound code lists.**
   Database constraints should enforce shape and referential integrity; tenant-extensible business values should be governed by value sets and service validation.

6. **Keep Temporal behind a platform workflow API.**
   Domain services should not know Temporal details unless they are workflow activities.

7. **Promote artefacts, not rebuilds.**
   Environment differences belong in configuration, secrets, flags, tenant data, and integration endpoints.

---

## Target Platform Capabilities

### Workflow Foundation

Add a lightweight relational workflow model:

- `workflow_definition`
- `workflow_definition_version`
- `workflow_step`
- `workflow_transition`
- `workflow_decision_gateway`
- `workflow_assignment_rule`
- `workflow_trigger_rule`
- `workflow_instance`
- `workflow_task`
- `workflow_decision_audit`

The relational model is the SRS audit/configuration surface. Temporal remains the durable execution engine for long-running orchestration.

### Feature Flag Foundation

Add a first-class flag model:

- `feature_flag`
- `feature_flag_variant`
- `feature_flag_assignment`
- `feature_flag_evaluation_log`

Flags should support scope by:

- platform
- environment
- tenant
- role
- cohort
- programme
- academic year
- source system
- workflow definition/version

Flags must be auditable and bitemporal or append-only-versioned.

### Environment Foundation

Add explicit environment metadata:

- `deployment_environment`
- `environment_configuration`
- `environment_promotion_record`

These do not replace runtime environment variables or secret stores. They provide application-visible metadata for environment identity, flag scoping, integration safety, release promotion, and audit.

### Configurable Responsibility and Triggers

Move static responsibility and trigger rules into configuration over time:

- task assignment rules
- approval responsibilities
- communication endpoint selection
- downstream trigger rules
- integration endpoint safety class
- statutory/test endpoint guardrails

The existing `PERMISSION_ROLES` can remain as bootstrap RBAC, but tenant-specific workflow responsibilities should be data-driven.

---

## Staged Plan

### Stage 0 — Baseline and Safety Net

Status: Complete. See `docs/platform-workflow-feature-flag-stage-0-baseline.md` and `docs/decisions/ADR-015-workflow-feature-flags-and-environment-promotion.md`.

Goal: freeze current behaviour before changing orchestration.

Tasks:

- Document all hard-coded process points:
  - enrolment status transitions
  - module registration transitions
  - correction case transitions
  - UCAS confirmed-to-enrolment path
  - enrolment downstream trigger creation
  - exam board external examiner prerequisite
  - progression decision algorithm shape
- Add regression tests where current behaviour is not already locked.
- Add ADR: "Workflow, feature flags, and environment promotion as platform controls".
- Update architecture docs to explain that data services enforce invariants while workflow controls process ordering.

Exit criteria:

- Current behaviour is described and covered by tests.
- No production behaviour changes yet.

### Stage 1 — Platform Schema

Status: Complete. Implemented in `packages/db/migrations/0009_platform_workflow_feature_flags.sql` and `packages/db/src/schema/platform-workflow.ts`.

Goal: add workflow, flag, and environment substrate without changing domain behaviour.

Tasks:

- Add workflow foundation tables with RLS, audit fields, and seed value sets.
- Add feature flag tables with environment/tenant scoping and evaluation metadata.
- Add environment metadata tables.
- Add field value set mappings for new workflow/flag/environment status fields.
- Add migration tests for RLS, uniqueness, temporal/versioning, and seed data.

Exit criteria:

- Schema compiles and migrates from clean database.
- Existing tests pass.
- No domain service uses the new tables yet.

### Stage 2 — Platform Services and Admin APIs

Status: Complete. Implemented platform control services and admin APIs for workflow reads, feature flag configuration/evaluation, and environment metadata/promotion records.

Goal: expose the substrate through stable services and APIs.

Tasks:

- Add `WorkflowDefinitionService`.
- Add `WorkflowInstanceService`.
- Add `WorkflowTaskService`.
- Add `FeatureFlagService`.
- Add `EnvironmentService`.
- Add admin APIs for:
  - workflow definition/version read
  - feature flag create/update/retire
  - feature flag assignment
  - flag evaluation preview
  - environment metadata read
  - promotion record read/create
- Add audit records for every configuration change.

Exit criteria:

- Tenant administrators can configure and inspect flags.
- Workflow definitions can be seeded/read.
- Feature flag evaluation is deterministic and tested.

### Stage 3 — Temporal Bridge

Status: Complete. Implemented generic Temporal workflow contracts, injectable workflow/audit activities, API-side bridge activities, minimal workflow start/completion APIs, and `srs.workflow.*` event publication.

Goal: connect the relational workflow model to durable execution.

Tasks:

- Replace the no-op workflow audit activity with a real audit write path.
- Add generic workflow start/signal/query helpers.
- Add generic human task assignment and completion activities.
- Add deadline/escalation support through workflow definition metadata.
- Publish `srs.workflow.*` events for task assignment, completion, escalation, decision recorded, and workflow completed.

Exit criteria:

- A minimal test workflow can be started, assigned, signalled, audited, and completed.
- Workflow audit records include `workflow_instance_id`.

### Stage 4 — Extract Common Transition Logic

Status: Complete. Added shared transition validation/audit helpers and refactored enrolment and correction-case transitions to use them while preserving the default transition matrices.

Goal: stop each service inventing its own state-machine pattern.

Tasks:

- Add a reusable transition validator backed by workflow/value-set configuration.
- Add common append-only transition/audit helpers.
- Refactor enrolment status transition validation to use configurable transition definitions while preserving current allowed transitions.
- Refactor correction case transitions similarly.
- Keep hard domain invariants in the services.

Exit criteria:

- Existing enrolment and correction-case tests pass unchanged.
- Transition rules can be changed in configuration for a test tenant without code changes.

### Stage 5 — Configurable Trigger Rules

Status: Complete. Added the enrolment trigger-rule evaluator, seeded default UCAS/SLC/UKVI/future communication trigger rules plus the default-off trigger-mode flag, and refactored enrolment creation/status trigger creation to record trigger-rule evidence while preserving legacy default behaviour.

Goal: move downstream side effects out of hard-coded service branches.

Tasks:

- Add trigger rules for:
  - UCAS confirmation
  - SLC confirmation
  - UKVI CAS
  - future communication endpoints
- Refactor `EnrolmentService.createEnrolment` and status transitions to ask a trigger-rule evaluator which downstream triggers are required.
- Record trigger-rule evaluation evidence.
- Add feature flags to enable legacy trigger mode versus configured trigger mode.

Exit criteria:

- Existing UCAS/SLC/UKVI trigger behaviour is preserved under default configuration.
- A tenant can disable or redirect a non-statutory trigger in test configuration.

### Stage 6 — Role Responsibility Configuration

Status: Complete. Added tenant-scoped workflow assignment rules, assignment-rule APIs, rule-based workflow task ownership resolution, and dynamic task-completion guards that preserve baseline RBAC while allowing registry-led and school-led tenant variants.

Goal: support different institutional working practices.

Tasks:

- Add workflow assignment rules by tenant, role, organisational unit, programme, source system, and workflow step.
- Keep `PERMISSION_ROLES` as baseline capability permissions.
- Use assignment rules for workflow task ownership.
- Add admin API/UI requirements for responsibility assignment.
- Add tests for two tenant variants:
  - Registry-led decision route
  - School/admissions-led decision route

Admin API/UI requirements:

- Administrators can list and create workflow assignment rules scoped by workflow version, step, initiating role, organisational unit, programme, and source system.
- Task assignment screens should display the resolved assignment reason, rule key, and assignee role/expression from the task payload.
- Completion actions should remain hidden or disabled unless the actor has the assigned role or actor-specific assignment; server-side RBAC remains authoritative.

Exit criteria:

- Workflow task assignment is tenant-configurable.
- RBAC still prevents unauthorised completion even when task assignment changes.

### Stage 7 — Admissions as First Full Consumer

Status: Complete. Seeded source-neutral Admissions workflow definitions for UCAS domestic, direct domestic, international direct, international agent, and clearing routes; mapped BPMN gateway IDs into generic workflow decision gateways; seeded Admissions feature flags; and placed legacy UCAS auto-enrolment behind an explicit migration flag while preserving the default behaviour.

Goal: implement Admissions on the new platform controls.

Tasks:

- Update `docs/admissions-module-refactor-plan.md` to depend on this platform alignment plan.
- Add Admissions workflow definitions for:
  - UCAS domestic route
  - direct domestic route
  - international direct route
  - international agent route
  - clearing route
- Seed BPMN gateway IDs into workflow decision gateway definitions:
  - `G01`, `G02`, `G03`, `G04`, `G05`, `G09`, `G10`, `G11`
- Add `admissions_workflow_decision` or use generic `workflow_decision_audit` with Admissions entity references.
- Add Admissions feature flags:
  - `admissions.enabled`
  - `admissions.ucas-adapter.enabled`
  - `admissions.direct-applications.enabled`
  - `admissions.agent-applications.enabled`
  - `admissions.international-route.enabled`
  - `admissions.cas-precheck.required`
  - `admissions.legacy-ucas-auto-enrolment.enabled`
- Refactor UCAS confirmed auto-enrolment behind an explicit handoff workflow step.

Exit criteria:

- UCAS and direct/manual applications flow through the same Admissions workflow model.
- International route can record CAS/compliance decisions before handoff.
- Legacy UCAS behaviour remains available behind a migration flag until retired.

### Stage 8 — Remove Legacy Hard-Coding

Status: Complete. Removed direct UCAS-to-enrolment creation from `UcasService`, routed confirmed UCAS applications to the Admissions workflow handoff, made configured enrolment trigger rules the default, added a migration to relax tenant-extensible business-code `CHECK` constraints, and documented retained hard invariants in `docs/platform-workflow-feature-flag-stage-8-invariants.md`.

Goal: retire old process branches once workflow-backed paths are proven.

Tasks:

- Remove direct UCAS-to-enrolment orchestration from `UcasService`.
- Remove hard-coded downstream trigger branching where trigger rules now cover behaviour.
- Replace migration-bound status/code `CHECK` constraints with value-set validation where tenant extensibility is required.
- Document remaining hard-coded invariants that are intentionally non-configurable.
- Add guard tests proving disabled features cannot bypass statutory or audit obligations.

Exit criteria:

- Services own data invariants.
- Workflow/flags own process variation.
- No duplicate process truth exists for Admissions and enrolment handoff.

### Stage 9 — Environment Promotion Hardening

Status: Complete. Added startup deployment metadata, `/api/v1/environment-runtime` reporting for environment/release/migration/workflow/flag state, integration endpoint safety classes, promotion metadata enrichment, and outbound live-endpoint guardrails for non-production environments.

Goal: make test/UAT/pre-production/production behaviour explicit and safe.

Tasks:

- Seed environment records for local, test, UAT, pre-production, and production.
- Add deployment metadata capture at startup.
- Add integration endpoint safety classes:
  - simulator
  - external-test
  - external-production
- Prevent non-production environments from sending live statutory, finance, admissions, identity, or student communications traffic unless explicitly approved.
- Add promotion records linking image digest, migration version, workflow definition versions, feature flag set, and approval metadata.

Exit criteria:

- The API can report its environment identity, release version, migration state, and active flag set.
- Pre-production can rehearse migrations and workflow definitions without using production integrations accidentally.

---

## Data Architecture Changes

New schema areas:

- `workflow_*`
- `feature_flag_*`
- `deployment_environment`
- `environment_configuration`
- `environment_promotion_record`

Existing schema to revisit:

- Replace rigid status `CHECK` constraints with value-set-backed validation where institutional variation is expected.
- Keep database constraints for non-negotiable invariants, such as required foreign keys, temporal validity, tenant ownership, uniqueness, and statutory integrity.
- Keep domain event payloads source-neutral wherever possible.
- Add `workflow_instance_id`, `workflow_definition_version_id`, and `feature_flag_snapshot` references to process-heavy records where reconstruction matters.

---

## Code Architecture Changes

Add platform services:

- `apps/api/src/platform/workflow/definition-service.ts`
- `apps/api/src/platform/workflow/instance-service.ts`
- `apps/api/src/platform/workflow/task-service.ts`
- `apps/api/src/platform/workflow/transition-service.ts`
- `apps/api/src/platform/feature-flags/service.ts`
- `apps/api/src/platform/environment/service.ts`

Refactor existing services gradually:

- `EnrolmentService`
  - keep enrolment creation and status persistence
  - move process route decisions to workflow/trigger evaluators

- `UcasService`
  - become adapter/exchange evidence owner
  - stop owning Admissions process state

- `BoardService`
  - keep ratification data writes and locking
  - make external examiner prerequisite a workflow-configured required step, while retaining a protective service guard until migration completes

- `CorrectionService`
  - move transition matrix to workflow configuration
  - keep locked-record amendment invariants

- `ProgressionService`
  - keep calculation engine
  - externalise algorithm selection and decision review workflow

---

## Testing Strategy

Add test layers:

- Migration tests for workflow, flag, and environment schema.
- Unit tests for feature flag evaluation precedence.
- Unit tests for transition rule evaluation.
- Integration tests for workflow instance/task lifecycle.
- Temporal tests for start/signal/deadline/audit behaviour.
- Regression tests proving existing hard-coded behaviours are preserved under default configuration.
- Tenant-variant tests proving workflow/process differences can be configured without code changes.
- Environment safety tests proving non-production cannot emit live external traffic accidentally.

Required tenant variants:

- Baseline tenant using default workflows and flags.
- Registry-led tenant.
- School-led admissions/approval tenant.
- International recruitment-heavy tenant.
- Migration tenant with legacy UCAS auto-enrolment flag enabled.

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Overbuilding a generic workflow engine | Keep workflow model lightweight; use it for configuration/audit while Temporal handles durable execution |
| Breaking existing Phase 4-6 behaviour | Stage 0 regression coverage; default configuration must reproduce current behaviour |
| Confusing feature flags with permissions | Keep RBAC as capability control; flags control availability and process variants |
| Flags bypass statutory obligations | Add non-bypassable guard rules and tests for statutory/audit/privacy controls |
| Process definitions drift from BPMN/reference model | Store BPMN gateway IDs and source metadata in workflow definitions |
| Long-running workflows break on definition changes | Version workflow definitions and snapshot version/flags on workflow instance start |
| Too much roadmap churn | Introduce this as a platform alignment phase before Admissions, then use Admissions to prove the pattern |

---

## Recommended Roadmap Placement

Add as **Phase 6.4 — Platform Workflow and Feature Flag Alignment**, before Phase 6.5 Admissions Module Refactor.

Rationale:

- Phase 6 introduced UCAS and regulatory exchanges, exposing process hard-coding.
- The Admissions refactor will require workflow, source variation, feature flags, and environment-safe integrations.
- Implementing the platform alignment first prevents Admissions from becoming another process-specific hard-code layer.

Minimum viable version before Admissions:

- Stage 0
- Stage 1
- Stage 2
- Stage 3
- Stage 5 trigger rules for enrolment handoff
- enough of Stage 6 for Admissions task assignment

Stages 4, 8, and 9 can continue in parallel or immediately after Admissions if needed, but Admissions should not start until the workflow/flag foundations exist.
