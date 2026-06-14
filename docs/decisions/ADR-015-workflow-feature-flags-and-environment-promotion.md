# ADR-015: Workflow, Feature Flags, and Environment Promotion as Platform Controls

**Status**: Accepted
**Date**: 2026-06-13

## Context

The SRS has stable core records, bitemporal storage, tenant isolation, audit records, value sets, academic rules, integration ledgers, and a Temporal workflow package. However, several institutional processes are still encoded directly in service methods or database check constraints. Examples include enrolment transitions, module registration closure, correction case states, UCAS confirmed-to-enrolment handling, downstream regulatory triggers, exam board ratification prerequisites, and progression decision orchestration.

Universities need consistent core data with variable working practices. Process differences may include role responsibilities, gateway decisions, communication endpoints, source-specific admissions routes, escalation timing, integration triggers, and environment-specific safety controls. The platform also needs explicit support for test, UAT, pre-production, production, and any additional institutional environments without rebuilding application artefacts for each one.

## Decision

Workflow orchestration, feature flags, and environment promotion are first-class platform controls.

The SRS will introduce a lightweight workflow model, feature flag model, and deployment-environment model. These controls will sit above the stable domain services:

- Domain services enforce data invariants, bitemporal writes, validation, locking, audit publication, and tenant isolation.
- Workflow definitions control process ordering, task assignment, gateway decisions, deadlines, escalation, and source-specific routes.
- Feature flags control process variation, staged rollout, optional modules, adapter activation, and new workflow paths.
- Environment metadata controls promotion, flag scoping, integration safety, endpoint classification, and operational audit across test, UAT, pre-production, and production.
- Temporal remains the durable execution engine, but SRS-owned relational workflow records provide the inspectable configuration, task, decision, and audit surface.

Stage 0 freezes existing behaviour before any orchestration extraction. Subsequent stages must preserve current behaviour as the default workflow and flag configuration unless a later implementation stage explicitly changes the product behaviour.

## Rationale

- Stable core data should not be replaced by workflow state. Workflow instances can be paused, retried, or superseded; core records remain authoritative.
- Service-level invariants protect statutory and audit-critical behaviour even when workflow definitions or flags vary by tenant or environment.
- Universities can adopt the SRS without accepting a single hard-coded operating model.
- Feature flags provide a controlled way to introduce new admissions routes, communications, integrations, and workflow variants.
- Environment-scoped configuration allows the same release artefact to move through test, UAT, pre-production, and production while keeping data, endpoints, secrets, and flags isolated.

## Consequences

- New workflow, feature flag, and environment platform schemas and services are required before domain process extraction.
- Existing hard-coded process points must be documented and covered by regression tests before they are migrated.
- Default seeded workflow and flag configuration must reproduce current behaviour.
- Admin screens must expose flag and workflow configuration in a way that is auditable and safe for tenant administrators.
- Domain services may still reject a workflow-requested command when the requested transition violates core invariants.
- Database constraints should focus on shape, referential integrity, tenant isolation, and non-tenant-variable invariants; tenant-variable business codes should move toward value sets and service validation.

## Alternatives Considered

| Alternative | Reason rejected |
|---|---|
| Keep process logic entirely in services | Simple in the short term, but hard-codes institutional practice and makes admissions/source variation expensive. |
| Put all domain state in the workflow engine | Undermines the bitemporal core record model and makes regulatory reporting dependent on operational workflow history. |
| Use feature flags only, without workflow definitions | Flags can enable paths but do not provide task ownership, gateway audit, deadlines, or process history. |
| Use environment variables only for environment control | Useful for runtime configuration and secrets, but not sufficient for auditable in-product flag scoping, integration safety, and release promotion records. |
