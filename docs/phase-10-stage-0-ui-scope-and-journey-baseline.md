# Phase 10 Stage 0 — UI Scope, Contracts, and Journey Baseline

> Date: 2026-06-16
> Status: Complete
> Author: Steve J White
> Plan: `docs/phase-10-implementation-plan.md` Stage 0

---

## 1. Purpose

This document records all Stage 0 decisions and deliverables before any Phase 10 code is written. It fixes the scope of every subsequent stage, maps each UI journey to its backend contract, identifies gaps, and records the form library, i18n, performance budget, and Phase 9 R1 scheduler decisions.

---

## 2. Current-State Inventory

### 2.1 `apps/portal`

**Current state**: Empty directory. No `package.json`, no `src/`, no configuration. The portal is a greenfield build.

**Carry-forward decisions**: None. Stage 1 creates `apps/portal` from scratch following ADR-007 (React 18, TypeScript, Vite, Tailwind, Radix UI).

### 2.2 `apps/admin`

**Current state**: Functional Phase 4 slice — student search, student detail, enrolment management, and enrolment transitions. All code is high quality and carries forward.

| Area | Files | What exists | Carry-forward |
|---|---|---|---|
| Auth | `src/auth/oidc.ts`, `src/auth/AuthContext.tsx` | Full PKCE Authorization Code Flow; Keycloak OIDC; token stored in localStorage; logout to Keycloak end session | **Keep as-is** |
| API client | `src/api/client.ts` | Typed `fetch` wrapper; RFC 7807 error parsing; 401 → redirect to login; `ApiError` class | **Keep as-is** |
| Students API | `src/api/students.ts` | `listStudents`, `getStudent`, `createStudent`, `updateStudentIdentity`, `updateHesaId`, `updatePersonStatus` | **Keep, extend** |
| Enrolments API | `src/api/enrolments.ts` | `listStudentEnrolments`, `createEnrolment`, `transitionEnrolment`, `AVAILABLE_TRANSITIONS` | **Keep, extend** |
| Registrations API | `src/api/registrations.ts` | `listModuleRegistrations`, `getTimetable` | **Keep, extend** |
| Pages | `StudentsPage`, `StudentDetailPage`, `LoginPage`, `CallbackPage` | Students list with pagination and create; student detail with identity, enrolments, transitions, and inline registrations | **Keep, extend** |
| Components | `Badge`, `Layout`, `Spinner` | Minimal accessible primitives | **Keep, extend with Radix UI in Stage 1** |
| Styling | `index.css`, Tailwind | Tailwind v3, consistent indigo palette | **Keep** |
| Build | `package.json`, `vite.config`, `tsconfig` | React 18 + TypeScript + Vite | **Keep, align versions in Stage 1** |

**What the admin app is missing** (to be added in Stage 1 unless noted):
- Radix UI component primitives (dialogs, dropdowns, tooltips)
- Form library integration (forms currently use raw `FormData`)
- OpenAPI type generation (types are hand-written; may drift from spec)
- Playwright test harness
- axe accessibility CI checks
- Role-aware navigation (route guards exist but no permission-conditional navigation rendering)
- i18n primitives

---

## 3. App Split Decision

| App | Path | Roles | Authentication |
|---|---|---|---|
| `apps/portal` | `portal.srs` (or localhost:5174) | `student` | Keycloak OIDC; `srs-portal` client |
| `apps/admin` | `admin.srs` (or localhost:5173) | `registry-administrator`, `module-tutor`, `personal-tutor`, `research-supervisor`, `wellbeing-advisor`, `exam-board-member`, `exam-board-chair`, `external-examiner`, `integrity-officer`, `finance-administrator`, `dpo`, `tenant-administrator`, `system-administrator` | Keycloak OIDC; `srs-admin` client (already configured) |

A student authenticating to `apps/admin` should be redirected to `apps/portal`. Staff authenticating to `apps/portal` should be redirected to `apps/admin`. These cross-app redirects are enforced by checking the `roles` claim in the ID token at the callback page.

---

## 4. Form Library Decision

**Decision: React Hook Form (`react-hook-form`) with Zod (`zod`) for schema validation.**

Rationale:
- Uncontrolled-by-default model is compatible with the existing admin code style (which uses `FormData`)
- First-class TypeScript inference from Zod schemas; schema types can be generated from OpenAPI request bodies
- Composable with Radix UI form primitives without a separate adapter
- Lightweight (< 10 kB minified+gzipped)
- Handles multi-step wizard forms required by exam board, regulatory return, and correction workflows
- Stable, widely adopted, no significant vulnerabilities in dependency audit

Stage 1 integrates `react-hook-form` and `zod` into both apps and demonstrates usage in a minimal example form. Existing admin forms (student create, enrolment create) are migrated to use the library in Stage 5a as part of the admin expansion.

---

## 5. i18n Strategy Decision

**Decision: `react-i18next` for UI string management; Intl API for date/number/currency formatting; value-set API for domain-specific labels. Phase 10 delivers en-GB baseline only.**

Rationale:
- `react-i18next` provides the namespace and interpolation infrastructure needed if additional locales are added in Phase 11 without a framework migration
- The globalisation API already exists (`GET /api/v1/admin/globalisation/locale-config`, `GET /api/v1/admin/globalisation/locales`) and drives the tenant's locale, timezone, and currency configuration — the frontend reads this at startup and configures the Intl formatters accordingly
- Value-set member labels (e.g. mode-of-study codes, status labels) are fetched from `GET /api/v1/value-sets/{setCode}` and rendered using the label field rather than the raw code wherever displayed to end users
- Full multi-locale string translation (switching languages at runtime) is deferred to Phase 11

Stage 1 scaffolds `react-i18next` with a single `en-GB` locale file in each app, and provides Intl-based `formatDate`, `formatNumber`, and `formatCurrency` utilities using the tenant locale from the API.

---

## 6. Frontend Performance Budget Targets

These targets are enforced by CI from Stage 1 using Lighthouse CI or `bundlesize`. They are measured against the production Vite build in CI.

| Metric | Target | Tool |
|---|---|---|
| Initial JS bundle (portal) | ≤ 150 kB gzipped | bundlesize CI |
| Initial JS bundle (admin) | ≤ 250 kB gzipped | bundlesize CI |
| Largest Contentful Paint (LCP) | ≤ 2.5 s (Good — Core Web Vitals) | Lighthouse CI |
| First Contentful Paint (FCP) | ≤ 1.5 s | Lighthouse CI |
| Time to Interactive (TTI) | ≤ 3.5 s | Lighthouse CI |
| API response → first data displayed | ≤ 500 ms | Playwright timing assertion |

The 500 ms API→display target aligns with the NFR p95 interactive-API latency target (§20). Pages should use loading skeletons so users have visual feedback within 100 ms of navigation regardless of API latency.

---

## 7. Phase 9 Residual Gap R1 Assignment

**Decision: Phase 9 R1 (reconciliation scheduler wiring) is assigned to Phase 9b — a separate, small backend operationalisation pass.**

The scheduler itself (Temporal schedule, JetStream scheduled consumer, or OS cron) requires no UI. Phase 10 Stage 6 will expose a **manual trigger** button in the integration operations UI (calling `ReconciliationService` directly via an HTTP endpoint that Phase 9b adds to the connector). Stage 7 will display reconciliation run history and status from the `vle_reconciliation_run` table.

Until Phase 9b ships, the Stage 7 reconciliation status UI will display data for manually triggered runs only. This is an acceptable operational mode during the Phase 10 build window. Stage 7 documentation must note the dependency.

---

## 8. UI Journey Inventory

### 8.1 Student Portal (`apps/portal`)

| ID | Journey | F-ref | Role | App section |
|---|---|---|---|---|
| P001 | Login and session management | — | student | Auth |
| P002 | Dashboard — summary of key information | — | student | Dashboard |
| P003 | View personal identity and contact details | F011 | student | Profile |
| P004 | Update personal name, email, phone, address | F011 | student | Profile |
| P005 | View current and past enrolments | — | student | Enrolments |
| P006 | View module registrations | — | student | Modules |
| P007 | Browse available modules and prerequisites | — | student | Modules |
| P008 | Register for a module | — | student | Modules |
| P009 | Withdraw from a module (within policy) | — | student | Modules |
| P010 | View marks and results (post-publication) | — | student | Results |
| P011 | View progression decisions | — | student | Progression |
| P012 | View award record and HEAR | — | student | Progression |
| P013 | View class timetable | — | student | Timetable |
| P014 | View exam timetable and candidate number | F012 | student | Exams |
| P015 | View approved adjustments (student-visible) | — | student | Adjustments |
| P016 | View EC claim status | — | student | Circumstances |
| P017 | Submit disability declaration | — | student | Disability |
| P018 | Annual re-enrolment confirmation | W010 | student | Re-enrolment |
| P019 | Notification centre (scaffold only; Phase 11 for content) | — | student | Notifications |
| P020 | Sign out | — | student | Auth |

### 8.2 Staff Record Management (`apps/admin` — Stage 5a)

| ID | Journey | F-ref | Role | App section |
|---|---|---|---|---|
| A001 | Login and session management | — | all staff | Auth |
| A002 | Student search with filtering and saved views | — | registry-administrator, module-tutor, personal-tutor | Students |
| A003 | Student record detail view | — | registry-administrator, personal-tutor, module-tutor | Students |
| A004 | Edit student identity and contact details | F011 | registry-administrator | Students |
| A005 | Add / update HESA identifier | — | registry-administrator | Students |
| A006 | Update person lifecycle status | — | registry-administrator | Students |
| A007 | View enrolment detail and bitemporal history | — | registry-administrator | Enrolments |
| A008 | Enrolment lifecycle transitions (intermit, suspend, withdraw, reinstate, graduate) | — | registry-administrator | Enrolments |
| A009 | Create new enrolment | — | registry-administrator | Enrolments |
| A010 | View and manage module registrations | — | registry-administrator, module-tutor (own) | Registrations |
| A011 | Module registration override (staff create) | — | registry-administrator | Registrations |
| A012 | Module registration withdrawal (staff) | — | registry-administrator | Registrations |
| A013 | View module registration history | — | registry-administrator | Registrations |
| A014 | Workflow task inbox — view assigned tasks | W001–W012 | all staff | Tasks |
| A015 | Workflow task — claim and complete task | W001–W012 | varies by task | Tasks |
| A016 | View and action correction/appeal cases | W006 | registry-administrator | Corrections |
| A017 | Manage misconduct outcome records | W004 | integrity-officer | Misconduct |
| A018 | Sign out | — | all staff | Auth |

### 8.3 Assessment and Exam Boards (`apps/admin` — Stage 5b)

| ID | Journey | F-ref | Role | App section |
|---|---|---|---|---|
| B001 | Manage assessment components for a module offering | — | registry-administrator, module-tutor | Assessment |
| B002 | Review mark ingestion and submission status | F016 | registry-administrator, module-tutor | Assessment |
| B003 | Mark correction workflow (initiate, review, approve) | — | registry-administrator | Assessment |
| B004 | View module result calculation and history | — | registry-administrator, exam-board-member | Assessment |
| B005 | Create and set up exam board | W005 | registry-administrator, exam-board-chair | Boards |
| B006 | Generate and view exam board data pack | F064 | registry-administrator, exam-board-chair, exam-board-member | Boards |
| B007 | Candidate profile review (marks, EC, adjustment, misconduct indicators) | F064 | exam-board-chair, exam-board-member, external-examiner | Boards |
| B008 | External examiner signoff | F068 | external-examiner | Boards |
| B009 | Ratification workflow — chair ratifies outcomes | F065 | exam-board-chair | Boards |
| B010 | View record lock status after ratification | — | registry-administrator, exam-board-chair | Boards |
| B011 | Initiate post-ratification correction or appeal case | W006 | registry-administrator | Corrections |
| B012 | Exam entry and exam schedule management | F012 | registry-administrator | Exams |

### 8.4 Regulatory Returns (`apps/admin` — Stage 5c)

| ID | Journey | F-ref | Role | App section |
|---|---|---|---|---|
| C001 | HESA — generate return, validate, view issues, download file, submit, view amendments | F047, F048 | registry-administrator | Regulatory |
| C002 | SLC — generate enrolment confirmations, view SLC notifications | F049, F050 | registry-administrator | Regulatory |
| C003 | UCAS — link applications, generate confirmation files, view exchange records | F045, F046 | registry-administrator | Regulatory |
| C004 | UKVI — CAS management, compliance alert resolution, attendance report generation, visa status updates | F051, F052 | registry-administrator | Regulatory |
| C005 | OfS — B3 extract generation, participation reports | — | registry-administrator | Regulatory |
| C006 | FOI — manage requests, generate extract, update status | — | dpo, registry-administrator | Regulatory |

### 8.5 Tenant and System Administration (`apps/admin` — Stage 6)

| ID | Journey | F-ref | Role | App section |
|---|---|---|---|---|
| D001 | Tenant provisioning | — | system-administrator | Tenants |
| D002 | Tenant configuration management | — | tenant-administrator | Tenants |
| D003 | Value-set management and label editing | — | tenant-administrator | Config |
| D004 | Globalisation: locale, timezone, currency configuration | §19 | tenant-administrator | Config |
| D005 | Business rule management — progression, classification, assessment rules | §13 | tenant-administrator | Rules |
| D006 | Feature flag management (create, assign, evaluate, retire) | §14 | tenant-administrator, system-administrator | Flags |
| D007 | Workflow definition and version management | §4 | tenant-administrator | Workflows |
| D008 | Workflow assignment rule management | §4 | tenant-administrator | Workflows |
| D009 | Trigger rule management | §4 | tenant-administrator | Workflows |
| D010 | Integration contract catalogue (read-only view) | — | tenant-administrator | Integrations |
| D011 | Integration registration management — create, update, enable/disable | — | tenant-administrator | Integrations |
| D012 | Integration endpoint safety management | — | tenant-administrator, system-administrator | Integrations |
| D013 | Integration health and replay/backfill | — | tenant-administrator | Integrations |
| D014 | VLE connector operational controls: manual reconciliation trigger, health status, circuit breaker | Phase 9 R2, R3 | tenant-administrator | Integrations |
| D015 | User and role administration (Keycloak handoff with deep-link) | — | tenant-administrator, system-administrator | Users |
| D016 | Audit log viewer and export | §5 | dpo, tenant-administrator, system-administrator | Audit |
| D017 | Environment management and promotion records | §9 | system-administrator | Platform |

### 8.6 Reporting and Operations (`apps/admin` — Stage 7)

| ID | Journey | F-ref | Role | App section |
|---|---|---|---|---|
| E001 | Enrolment volume report | F027 | registry-administrator | Reports |
| E002 | Module completion rate report | F028 | registry-administrator | Reports |
| E003 | Award outcome report | F029 | registry-administrator | Reports |
| E004 | Adjustment distribution status report | — | registry-administrator, tenant-administrator | Reports |
| E005 | Regulatory submission status report | F030 | registry-administrator | Reports |
| E006 | Integration health and drift report | — | tenant-administrator | Reports |
| E007 | BI/DW extract initiation and download | F027–F030 | registry-administrator | Extracts |
| E008 | Report filters, saved parameters, export, job status | — | registry-administrator | Reports |
| E009 | Integration exchange history and failed exchange viewer | — | tenant-administrator | Operations |
| E010 | Retry/replay controls for failed exchanges | — | tenant-administrator | Operations |
| E011 | Connector health summaries | Phase 9 R2 | tenant-administrator | Operations |
| E012 | VLE reconciliation trigger/scheduler status (Phase 9 R1 manual trigger) | Phase 9 R1 | tenant-administrator | Operations |
| E013 | Circuit breaker and degraded-mode status (Phase 9 R3) | Phase 9 R3 | tenant-administrator | Operations |
| E014 | Mark receipt reconciliation warnings (Phase 9 R4) | Phase 9 R4 | tenant-administrator | Operations |
| E015 | Consumer group isolation warnings (Phase 9 R5) | Phase 9 R5 | tenant-administrator | Operations |

---

## 9. Route Maps

### 9.1 `apps/portal`

```
/                       → redirect to /dashboard
/login                  → LoginPage (OIDC start)
/callback               → CallbackPage (OIDC complete)
/dashboard              → DashboardPage
/profile                → ProfilePage
/profile/edit           → ProfileEditPage (F011)
/enrolments             → EnrolmentsPage
/modules                → ModulesPage (registered modules)
/modules/register       → ModuleSelectionPage (browse + register)
/results                → ResultsPage (marks post-publication)
/progression            → ProgressionPage (decisions + award)
/timetable              → TimetablePage (class timetable)
/exams                  → ExamPage (exam timetable + candidate number, F012)
/adjustments            → AdjustmentsPage (student-visible approved adjustments)
/circumstances          → CircumstancesPage (EC claim status)
/disability             → DisabilityPage (declaration submit/update)
/re-enrolment           → ReEnrolmentPage (W010 confirmation)
/notifications          → NotificationsPage (scaffold; Phase 11 for content)
```

### 9.2 `apps/admin`

```
/login                          → LoginPage
/callback                       → CallbackPage
/dashboard                      → DashboardPage (summary, quick links by role)

/* Stage 5a — Student records */
/students                       → StudentsPage (search, list)
/students/:personId             → StudentDetailPage (tabs: identity, enrolments, registrations, history)
/enrolments/:enrolmentId        → EnrolmentDetailPage (detail, history, transitions, fee liabilities)
/tasks                          → WorkflowTaskInboxPage (all assigned tasks)
/tasks/:workflowTaskId          → WorkflowTaskPage (action current task)
/corrections                    → CorrectionsPage
/corrections/:caseId            → CorrectionCaseDetailPage
/misconduct                     → MisconductPage

/* Stage 5b — Assessment and exam boards */
/assessment                     → AssessmentIndexPage
/assessment/marks               → MarkReviewPage
/assessment/corrections         → MarkCorrectionPage
/boards                         → ExamBoardsPage
/boards/new                     → ExamBoardCreatePage
/boards/:boardId                → ExamBoardDetailPage (tabs: data pack, candidates, attendance, signoff, ratification)
/boards/:boardId/candidates/:enrolmentId → CandidateProfilePage

/* Stage 5c — Regulatory returns */
/regulatory                     → RegulatoryIndexPage
/regulatory/hesa                → HesaReturnPage
/regulatory/slc                 → SlcPage
/regulatory/ucas                → UcasPage
/regulatory/ukvi                → UkviPage
/regulatory/ofs                 → OfsPage
/regulatory/foi                 → FoiPage

/* Stage 6 — Tenant/system admin */
/admin                          → AdminIndexPage
/admin/tenants                  → TenantsPage (system-admin only)
/admin/tenants/:tenantId        → TenantDetailPage
/admin/config                   → TenantConfigPage
/admin/value-sets               → ValueSetsPage
/admin/rules                    → RulesPage
/admin/flags                    → FeatureFlagsPage
/admin/flags/:featureFlagId     → FeatureFlagDetailPage
/admin/workflows                → WorkflowDefinitionsPage
/admin/integrations             → IntegrationRegistryPage
/admin/integrations/:id         → IntegrationRegistrationDetailPage
/admin/users                    → UsersPage (Keycloak deep-link)
/admin/audit                    → AuditLogPage
/admin/environments             → EnvironmentsPage (system-admin only)

/* Stage 7 — Reporting and operations */
/reports                        → ReportsIndexPage
/reports/enrolments             → EnrolmentReportPage
/reports/assessment             → AssessmentReportPage
/reports/awards                 → AwardReportPage
/reports/adjustments            → AdjustmentStatusReportPage
/reports/regulatory             → RegulatoryStatusReportPage
/reports/integration-health     → IntegrationHealthReportPage
/extracts                       → ExtractsPage
/operations                     → OperationsIndexPage
/operations/exchanges           → ExchangeHistoryPage
/operations/vle                 → VleOperationsPage (connector health, reconciliation, circuit breaker, warnings)
```

---

## 10. Role-to-Route Matrix

The matrix uses: **R** = read/view, **W** = write/initiate, **—** = no access, **Scoped** = access is further scoped (see note).

| Route group | student | registry-admin | module-tutor | personal-tutor | exam-board-chair | external-examiner | integrity-officer | dpo | tenant-admin | system-admin |
|---|---|---|---|---|---|---|---|---|---|---|
| Portal (`/`) | R/W | — | — | — | — | — | — | — | — | — |
| `/students` | — | R/W | Scoped R | Scoped R | — | — | — | — | — | — |
| `/enrolments/:id` | — | R/W | — | Scoped R | — | — | — | — | — | — |
| `/tasks` | — | R/W | Scoped R/W | Scoped R/W | Scoped R/W | — | Scoped R/W | — | R/W | — |
| `/assessment` | — | R/W | Scoped R/W | — | R | — | — | — | — | — |
| `/boards` | — | R/W | — | — | R/W | Scoped R | — | — | — | — |
| `/regulatory` | — | R/W | — | — | — | — | — | Scoped R/W | — | — |
| `/admin/tenants` | — | — | — | — | — | — | — | — | — | R/W |
| `/admin/config`, `/admin/value-sets`, `/admin/rules`, `/admin/flags`, `/admin/workflows` | — | — | — | — | — | — | — | — | R/W | R/W |
| `/admin/integrations` | — | — | — | — | — | — | — | — | R/W | R/W |
| `/admin/audit` | — | — | — | — | — | — | — | R/W | R | R/W |
| `/reports`, `/operations` | — | R | — | — | — | — | — | — | R/W | R/W |

**Notes**:
- `module-tutor` access to `/students` is scoped to students registered on their modules.
- `personal-tutor` access to `/students` is scoped to their assigned student cohort.
- `external-examiner` access to `/boards/:boardId` is read-only and scoped to their appointed programme.
- `dpo` access to `/regulatory/foi` is write; access to `/admin/audit` is read/write.
- Route guard implementation: route access is controlled by checking the `roles` claim in the decoded JWT. Absence of a required role renders a 403 page. Server-side RBAC remains the authoritative enforcement.

---

## 11. API Coverage by Journey

### Portal journeys

| Journey | API operation(s) |
|---|---|
| P003 — View identity | `GET /api/v1/students/{personId}` |
| P004 — Update identity | `PATCH /api/v1/students/{personId}/identity` |
| P004 — Update address | `GET /api/v1/students/{personId}/addresses`, `POST /api/v1/students/{personId}/addresses` |
| P005 — View enrolments | `GET /api/v1/students/{personId}/enrolments`, `GET /api/v1/enrolments/{enrolmentId}` |
| P006 — View registrations | `GET /api/v1/module-registrations?enrolmentId={id}` |
| P007 — Browse modules | `GET /api/v1/modules`, `GET /api/v1/module-offerings` |
| P008 — Register for module | `POST /api/v1/module-registrations` |
| P009 — Withdraw from module | `POST /api/v1/module-registrations/{id}/withdrawal` |
| P010 — View results | `GET /api/v1/module-registrations/{id}/marks`, `GET /api/v1/enrolments/{id}/progression` |
| P011 — Progression decisions | `GET /api/v1/enrolments/{id}/progression` |
| P012 — Award record | `GET /api/v1/enrolments/{id}/award` |
| P013 — Class timetable | `GET /api/v1/module-registrations/timetable` |
| P014 — Exam timetable | `GET /api/v1/module-registrations/{id}/exam-timetable`, `GET /api/v1/module-registrations/{id}/exam-entry` |
| P015 — Adjustments (student view) | `GET /api/v1/students/{personId}/adjustments` |
| P016 — EC status | `GET /api/v1/students/{personId}/exceptional-circumstances` |
| P017 — Disability declaration | `POST /api/v1/students/{personId}/disability-declarations`, `GET /api/v1/students/{personId}/disability-declarations` |
| P018 — Re-enrolment | **See gap register — endpoint missing** |
| P019 — Notifications | **See gap register — no notification API** |

### Admin journeys (selected)

| Journey | API operation(s) |
|---|---|
| B006 — Board data pack | `POST /api/v1/exam-boards/{boardId}/data-pack`, `GET /api/v1/exam-boards/{boardId}/data-pack` |
| B007 — Candidate profile | `GET /api/v1/exam-boards/{boardId}/candidates/{enrolmentId}` |
| B008 — External examiner signoff | `POST /api/v1/exam-boards/{boardId}/external-examiner-signoff` |
| B009 — Ratification | `POST /api/v1/exam-boards/{boardId}/ratification` |
| C001 — HESA return | `POST /api/v1/regulatory/hesa/returns`, `POST /api/v1/regulatory/hesa/returns/{id}/validate`, `GET /api/v1/regulatory/hesa/returns/{id}/file`, `POST /api/v1/regulatory/hesa/returns/{id}/submit` |
| C002 — SLC | `POST /api/v1/regulatory/slc/confirmations/generate`, `GET /api/v1/enrolments/{id}/slc-notifications` |
| C003 — UCAS | `POST /api/v1/regulatory/ucas/applications`, `POST /api/v1/regulatory/ucas/confirmations/generate` |
| C004 — UKVI | `POST /api/v1/regulatory/ukvi/cas-requests/generate`, `GET /api/v1/regulatory/ukvi/compliance-alerts`, `POST /api/v1/regulatory/ukvi/compliance-alerts/evaluate`, `POST /api/v1/regulatory/ukvi/attendance-reports/generate` |
| C005 — OfS | `POST /api/v1/regulatory/ofs/b3-extracts`, `POST /api/v1/regulatory/ofs/participation-reports` |
| C006 — FOI | `POST /api/v1/regulatory/foi/requests`, `POST /api/v1/regulatory/foi/requests/{id}/extract` |
| D005 — Rules | `GET /api/v1/academic-rules`, `POST /api/v1/academic-rules` (via platform-controls) |
| D006 — Feature flags | `GET/POST /api/v1/feature-flags`, `PATCH /api/v1/feature-flags/{id}`, `POST /api/v1/feature-flags/{id}/assignments` |
| D010 — Integration registry | `GET /api/v1/integration-contracts`, `GET /api/v1/integration-registrations` |
| D011 — Integration CRUD | `POST /api/v1/integration-registrations`, `PATCH /api/v1/integration-registrations/{id}` |
| A014/A015 — Workflow tasks | `GET /api/v1/workflow-tasks`, `POST /api/v1/workflow-tasks/{id}/completion` |

---

## 12. API/UI Gap Register

| # | Journey | Gap | Severity | Action |
|---|---|---|---|---|
| G001 | P018 — Annual re-enrolment | No `POST /api/v1/students/{personId}/re-enrolment` endpoint exists. W010 references `portal-self-service-update.v1` contract but the API operation is absent from the OpenAPI spec. | High | Assign to Phase 10 Stage 1 scope — add endpoint before Stage 4 begins. |
| G002 | P019 — Notifications | No notification API exists. Phase 8 residual: wellbeing case transition events are not published to NATS, so downstream portal subscribers have no data source. Notification centre must remain a scaffold until Phase 9b or Phase 11 adds event publication and a notification aggregation endpoint. | Medium | Notification centre scaffold in Stage 3; excluded from Stage 4 journey completeness. Record in Stage 8 residual register. |
| G003 | P004 — Address update | `PATCH /api/v1/students/{personId}/addresses/{addressId}` is absent; only `POST` (create new) exists. Bitemporal semantics may intend new-version creation rather than in-place patch, but the portal needs a "current address" update flow. | Medium | Verify API semantics in Stage 1; if PATCH is genuinely absent, add it before Stage 4. |
| G004 | P004 — Contact methods | No dedicated contact-method endpoints (e.g. secondary phone, preferred contact channel) are present in the spec. Identity PATCH covers primary email and phone only. | Low | Confirm scope in Stage 1 — if contact method management beyond identity fields is in F011 scope, add API before Stage 4. |
| G005 | D014/E012 — VLE connector HTTP health route | Phase 9 R2: connector health is not exposed via an HTTP route. Operations UI in Stage 6/7 cannot surface health data until R2 is implemented. | Medium | Phase 9b delivers the HTTP health endpoint; Stage 6/7 UI has a placeholder until it exists. |
| G006 | E013 — Circuit breaker status | Phase 9 R3: no circuit breaker implemented. Stage 7 can show "not implemented" status with a roadmap note. | Low | Stage 8 residual register; Phase 11. |
| G007 | P015 — Student adjustment visibility | `GET /api/v1/students/{personId}/adjustments` exists; verify that the `student` RBAC role is permitted to call it and that the response filters to student-visible fields only (no special-category clinical data). | Medium | Confirm RBAC in Stage 2; if adjustment endpoint is not student-accessible, add a student-scoped variant. |
| G008 | B012 — Exam board list | No `GET /api/v1/exam-boards` (list) endpoint visible in the spec — only `POST /api/v1/exam-boards` and `GET /api/v1/exam-boards/{boardId}`. A list/search endpoint is needed for the board index page. | Medium | Verify in Stage 1; add if absent before Stage 5b. |

---

## 13. Phase 9 Residual Gaps — Phase 10 UI Scope

| Phase 9 gap | Phase 10 UI action | Stage | Backend dependency |
|---|---|---|---|
| R1 — Reconciliation scheduler | Manual trigger button in VLE operations panel; reconciliation run history display | Stage 6 (trigger), Stage 7 (history) | Phase 9b: HTTP trigger endpoint on connector |
| R2 — HTTP health route on connector | Connector health status card in integration registry detail and VLE operations page | Stage 6 (registry), Stage 7 (operations) | Phase 9b: `GET /vle/health` on connector app |
| R3 — No circuit breaker | Status warning badge: "Circuit breaker not implemented — see Phase 11 roadmap" | Stage 7 | None (informational) |
| R4 — No pending receipt before SRS call | Mark receipt reconciliation warning panel | Stage 7 | None (display existing null-markId count) |
| R5 — Consumer group not used | Consumer group isolation warning in integration registry detail | Stage 6 | None (informational) |

---

## 14. Data Classification Display Rules

The following rules apply across all Phase 10 screens. They are enforced at the API (RBAC + field filtering) and verified at the UI layer.

| Data class | Examples | Display rule |
|---|---|---|
| **Public / non-personal** | Programme titles, module codes, academic periods | Display freely; no restrictions |
| **Personal (non-sensitive)** | Student name, student number, institutional email | Visible to roles with data access scope; redacted in logs |
| **Sensitive personal** | Date of birth, personal email, home address, phone | Role-gated; not displayed in list/summary views — detail view only |
| **Special category** | Disability declarations, adjustment clinical justification, EC clinical evidence, MH case content | `wellbeing-advisor` role required; **every view generates a backend read-audit record**; frontend must invoke the correct scoped endpoint; must not appear in browser URL params |
| **Financial** | Fee liability amounts, SLC loan entitlements | `finance-administrator` role; not visible to academic staff |
| **Regulatory / compliance** | HESA return data, CAS references, visa status, UKVI compliance case | `registry-administrator` or `dpo`; access audited |
| **Locked records** | Mark and enrolment data after ratification lock | Display with lock indicator; write actions blocked; correction workflow is the only mutation path |

**Special-category UI rule**: Any page or component that displays data bearing a special-category classification must call the API endpoint that triggers the backend read-audit record. The frontend must never infer or cache special-category data across navigation. Stage 5b exit criteria include a test verifying that audit records are created when exam board candidate profiles (containing EC/adjustment indicators) are viewed.

---

## 15. Accessibility Checklist

The following criteria apply to every page template and primary workflow in Phase 10. They are verified by automated axe scans and manual keyboard tests in Stage 8.

### 15.1 All pages

- [ ] Page has a unique, descriptive `<title>` element
- [ ] Landmark regions (`<main>`, `<nav>`, `<header>`, `<footer>`) are present
- [ ] Skip-to-main link is the first focusable element
- [ ] Colour contrast meets WCAG 2.1 AA (4.5:1 text, 3:1 UI components)
- [ ] No information conveyed by colour alone
- [ ] Text is resizable to 200% without loss of content or horizontal scrolling

### 15.2 Navigation and routing

- [ ] Active route is visually distinguished and indicated with `aria-current="page"`
- [ ] Focus is moved to page heading or first meaningful element on route change (not browser top)
- [ ] Breadcrumbs use `<nav aria-label="Breadcrumb">` and `aria-current="page"` on the current item

### 15.3 Forms (all forms including search, create, edit, transition)

- [ ] All inputs have explicit `<label>` associations (not placeholder-only)
- [ ] Required fields are marked with `aria-required="true"` (or `required`) and visually
- [ ] Field-level errors are associated with `aria-describedby`; `aria-invalid="true"` set on error state
- [ ] Form submission error summary is programmatically focused and lists all errors
- [ ] Buttons are typed (`type="submit"` or `type="button"`) to prevent unintended submission
- [ ] Destructive actions (withdraw, delete, lock) require a confirmation step before submission

### 15.4 Dialogs and modals

- [ ] Modal uses `role="dialog"`, `aria-modal="true"`, and `aria-labelledby`
- [ ] Focus is trapped within the modal; Tab and Shift+Tab cycle within
- [ ] Focus returns to the triggering element on close (not document top)
- [ ] Escape key closes the modal

### 15.5 Tables and data grids

- [ ] Data tables use `<table>`, `<th scope="col">`, and `<caption>` or `aria-label`
- [ ] Sortable columns indicate sort state with `aria-sort`
- [ ] Pagination controls are keyboard-accessible and announce page context

### 15.6 Status badges and state indicators

- [ ] Colour badges include a visually hidden text label (not colour-only)
- [ ] Loading states use `aria-live="polite"` regions for dynamic updates
- [ ] Error and success toasts use `role="status"` or `role="alert"` as appropriate

### 15.7 Workflows (multi-step)

- [ ] Workflow step indicator communicates current step, completed steps, and total steps to screen readers
- [ ] Incomplete workflow steps warn before navigation away (with keyboard-accessible confirmation)

### 15.8 Special-category data screens

- [ ] No special-category content is exposed in page titles, URL parameters, or browser history
- [ ] "Sensitive data" indicator is present and described (not colour-only)

---

## 16. User and Role Administration Decision

**Decision: Keycloak deep-link handoff** for user and role management.

Phase 10 will not build a custom user provisioning UI. Journey D015 surfaces a link from the `apps/admin` tenant configuration section that opens the Keycloak admin console for the tenant's realm. This is appropriate because:
- Keycloak's admin UI is complete and secure for user lifecycle management
- Duplicating it in Phase 10 is significant scope without corresponding user value
- The Phase 10 focus is on SRS-domain workflows, not IdP administration

If institutions require an embedded user management UI in a future phase, that is a Phase 11 or later enhancement.

---

## 17. Exit Criteria Verification

| Criterion | Status |
|---|---|
| Current state of both apps inventoried; carry-forward decisions documented | Complete (§2) |
| Form library decided and recorded | Complete — React Hook Form + Zod (§4) |
| i18n approach decided and recorded | Complete — react-i18next, en-GB baseline, Intl for formatting (§5) |
| Performance budget targets defined | Complete (§6) |
| Phase 9 R1 explicitly assigned | Complete — Phase 9b (§7) |
| Every Phase 10 roadmap item maps to a UI journey | Complete — 55 journeys inventoried across P, A, B, C, D, E groups (§8) |
| Any missing backend operation is assigned to a Phase 10 stage | Complete — 8 gaps registered; G001 and G003 assigned to Stage 1 scope (§12) |
| Student, staff, tenant admin, and reporting scopes are separated cleanly | Complete — two apps; admin routes grouped by Stage 5a/5b/5c/6/7 (§9) |
| Accessibility criteria defined per page template and workflow | Complete (§15) |
| Phase 9 residual operational gaps assigned to Phase 10 stages | Complete (§13) |
