# Platform Alignment Stage 8 Invariants

> Date: 2026-06-14
> Status: Complete
> Related plan: `docs/platform-workflow-feature-flag-alignment-plan.md`

## Purpose

Stage 8 retires duplicated process truth where workflow definitions, feature flags, trigger rules, and value sets now own variation.

This document records the controls that deliberately remain hard-coded because they are data integrity, audit, privacy, or statutory invariants rather than institutional workflow preferences.

## Retired Process Branches

- UCAS confirmed applications no longer create `person` and `enrolment` records directly in `UcasService`.
- Confirmed UCAS applications start the `admissions-ucas-domestic` workflow handoff when `admissions.enabled` and `admissions.ucas-adapter.enabled` are enabled.
- Enrolment downstream trigger creation is governed by workflow trigger rules by default through `enrolment.downstream-triggers.configured-mode`.
- The legacy UCAS auto-enrolment flag remains seeded as retired/off for migration audit, not as an active runtime branch.

## Value-Set Governed Codes

Migration `0010_relax_extensible_code_checks.sql` drops database `CHECK (...) IN (...)` constraints for business code fields that are already governed through `field_value_set` mappings and service validation.

Examples include:

- enrolment status, mode of study, funding source, and downstream trigger status/type codes
- module registration status codes
- module result, progression, board, adjustment distribution, misconduct penalty, and post-ratification case codes
- selected person, address, disability, identity verification, period, and relationship codes

These values are intentionally configurable through value sets rather than fixed in migration DDL.

## Hard Invariants Retained

The database and services still enforce non-negotiable invariants:

- tenant ownership and RLS isolation
- required foreign keys
- bitemporal validity and record-time ordering
- uniqueness of current/logical records
- mutually exclusive structural references, such as exactly one programme or module target where required
- date ordering and numeric range checks
- statutory exchange ledgers and audit records
- service-level validation before data-changing commands

Workflow and flags may decide when a process step runs. They must not bypass these invariants.
