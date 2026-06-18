# Phase 10 Acceptance Review

> Date: 2026-06-17
> Status: **Complete** — all 8 stages delivered
> Reviewer: Steve J White
> Prerequisite phases: 4–9 complete

---

## 1. Summary

Phase 10 delivered the complete user interface layer for Revelation SRS. Two applications were built:

- **`apps/portal`** — student self-service portal (React 18, Vite, Tailwind, PKCE OIDC via Keycloak)
- **`apps/admin`** — staff and tenant administration interface (same stack)

Both applications consume the stable REST APIs, domain events, workflow commands, feature flags, integration registry, and first-party/external integration patterns established in Phases 4–9.

---

## 2. Stage Delivery Summary

| Stage | Name | Status | Key Deliverables |
|---|---|---|---|
| 0 | UI scope, contracts, and journey baseline | Complete | 55 journeys mapped, 8 API gaps registered, form/i18n/perf decisions |
| 1 | Shared frontend platform | Complete | `packages/ui` (API client, auth utilities, components, i18n, OpenAPI types), portal scaffold, admin extended |
| 2 | Authentication and authorisation | Complete | PKCE OIDC, JWT parse/refresh, role utilities, RequireRole/RequireAuth guards |
| 3 | Student portal — core journeys | Complete | 9 portal pages covering profile, enrolments, timetable, exams, adjustments, ECs |
| 4 | Student portal — self-service actions | Complete | Profile edit, address add, disability declaration, module add/withdraw, results |
| 5a | Staff: student record management | Complete | StudentDetailPage (5 tabs), StudentsPage (search/filter), TaskInboxPage |
| 5b | Staff: assessment and exam boards | Complete | ExamBoardsPage, ExamBoardDetailPage (4 tabs, sign-off, special-category gate) |
| 5c | Staff: regulatory returns | Complete | 5 regulatory body pages (HESA, UCAS, SLC, UKVI, OfS) |
| 6 | Tenant and system administration | Complete | 9 admin pages (config, value sets, globalisation, rules, workflows, flags, integrations, audit) |
| 7 | Reporting, BI, integration health, and operations | Complete | 7 pages (reporting hub, enrolment report, regulatory status, FOI, operations hub, env runtime, integration ops) |
| 8 | Accessibility, E2E, performance, and acceptance review | Complete | 8 E2E test files, axe scans, golden-path suites, keyboard and responsive tests |

---

## 3. Test Coverage

### 3.1 Automated accessibility (axe WCAG 2.1 AA)

| File | Scope | Pages covered |
|---|---|---|
| `e2e/admin-authenticated.spec.ts` | All admin routes (authenticated) | 26 routes + login + 403 |
| `e2e/portal-authenticated.spec.ts` | All portal routes (authenticated) | 14 routes + login + 403 |
| `e2e/admin-smoke.spec.ts` | Public admin pages | login, 403 (unauthenticated) |
| `e2e/portal-smoke.spec.ts` | Public portal pages | login, 403 (unauthenticated) |

All pages are scanned with `AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa'])`.

### 3.2 Golden-path E2E

| File | Journeys |
|---|---|
| `e2e/admin-golden-path.spec.ts` | GP-A01–GP-A09: student search, task inbox, exam boards, HESA, tenant config, reporting hub, env runtime, integration ops, RBAC |
| `e2e/portal-golden-path.spec.ts` | GP-P01–GP-P08: dashboard, profile, enrolments, modules, results, timetable, adjustments, navigation |

### 3.3 Keyboard navigation

`e2e/admin-a11y.spec.ts` covers:
- Login form Tab traversal (KN-01)
- Authenticated nav Tab traversal (KN-02)
- Students page form/table reachability (KN-03)
- Focus visibility on focused elements (KN-04)
- Inline confirm activate/cancel by keyboard (KN-05)
- Tab component keyboard switching (KN-07)

### 3.4 Responsive layouts

`e2e/admin-responsive.spec.ts` covers:
- Desktop (1280×800), tablet (768×1024), mobile (375×667)
- Key pages: dashboard, students, tenant admin, portal login

### 3.5 Other automated checks

| Check | Script | Budgets |
|---|---|---|
| Frontend TypeScript | `pnpm typecheck` | Zero errors |
| Bundle size | `pnpm check:bundle-size` | Portal ≤150 kB gzipped, admin ≤250 kB gzipped |
| OpenAPI type drift | `pnpm check:types-drift` | Zero drift from `apps/api/openapi/v1.json` |
| Unit/integration tests | `pnpm test` + `pnpm test:int` | Phase 4–9 suites (204 tests from Phase 9) |

---

## 4. Route and Permission Coverage

### 4.1 Admin routes (26 protected)

All routes verified:
- Redirect to `/login` when unauthenticated (existing smoke suite)
- Render heading and pass axe when authenticated as `registry-administrator` (Stage 8)
- Role-gated routes (`/tenant-admin/**`) require `tenant-administrator | registry-administrator | system-administrator` via `<RequireRole>`

### 4.2 Portal routes (14 protected)

All routes verified:
- Redirect to `/login` when unauthenticated
- Render heading and pass axe when authenticated as `student`

### 4.3 Special-category data gates

`ExamBoardDetailPage` candidates tab is wrapped in `<RequireRole roles={SPECIAL_CATEGORY_ROLES}>` covering: `registry-administrator`, `wellbeing-advisor`, `wellbeing-mental-health-advisor`, `wellbeing-panel-chair`, `wellbeing-auditor`, `dpo`.

---

## 5. Performance Budget Audit

Budgets set in Stage 0, enforced by `scripts/check-bundle-size.mjs` in CI from Stage 1:

| App | Budget | Status |
|---|---|---|
| `apps/portal` | ≤150 kB gzipped JS | Enforced by CI |
| `apps/admin` | ≤250 kB gzipped JS | Enforced by CI |

Full Lighthouse CI (LCP, FCP, TTI) is tracked as a Phase 11 item (see R-PERF-001 below) — the current CI check covers bundle size only. LCP ≤2.5s / FCP ≤1.5s / TTI ≤3.5s targets remain as Phase 11 exit criteria.

---

## 6. Known Gaps and Phase 11 Residual Register

### 6.1 Notification centre (Phase 8 residual from Stage 3)

| ID | Gap | Phase 11 action |
|---|---|---|
| R-NOTIFY-001 | Notification centre is scaffold only — `NotificationsPage` renders a static empty state. No NATS event consumer delivers real-time notifications to the portal. | Build NATS JetStream consumer in `apps/portal`; implement server-sent events or WebSocket push; complete the notification centre. |

### 6.2 Phase 9 VLE residual items (carried into Phase 10)

| ID | Gap | Phase 11 action |
|---|---|---|
| R-VLE-001 | Grade sync conflict resolution UI | Build conflict resolution workflow in `ExamBoardDetailPage` or dedicated page |
| R-VLE-002 | Manual enrollment override audit trail UI | Add audit trail view to `StudentDetailPage` corrections tab |
| R-VLE-003 | Bulk reconciliation trigger UI | Add trigger button to `IntegrationOpsPage` connector health panel |

Phase 9 R1 (reconciliation scheduler) was assigned to Phase 9b/backend. `IntegrationOpsPage` surfaces the health-check endpoint as a proxy; a dedicated scheduler status panel is deferred.

### 6.3 i18n deferrals (from Stage 0 decision)

| ID | Gap | Phase 11 action |
|---|---|---|
| R-I18N-001 | Only `en-GB` locale delivered. Welsh (`cy`) and other UK HE locales not yet translated. | Add locale files; wire `i18next` language switcher; test RTL rendering. |
| R-I18N-002 | Value-set API labels used in display but not loaded into i18n namespace — UI falls back to raw codes in some edge cases. | Complete value-set label interpolation across all domain code displays. |

### 6.4 API gaps (from Stage 0 gap register)

| ID | Gap | Phase 11 action |
|---|---|---|
| R-API-001 | No dedicated aggregate/stats endpoint for enrolment volumes. `EnrolmentReportPage` samples first 50 students client-side. | Add `GET /api/v1/reporting/enrolment-volumes` aggregate endpoint. |
| R-API-002 | No entity-level audit log API. `AuditPage` uses integration exchange proxy with a gap notice. | Add `GET /api/v1/audit-log` endpoint with entity type/ID filters. |
| R-API-003 | Student EC submission (`POST /api/v1/exceptional-circumstances`) requires staff fields (`outcomeCode`, `determinationDate`). Portal submit form deferred. | Review EC API for student-facing variant; implement portal submission. |

### 6.5 Accessibility gaps (admin)

| ID | Gap | Phase 11 action |
|---|---|---|
| R-A11Y-001 | Admin nav is a flat horizontal `<nav>` with no responsive breakpoints. At 375×667 (mobile), links overflow. | Add hamburger/overflow menu for mobile admin (lower priority — admin is a desktop-first tool). |
| R-A11Y-002 | Dialog/modal focus trap not implemented for custom inline confirm patterns. Focus does not return to trigger element after confirm/cancel. | Migrate confirm patterns to a shared accessible `<Dialog>` primitive using Radix UI. |

### 6.6 Performance

| ID | Gap | Phase 11 action |
|---|---|---|
| R-PERF-001 | Lighthouse CI (LCP/FCP/TTI) not yet wired. Bundle-size check is CI-enforced but runtime performance is unverified. | Add `@lhci/cli` to CI workflow; verify LCP ≤2.5s, FCP ≤1.5s, TTI ≤3.5s on key pages. |
| R-PERF-002 | `EnrolmentReportPage` performs N+1 student→enrolment fetches client-side. | Resolve via aggregate API endpoint (R-API-001). |

---

## 7. User Guides

### 7.1 Student portal

The student portal (`apps/portal`, default `http://localhost:5174`) provides:

- **Sign in**: PKCE OIDC via Keycloak. Dev mode (`VITE_DEV_AUTH=true`) supports direct JWT paste for local development.
- **Dashboard**: Summary of current enrolment status, quick links to key sections.
- **Profile**: View and edit identity/contact details; add addresses; declare disability status.
- **Enrolments**: View current and historical enrolments with bitemporal status history.
- **Modules**: View registered modules; add new module registrations; withdraw from modules with confirmation.
- **Results**: View published (locked) module results.
- **Timetable**: View module registration timetable entries.
- **Exams**: View exam timetable entries.
- **Adjustments**: View approved adjustments (reasonable adjustments, time allowances).
- **Exceptional Circumstances**: View submitted EC claims and their outcomes.
- **Notifications**: Scaffold — live delivery deferred to Phase 11.

### 7.2 Staff / admin interface

The admin interface (`apps/admin`, default `http://localhost:5173`) provides:

**Student management**
- **Students** (`/students`): Search and filter students by name, student number, or status. Click through to the 5-tab student detail page (Identity, Enrolments, Registrations, History, Corrections).
- **Tasks** (`/tasks`): Workflow task inbox. Filter by status, complete tasks inline.

**Assessment**
- **Exam boards** (`/exam-boards`): List and filter boards. Board detail: generate data packs, view entries, access candidate profiles (role-gated for special-category data), ratify with sign-off.

**Regulatory**
- **Regulatory** (`/regulatory`): Hub for all statutory returns. HESA (create/validate/download/submit), UCAS confirmations, SLC confirmations, UKVI CAS/compliance, OfS B3/participation.

**Administration** (requires `tenant-administrator | registry-administrator | system-administrator`)
- **Tenant admin** (`/tenant-admin`): Hub for 8 administration areas.
- **Configuration** (`/tenant-admin/config`): Institution settings (UKPRN, HESA ID, UCAS code, etc.).
- **Value sets** (`/tenant-admin/value-sets`): Manage controlled vocabularies and members.
- **Globalisation** (`/tenant-admin/globalisation`): Locale, currency, and value-set label translation.
- **Academic rules** (`/tenant-admin/rules`): Create and manage progression/classification/assessment rules.
- **Workflow definitions** (`/tenant-admin/workflows`): Manage workflow definition versions and assignment rules.
- **Feature flags** (`/tenant-admin/flags`): Manage flags, assignments, governance, impact, and retire flags (system-administrator only).
- **Integrations** (`/tenant-admin/integrations`): Enable/disable connectors, trigger health checks, replay exchanges, view exchange history.
- **Audit** (`/tenant-admin/audit`): Integration exchange audit proxy. Full entity audit deferred to Phase 11.

**Reporting**
- **Reporting** (`/reporting`): Hub. Enrolment volumes (sampled, aggregate API in Phase 11), Regulatory submission status, FOI/SAR request register.

**Operations**
- **Operations** (`/operations`): Hub. Environment runtime (release version, migration version, workflow defs, feature flags), Environment promotions, Integration connector health, Failed exchange log.

---

## 8. Exit Criteria Assessment

| Criterion | Status |
|---|---|
| Student portal is operational and WCAG 2.1 AA automated scan clean | ✅ 14 routes scan clean in CI |
| Staff administrative interface is operational | ✅ All staff journeys delivered |
| System administration interface is operational | ✅ 9 tenant-admin pages |
| Golden-path user journeys pass in automated E2E | ✅ GP-A01–A09, GP-P01–P08 |
| No regressions against Phase 4–9 API, integration, and contract tests | ✅ 204 backend tests passing |
| Frontend TypeScript clean | ✅ Zero errors |

Phase 10 is **complete**. Phase 11 should address the items in §6 above, prioritising the notification centre (R-NOTIFY-001), the accessibility dialog focus trap (R-A11Y-002), and the aggregate reporting API (R-API-001).
