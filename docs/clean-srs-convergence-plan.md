# Clean SRS Convergence Plan

> Date: 2026-06-14
> Status: Proposed
> Purpose: Move the implemented SRS from a compatibility-preserving refactor state to a clean workflow-native, flag-aware, multilingual, and multicurrency architecture before published integration contracts and broad UI work lock in legacy assumptions.

---

## Summary

The platform workflow and feature flag alignment work introduced the right foundations, but it deliberately retained legacy behaviour while the system was being refactored. That was the right migration posture. It is not the desired end state.

The clean SRS target is:

- one authoritative implementation path per domain capability;
- workflow definitions for institutional process variation;
- feature flags for optional capabilities, rollout, and valid architectural variants;
- configuration-driven rules for academic and operational policy;
- global-ready data structures for language, locale, time zone, and currency;
- public integration compatibility where required, but no indefinite internal legacy paths.

This plan should run after the workflow/flag substrate is in place and before the SRS publishes stable external contracts or builds substantial UI surfaces over legacy assumptions.

---

## Target Architecture

```text
Stable Core Data
  - person, enrolment, module registration
  - assessment, mark, module result
  - progression, award, record lock
  - admissions, regulatory exchange, finance facts

Workflow-Native Process Layer
  - workflow definitions and versions
  - workflow instances, tasks, transitions
  - decision gateways and evidence
  - task assignment and escalation rules

Flag and Configuration Layer
  - feature flags and variants
  - tenant/environment/programme/cohort scoping
  - architectural route selection
  - rule sets and value sets

Domain Services
  - commands
  - invariants
  - bitemporal persistence
  - audit and event publication
  - no institution-specific private process flow
```

Domain services still matter. They remain the place where invalid data is rejected and statutory, privacy, audit, record-locking, and bitemporal invariants are enforced. They should not own process sequencing, role routing, optional steps, communication triggers, or institution-specific decision routes.

---

## Design Principles

1. **Remove legacy once the clean path is proven.**
   Migration flags and compatibility services are temporary. Each must have an owner, telemetry, retirement condition, and removal stage.

2. **Workflow is the uniform process model.**
   Admissions, enrolment, module registration, assessment moderation, grade calculation review, exam boards, corrections, appeals, regulatory returns, finance handoffs, and student communications should all expose their process variation through workflow configuration.

3. **Flags choose valid variants, not integrity.**
   Flags may choose between registry-led and school-led operation, small-institution and large-institution processes, direct versus staged integration, or legacy versus clean migration routes. They must not bypass statutory duties, audit, privacy, security, bitemporal history, or record-lock controls.

4. **Rules calculate; workflows decide when and who; services enforce.**
   Academic rules calculate marks, progression, classification, and eligibility. Workflows determine review, approval, notification, escalation, and handoff. Services enforce that persisted outcomes are valid.

5. **Internationalisation and multicurrency are core data concerns.**
   Locale, language, time zone, currency, precision, conversion source, and effective dating must be designed into data and APIs rather than patched into UI strings or finance screens later.

6. **Published contracts are protected; internal duplication is not.**
   External API/event/file contracts follow deprecation policy. Internal duplicate process paths should be removed once no tenant or migration relies on them.

---

## Clean-Up Targets

| Area | Current risk | Clean target |
|---|---|---|
| UCAS and Admissions | Adapter behaviour and Admissions workflow can coexist during migration | UCAS is only an adapter into source-neutral Admissions |
| Enrolment | Trigger and transition behaviour may retain compatibility paths | Enrolment service enforces data; workflow/trigger rules own process and handoffs |
| Module registration | Registration transitions can remain service-private | Registration windows, approvals, prerequisite exception handling, and notifications are workflow/rule driven |
| Assessment mark handling | Grade ingestion and moderation can be procedural | Mark ingestion persists facts; moderation, late penalties, review, and approval are workflow/rule driven |
| Grade calculation | Algorithms may be embedded in services | Calculation engines are rule selected; review/override/ratification is workflow governed |
| Progression and award | Decision shape can be hard-coded around one institutional model | Academic rules select calculation; workflow handles board review, discretionary uplift, appeal, and notification |
| Exam boards | External examiner and ratification steps can remain hard-coded guards | Board constitution, quorum, signoff, deferral, escalation, and record lock are workflow configured; service guards keep hard invariants |
| Corrections and appeals | Status matrices can remain service-private | Correction/appeal workflows own statuses and tasks; services enforce lock override authority |
| Regulatory exchanges | Environment safety and exchange flows can be adapter-specific | Exchange contracts use common safety classes, workflow state, flag-gated submission, and audit |
| Finance and fees | GBP and UK-only assumptions can leak into fee liability | Monetary records are currency-aware; rules select fee/deposit/refund paths; conversion is auditable |
| Communications | Process emails/messages can be hidden in domain methods | Communication endpoints and templates are workflow/flag configured, locale-aware, and audited |

---

## Staged Plan

### Stage 0 — Legacy and Variant Inventory

Status: Complete. See `docs/clean-srs-stage-0-legacy-variant-register.md`.

Goal: identify every remaining legacy path, hard-coded process route, and architectural variant before removing anything.

Tasks:

- Extend the Stage 0 baseline into a clean-up register covering Admissions, enrolment, module registration, assessment, progression, exam boards, corrections, regulatory, finance, and communications.
- For each legacy path, record:
  - owning module/service;
  - current flag or configuration guard;
  - tenant or test dependency;
  - replacement workflow/rule/flag path;
  - telemetry required to prove non-use;
  - removal migration.
- Identify architectural variants that should remain as supported flags, such as small-institution direct approval versus large-institution staged school/registry approval.
- Add tests that prove clean-path parity before any removal.

Exit criteria:

- Every retained legacy path has a named retirement condition.
- Every intended long-term variant is explicitly modelled as a flag, workflow variant, rule set, or tenant configuration.

### Stage 1 — Globalisation Foundation

Goal: make language, locale, time zone, and currency first-class platform concerns.

Tasks:

- Add tenant locale configuration: default locale, supported locales, fallback locale, default time zone.
- Add person/applicant communication locale preferences.
- Add localisation tables or resource-pack metadata for labels, messages, templates, and value-set display names.
- Add currency metadata, monetary amount patterns, currency precision, and effective-dated exchange-rate source records.
- Review fee liability, deposits, refunds, scholarships, agent commission, CAS/international admissions, and finance integration data for GBP-only assumptions.
- Add API standards for locale negotiation, translated labels, currency representation, and UTC/local civil-time handling.

Exit criteria:

- APIs can represent multilingual labels and monetary amounts without changing domain identifiers.
- Finance and admissions data can store non-GBP monetary facts with auditable context.

### Stage 2 — Workflow Coverage Matrix

Goal: prove that every process-bearing domain has a workflow definition or a documented reason it does not need one.

Tasks:

- Create a domain-to-workflow coverage matrix for Admissions, enrolment, module registration, assessment, grade calculation, progression, awards, exam boards, corrections, appeals, regulatory returns, finance handoffs, identity provisioning, and communications.
- For each workflow, identify:
  - start event or command;
  - required tasks;
  - decision gateways;
  - role assignment rules;
  - escalation/deadline policy;
  - communication endpoints;
  - terminal data writes;
  - invariants retained in services.
- Seed missing workflow definitions and default variants.
- Add workflow versioning and flag snapshot expectations to each long-running process.

Exit criteria:

- No long-running or multi-actor process remains only as service-local procedural code.

### Stage 3 — Assessment, Grade, and Progression Refactor

Goal: separate calculation, workflow review, and persistence for assessment-heavy processes.

Tasks:

- Refactor mark ingestion so it records facts and emits events, while moderation/review is workflow managed.
- Move late penalty, reassessment cap, compensation, condonement, progression, and classification selection into rule/flag configuration.
- Route grade calculation review, override, and ratification through workflow tasks and decision audits.
- Add tenant variants for small-institution simplified board review and large-institution staged departmental/school/registry approval.
- Preserve hard service guards for locked records, valid marks, valid credits, and ratified outcomes.

Exit criteria:

- Grade and progression calculations are reproducible from rules, workflow decision evidence, and source marks.

### Stage 4 — Exam Board and Record Governance Refactor

Goal: make board governance workflow-native while preserving non-bypassable record locks.

Tasks:

- Model board preparation, external examiner review, quorum, chair ratification, deferral, escalation, and record lock as workflow definitions.
- Replace hard-coded prerequisite checks with workflow-required tasks where possible.
- Keep service-level record-lock and correction-authority guards as hard invariants.
- Add flags for board operating models, such as central registry boards, school-led boards, virtual boards, and external-examiner signoff timing.

Exit criteria:

- Board variation is workflow/flag configured; ratification and lock integrity remain service enforced.

### Stage 5 — Admissions and Communications Clean Cut

Goal: finish the move from UCAS-first compatibility to source-neutral Admissions and locale-aware communication.

Tasks:

- Remove legacy UCAS-to-enrolment auto-creation once Admissions handoff is the only active path.
- Ensure UCAS, direct, agent, international, clearing, and CRM-ready routes enter Admissions through the same command surface.
- Make communication template selection locale-aware and workflow/flag controlled.
- Add flags for communication channel strategy by tenant and process: manual, email, integration event, CRM handoff, or statutory file.

Exit criteria:

- UCAS is an adapter, not a process owner.
- Student/applicant communications are workflow-triggered, auditable, and locale-aware.

### Stage 6 — Flag Governance and Admin UX

Goal: make flags safe enough to run as long-term architectural controls.

Tasks:

- Classify flags as migration, release, tenant variant, environment safety, module enablement, integration route, or operational kill switch.
- Add required metadata: owner, reason, risk class, default, expiry/review date, allowed scopes, and retirement condition.
- Add admin screens for tenant-safe flags and read-only views for platform or environment safety flags.
- Add impact preview showing affected workflows, integrations, tenants, cohorts, and communications.
- Add tests proving mandatory controls cannot be disabled by flags.

Exit criteria:

- Flags are governed configuration, not hidden conditionals.

### Stage 7 — Legacy Removal and Schema Simplification

Goal: remove compatibility code and schema artefacts that are no longer needed.

Tasks:

- Remove retired migration flags and code branches.
- Collapse duplicated service paths into workflow-native command handlers.
- Remove obsolete database constraints, fields, views, or compatibility tables only after migration scripts preserve history and references.
- Update OpenAPI, event schemas, docs, and tests to describe the clean path only.
- Add regression tests proving removed paths cannot be accidentally reactivated.

Exit criteria:

- The codebase has one internal implementation path per capability.
- Legacy behaviour survives only where exposed through an intentionally versioned public contract.

### Stage 8 — Clean Architecture Acceptance Review

Goal: confirm the clean SRS is ready for published integrations and broad UI implementation.

Tasks:

- Run a cross-domain architecture review against the principles.
- Verify workflow coverage, flag governance, globalisation, audit, bitemporality, environment safety, and tenant isolation.
- Run migration tests from a pre-clean database to the clean schema.
- Produce a deprecation/removal report for any remaining compatibility code.
- Update the roadmap and principle coverage map.

Exit criteria:

- No known legacy process path remains without an approved removal exception.
- Published API/event/file contracts can be built on the clean architecture.

---

## Testing Strategy

Required coverage:

- clean-path parity tests for each removed legacy route;
- workflow coverage tests for every process-bearing domain;
- feature flag precedence and safety tests;
- tenant variant tests for small, medium, and large institution operating models;
- multilingual API/notification tests for locale fallback and translated value labels;
- multicurrency tests for amount precision, non-GBP storage, conversion source/effective date, and finance handoff payloads;
- migration tests from compatibility schema to clean schema;
- non-production integration safety tests.

---

## Roadmap Placement

Recommended placement: **Phase 6.6 — Clean SRS Convergence**, after Phase 6.5 Admissions Module Refactor and before Phase 7 Published Interfaces.

Rationale:

- The workflow/flag substrate exists after Phase 6.4.
- Admissions proves the first major source-neutral workflow consumer in Phase 6.5.
- Published external contracts in Phase 7 should expose the clean architecture, not temporary migration internals.
- UI work in Phase 10 should consume stable workflow/flag/globalisation APIs from the start.
