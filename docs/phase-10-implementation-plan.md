# Phase 10 Implementation Plan - User Interfaces

> Date: 2026-06-16
> Status: **Complete** — Stages 0–8 complete
> Prerequisite: Phases 4-9 complete
> Roadmap: `docs/project-roadmap.md` Phase 10

---

## Overview

Phase 10 builds the user-facing surfaces for Revelation SRS: the student self-service portal, the full staff administrative interface, tenant/system administration screens, and reporting/BI user workflows.

The UI work consumes the stable REST APIs, event-derived state, workflow commands, feature flags, integration registry, and first-party/external integration patterns established in Phases 4-9. It must meet WCAG 2.1 AA throughout and follow ADR-007: React 18, TypeScript, Vite, Radix UI primitives, and Tailwind CSS.

---

## Target Outcomes

By the end of Phase 10:

- `apps/portal` exists as the student self-service portal;
- `apps/admin` is expanded from the Phase 4 student/enrolment slice into the full staff and tenant administration interface;
- both frontends use generated OpenAPI types, shared authentication, shared design tokens, and accessible component primitives;
- student golden paths are complete for identity, contact details, module selection, registrations, results, progression, timetable, exams, notifications, adjustments, and EC visibility;
- staff golden paths are complete for student search, enrolment, registration, assessment, exam boards, regulatory returns, workflow tasks, and corrections;
- tenant administrators can manage tenants, value sets, rules, feature flags, workflow definitions, integration registrations, users, roles, audit records, and connector health;
- reporting and BI workflows support extracts and operational reports;
- automated accessibility scans run in CI, and golden-path Playwright tests cover all major user journeys.

---

## Stage Dependency Graph

```text
Stage 0   UI scope, contracts, and journey baseline
    |
Stage 1   Shared frontend platform
    |
Stage 2   Authentication, authorisation, and tenant context
    |                                  |
Track A — student               Track B — staff/admin
Stage 3   Student portal         Stage 5a  Staff: student record management
Stage 4   Student self-service   Stage 5b  Staff: assessment and exam boards
    |                            Stage 5c  Staff: regulatory returns
    |                                  |
Stage 6   Tenant and system administration
    |
Stage 7   Reporting, BI, integration health, and operations
    |
Stage 8   Accessibility, E2E, performance, and acceptance review
```

Tracks A and B run in parallel after Stage 2. Track A (Stages 3–4) covers the student portal. Track B (Stages 5a–5c) covers the staff interface; each stage within Track B is sequential because later stages build on prior admin patterns. Stage 6 depends on Track B reaching at least Stage 5a (admin shell and navigation). Stage 8 runs continuously from Stage 1 but is completed only after all user journeys exist.

---

## Stage 0 - UI Scope, Contracts, and Journey Baseline

**Status**: Complete

**Goal**: define the full Phase 10 UI surface and map each journey to implemented contracts.

### Scope

- Audit the current state of `apps/portal` and `apps/admin` from Phase 4: inventory existing components, routes, auth wiring, and tests; produce carry-forward decisions for what each stage should extend vs. replace.
- Inventory all Phase 10 UI journeys and classify them as student, staff, tenant admin, system admin, auditor, or reporting.
- Map each journey to current REST/OpenAPI operations, workflow commands, event-derived state, and permissions.
- Confirm gaps against:
  - `apps/api/openapi/v1.json`;
  - `docs/integrations/contract-index.md`;
  - `docs/architecture/api-resource-catalogue.md`;
  - `docs/architecture/workflow-traceability-matrix.md`;
  - Phase 8 and Phase 9 residual gap registers.
- Decide the app split:
  - `apps/portal` for student self-service;
  - `apps/admin` for staff, tenant admin, system admin, workflow, reporting, and operations.
- Decide form management library (e.g. React Hook Form or TanStack Form) for multi-field and multi-step forms.
- Decide i18n strategy: whether frontend labels are rendered from the value-set API, a static i18n library, or deferred to Phase 11; choose locale-aware date, number, and currency formatting primitives.
- Define frontend performance budget targets: initial bundle size limit, time-to-interactive for key pages, API response display thresholds. These targets will be enforced by CI from Stage 1.
- Assign Phase 9 residual gap R1 (reconciliation scheduler wiring): either file as a Phase 9b backend task or assign to a named Phase 10 stage. Note: until the scheduler backend exists, the Stage 7 reconciliation status UI will only display data for manually triggered runs.
- Define route maps, navigation IA, role-to-route matrix, and data classification display rules.
- Define accessibility acceptance criteria for each page template and workflow.
- Decide which Phase 9 residual operational gaps are handled in Phase 10 UI:
  - VLE connector health route exposure;
  - reconciliation scheduling/trigger controls;
  - integration health dashboard;
  - circuit-breaker/status visibility.

### Deliverables

- `docs/phase-10-stage-0-ui-scope-and-journey-baseline.md`
- Current-state inventory of `apps/portal` and `apps/admin` with carry-forward decisions.
- Form library and i18n strategy decision record.
- Frontend performance budget targets.
- R1 scheduler assignment record.
- Route map for `apps/portal` and `apps/admin`.
- Role/permission-to-screen matrix.
- API/UI gap register.
- Accessibility checklist for page templates and core workflows.

### Exit Criteria

- Current state of both existing apps is inventoried and carry-forward decisions are documented.
- Form library, i18n approach, and performance budget targets are agreed and recorded.
- Phase 9 R1 is explicitly assigned (Phase 9b or a named Phase 10 stage).
- Every Phase 10 roadmap item maps to a UI journey and backend contract.
- Any missing backend operation is explicitly assigned to a Phase 10 implementation stage.
- Student, staff, tenant admin, and reporting scopes are separated cleanly.

---

## Stage 1 - Shared Frontend Platform

**Status**: Complete

**Goal**: establish shared frontend foundations before expanding user journeys.

### Scope

- Extend and align `apps/portal` (Phase 4 scaffold) per the Stage 0 carry-forward audit; align to React 18, TypeScript, Vite, Tailwind, and Radix UI, retiring anything inconsistent with this plan.
- Integrate the form management library chosen in Stage 0; demonstrate it in a minimal example form in each app.
- Factor reusable frontend code where appropriate:
  - generated OpenAPI types/client;
  - auth/session helpers;
  - tenant context;
  - form primitives built on the chosen form library;
  - tables, filters, pagination, tabs, dialogs, menus, alerts, toasts, date inputs, and status badges;
  - error boundary and RFC 7807 problem display;
  - loading and empty states;
  - i18n primitives for locale-aware date, number, and currency formatting (approach from Stage 0);
  - accessibility utilities.
- Add OpenAPI type generation from `apps/api/openapi/v1.json`.
- Add shared design tokens and tenant theme hooks.
- Add Playwright test harness with authenticated test fixtures.
- Add axe accessibility checks for page-level tests.
- Add frontend CI jobs for typecheck, lint, unit tests, Playwright, accessibility scanning, OpenAPI drift checks, and performance budget enforcement against Stage 0 targets.

### Deliverables

- Extended and aligned `apps/portal`.
- Shared frontend API client/types.
- Form library integration.
- i18n primitive utilities.
- Shared accessible component primitives.
- Playwright and axe test setup.
- Performance budget CI enforcement.
- CI updates for frontend and accessibility checks.

### Exit Criteria

- Both apps build and typecheck.
- Generated API types are reproducible and drift-checked.
- Form library integrated and working in a minimal example form in each app.
- i18n primitives available and exercised for dates and numbers.
- Performance budget CI check passing against Stage 0 targets.
- A smoke Playwright test runs against both apps with axe enabled.

---

## Stage 2 - Authentication, Authorisation, and Tenant Context

**Status**: Complete

**Goal**: replace development-token UX with production-shaped OIDC and role-aware routing.

### Scope

- Implement OIDC login, callback, refresh, sign-out, and session expiry handling for both apps.
- Preserve a safe development-token path only when explicitly enabled in local/dev configuration.
- Add tenant selection or tenant context display where a user can access multiple tenants.
- Add route guards based on roles/permissions.
- Add permission-aware navigation that hides unavailable actions without relying on client-side checks for security.
- Add friendly 401/403/404/error states.
- Add audit-friendly user identity display and session metadata.
- Validate CORS and frontend origin configuration across local ports.

### Deliverables

- Shared auth provider and route guards.
- OIDC configuration docs.
- Permission-aware navigation model.
- Auth and authorization tests.

### Exit Criteria

- Student and staff users land in the correct app areas after login.
- Unauthorized routes and actions are blocked and tested.
- Token refresh and expiry behave predictably.

---

## Stage 3 - Student Portal Foundation

**Status**: Complete

**Goal**: build the first usable student portal shell and read-only student record experience.

### Scope

- Build student app layout, navigation, dashboard, and account menu.
- Add student profile summary:
  - identity and contact details;
  - enrolment status;
  - programme/module summary;
  - active alerts, holds, and important dates where available.
- Add read-only pages for:
  - enrolments;
  - module registrations;
  - timetable;
  - exam timetable and candidate numbers;
  - adjustments and support indicators visible to students;
  - EC claim status where exposed.
- Add notification centre scaffold for SRS-owned notifications and CRM/EWP context where available. This stage delivers the shell only; notification content delivery is out of Phase 10 scope and will appear in the Stage 8 residual gap register.
- Establish Playwright visual regression baselines for all rendered page templates; these are extended in each subsequent stage so regressions are caught as they are introduced.
- Add mobile/responsive layouts for all student templates.

### Deliverables

- Student portal shell and dashboard.
- Read-only student record pages.
- Visual regression baselines for student portal page templates.
- Student portal smoke/golden-path tests.

### Exit Criteria

- A student can sign in and view their core record, registration, timetable, exam, and status information.
- Student pages pass axe scans and keyboard navigation checks.

---

## Stage 4 - Student Self-Service Journeys

**Status**: Complete

**Goal**: implement student-initiated updates and actions.

### Scope

- Implement personal data and contact detail self-service (F011).
- Implement disability declaration submission/update where student-facing support is permitted.
- Implement module selection and registration journeys:
  - available modules;
  - prerequisite/conflict feedback;
  - confirm registration;
  - withdraw where policy allows;
  - staff override visibility.
- Implement results and progression view:
  - marks/results only after publication;
  - ratification status;
  - progression decisions;
  - award/HEAR links where available.
- Implement exam timetable and candidate information display.
- Add user-facing confirmation, validation, and audit-friendly change summaries.
- Add idempotency handling for high-stakes POST actions.

### Deliverables

- Self-service forms and workflows.
- Module registration UI.
- Results/progression UI.
- Student journey E2E tests.

### Exit Criteria

- Student golden paths for F011/F012 and module registration are complete.
- Student write actions are audited by the API and are safe to retry.
- Published/unpublished result visibility is enforced.

---

## Stage 5a - Staff: Student Record Management and Task Inbox

**Status**: Complete

**Goal**: extend `apps/admin` with operational staff views for student records, enrolment, module registration, and workflow task management.

### Scope

- Extend student search with filtering, saved views, and record detail navigation.
- Add enrolment and registration management screens:
  - lifecycle transitions;
  - module registration overrides;
  - holds/obligations where available;
  - bitemporal history views.
- Add workflow task inbox for all human-task workflows.
- Add correction/appeal and misconduct outcome management where API support exists.

### Deliverables

- Expanded admin routes for student record management.
- Staff workflow task inbox.
- Staff record management E2E tests.

### Exit Criteria

- Staff can search, view, and navigate student records.
- Enrolment and registration lifecycle transitions are available and tested.
- Workflow task inbox shows assigned tasks and allows progression.
- Sensitive views are permission-gated.

---

## Stage 5b - Staff: Assessment and Exam Boards

**Status**: Complete

**Goal**: implement assessment management and the full exam board workflow in `apps/admin`.

### Scope

- Add assessment management:
  - assessment components;
  - mark ingestion review;
  - mark correction workflow;
  - module result calculation and history.
- Add exam board tooling:
  - board list and setup;
  - candidate profile review;
  - EC/adjustment/misconduct visibility;
  - external examiner signoff;
  - ratification workflow;
  - record lock visibility.

### Deliverables

- Assessment management screens.
- Exam board workflow UI.
- Assessment and board E2E tests.

### Exit Criteria

- Staff can complete assessment review and mark correction.
- Exam board workflow is navigable from setup through external examiner signoff and ratification.
- EC and adjustment indicators are visible and permission-gated.
- Screens that display special-category adjustment or EC data trigger a backend read-audit record; the tests verify that audit entries are created.
- Record lock visibility is correct before and after ratification.

---

## Stage 5c - Staff: Regulatory Returns

**Status**: Complete

**Goal**: implement regulatory return management screens for all five statutory exchanges.

### Scope

- Add regulatory return management for:
  - UCAS;
  - HESA;
  - SLC;
  - UKVI;
  - OfS extracts.
- Validation issue display and resolution flow.
- File generation, download, and submission status workflows.

### Deliverables

- Regulatory return screens for all five agencies.
- Regulatory return E2E tests.

### Exit Criteria

- Staff can initiate, validate, and download regulatory returns for all five exchanges.
- Validation failures are displayed with actionable context.
- File download and submission status are visible and tested.

---

## Stage 6 - Tenant and System Administration

**Status**: Complete

**Goal**: provide the administrative screens required to operate the platform per tenant.

### Scope

- Build tenant provisioning and tenant configuration screens.
- Build value-set and localisation/globalisation administration:
  - labels;
  - locale;
  - timezone;
  - currency configuration where exposed.
- Build business rule and versioning screens:
  - progression/classification rules;
  - assessment rules;
  - feature-flagged rule variants.
- Build workflow definition, responsibility, trigger-rule, and feature flag administration.
- Build integration registry management:
  - contract catalogue;
  - registrations;
  - enable/disable;
  - endpoint safety;
  - health;
  - replay/backfill;
  - VLE connector residual operational controls from Phase 9.
- Build user and role administration or Keycloak handoff screens, depending on the Stage 0 decision.
- Build audit log viewer and export controls.

### Deliverables

- Tenant/system admin route group.
- Integration registry dashboard.
- Rule/flag/workflow administration screens.
- Audit viewer.
- Tenant admin E2E tests.

### Exit Criteria

- Tenant administrators can configure the institution without direct database/API tooling.
- Integration health and replay/backfill operations are visible and auditable.
- Dangerous environment/live-endpoint actions require clear confirmation and API enforcement.

---

## Stage 7 - Reporting, BI, Integration Health, and Operations

**Status**: Complete

**Goal**: surface operational reports, extract workflows, and integration health for staff users.

### Scope

- Build standard operational reports:
  - enrolment volumes;
  - module completion rates;
  - award outcomes;
  - adjustment distribution status;
  - regulatory submission status;
  - integration health and drift.
- Build BI/DW extract initiation and download screens where APIs exist.
- Add report filters, saved parameters, export actions, and long-running job status.
- Add integration exchange viewer:
  - exchange history;
  - failed exchanges;
  - retry/replay controls;
  - connector health summaries.
- Add operational visibility for Phase 9 VLE residual gaps:
  - reconciliation trigger/scheduler status;
  - connector health route/status;
  - circuit breaker/degraded status;
  - mark receipt reconciliation warnings;
  - consumer-group isolation warnings.

### Deliverables

- Reporting dashboard.
- Extract/download workflows.
- Integration operations dashboard.
- Reporting and operations E2E tests.

### Exit Criteria

- Staff can generate and inspect key operational reports.
- Integration failures and reconciliation drift are visible from the UI.
- Report/export actions respect RBAC and data classification.

---

## Stage 8 - Accessibility, E2E, Performance, and Acceptance Review

**Status**: Complete

**Goal**: prove the UI surfaces are accessible, reliable, and ready for Phase 11 hardening.

### Scope

- Run automated WCAG 2.1 AA scans with axe across all page-level Playwright tests.
- Run keyboard-only journey checks for all primary workflows.
- Test focus management for dialogs, menus, tabs, forms, and task completion flows.
- Test responsive layouts for desktop, tablet, and mobile viewports.
- Run golden-path E2E suites:
  - student self-service;
  - staff admin;
  - exam board;
  - regulatory return;
  - tenant admin;
  - integration health/replay;
  - reporting.
- Verify that frontend performance budgets (defined in Stage 0 and enforced from Stage 1) are met across key pages and interactions; document any gaps in the residual register.
- Update user guides and support documentation.
- Produce Phase 10 acceptance review and residual gap register for Phase 11 manual audit/release hardening; the register must include at minimum: notification centre content delivery (scaffolded in Stage 3), any remaining Phase 9 R1–R5 items not resolved in Phase 10, and any i18n surface areas deferred from the Stage 0 i18n decision.

### Deliverables

- Accessibility scan reports.
- Playwright golden-path suite.
- Performance budget audit results.
- Updated admin and student portal user guides.
- `docs/phase-10-acceptance-review.md`
- Residual gap register for Phase 11 (including notification centre, unresolved Phase 9 residuals, and i18n deferrals).

### Exit Criteria

- Student portal is operational and WCAG 2.1 AA automated scan clean.
- Staff administrative interface is operational.
- System administration interface is operational.
- Golden-path user journeys pass manually in local environment and automatically in CI.
- No regressions against Phase 4-9 API, integration, and contract tests.

---

## Testing Strategy

Required coverage:

- Frontend typecheck, lint, unit/component tests, and builds for `apps/portal` and `apps/admin`.
- OpenAPI type generation drift checks.
- Playwright E2E tests for student, staff, tenant admin, reporting, and integration health journeys.
- Axe accessibility checks embedded in every page-level Playwright test.
- Keyboard navigation tests for primary workflows.
- Permission/route guard tests for all role families.
- Responsive viewport tests for critical pages.
- API mocking tests for error, empty, loading, and degraded states.
- Full-stack smoke tests against local API, Wellbeing module, and VLE connector where relevant.

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| UI drifts from OpenAPI contracts | Generate types from committed OpenAPI and add drift checks |
| Accessibility becomes a late remediation exercise | Use Radix primitives, axe scans, and keyboard tests from Stage 1 |
| Student and staff surfaces duplicate too much code | Share API client, design tokens, auth, and primitives while keeping app-specific routes separate |
| Client-side permission checks are mistaken for security | Treat client checks as UX only; rely on API RBAC and test 403 states |
| Dense admin workflows become hard to use | Build task-focused layouts, stable tables, filters, and clear workflow states |
| Special-category data appears in inappropriate surfaces | Stage 0 data classification rules and permission-gated views |
| Phase 9 operational gaps remain invisible | Stage 7 exposes connector health, reconciliation, and integration exchange status |
| Frontend tests become slow or brittle | Separate component/unit checks from smaller golden-path Playwright suites with stable fixtures |

---

## Exit Summary

Phase 10 is complete only when the SRS has usable, accessible, role-aware user interfaces:

- students can self-serve and view their authoritative record;
- staff can manage operational student record workflows;
- tenant administrators can configure rules, workflows, flags, integrations, users, and audit visibility;
- reports and integration health are visible without direct database access;
- all major journeys are covered by automated accessibility and E2E checks.
