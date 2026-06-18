# Phase 11 — Stage 5: Residuals Closure — Acceptance Review

**Date:** 2026-06-18  
**Author:** Steve J White  
**Status:** ALL TRACKS COMPLETE ✓

---

## Summary

Stage 5 closed all residual feature gaps from Phases 10 and 10.5 across four parallel tracks:

| Track | Scope | Gate-blocking? | Status |
|-------|-------|---------------|--------|
| A | Notification Centre (R-NOTIFY-001) | Yes | ✓ Complete |
| B | VLE Operational Residuals (R-VLE-001–003) | No | ✓ Complete |
| C | i18n, EC Submission, Locale Fixes | No | ✓ Complete |
| D | Demo Validator Extensions (RR-001, RR-009) | No | ✓ Complete |

---

## Track A — Notification Centre (R-NOTIFY-001)

**Gate-blocking.** Students must be able to receive real-time notifications from system events.

### Deliverables

- **DB migration** `0026_phase11_notifications.sql` — `notification` table with partial index on unread rows.
- **`NotificationService`** (`apps/api/src/platform/notifications/notification-service.ts`) — persists rows, fans out to open SSE connections via an in-process connection map.
- **API routes** (`apps/api/src/routes/notifications.ts`):
  - `GET /api/v1/notifications/stream` — SSE transport; heartbeat every 25 s; long-lived connection managed by raw `res` write.
  - `GET /api/v1/notifications` — paginated list with `limit` / `unreadOnly` query params.
  - `PATCH /api/v1/notifications/:id/read` — marks a notification read; returns 404 if not found or not owned.
- **Portal `NotificationsPage`** — uses `fetch()` + `ReadableStream` (not `EventSource`) to carry the `Authorization: Bearer` header to the SSE endpoint; renders unread/read items with indigo/white colouring; per-item mark-read button; unread count badge in header.
- **Permission** `notifications:read` added to `student` role in `packages/domain/src/permissions.ts`.

### SSE authentication note

`EventSource` cannot set custom headers; the JWT plugin accepts only `Authorization: Bearer …`. The portal therefore uses a manual `fetch` + `ReadableStream` SSE parser — this is the correct and permanent approach for authenticated SSE in this stack.

---

## Track B — VLE Operational Residuals

### R-VLE-001 — Grade sync conflict panel (`ExamBoardDetailPage`)

`VleGradeSyncPanel` auto-detects any VLE integration registration and exposes a "Check grade sync" button that calls `healthCheckIntegration()`. The panel surfaces `unsubmittedMarks` and `markConflicts` counts from the health-check details object.

### R-VLE-002 — Manual enrolment override audit trail (`StudentDetailPage`)

`VleOverrideAuditSection` queries the audit log for the selected enrolment and filters for VLE-sourced entries (`actorType === 'integration-service'` or `changes.sourceSystem === 'vle'`). The section is hidden when there are no VLE audit events, so it is non-intrusive for non-VLE tenants.

### R-VLE-003 — Bulk reconciliation trigger (`IntegrationOpsPage`)

`VleReconcilePanel` replaced the placeholder amber notice. The "Trigger 24 h replay" button fires `replayIntegration()` for each VLE registration with a 24-hour window. Per-registration replay job IDs are displayed in-panel.

---

## Track C — i18n, EC Submission, Locale Fixes

### R-I18N-001 — Welsh (cy) locale

`packages/ui/src/i18n/locales/cy.json` provides full Welsh translations for all `en-GB.json` keys including all portal namespaces (`nav`, `enrolment`, `exam`, `profile`, `address`, `disability`, `modules`, `results`, `notifications`, `circumstances`), admin namespaces, shared `actions`, `status`, `validation`, `auth`, and `errors`.

Per Stage 0 decision: LTR only; RTL is out of scope.

### R-I18N-002 — Value-set label interpolation helper

`resolveValueSetLabel(code)` exported from `packages/ui/src/i18n/index.ts`. Lookup order: `portal.enrolment.status.<code>` → `admin.valueSet.<code>` → humanised code (hyphens → spaces, title-case). Components that display value-set codes (e.g. `Badge`) should use this to show locale-appropriate labels.

### R-API-003 — Student-facing EC submission endpoint

`POST /api/v1/exceptional-circumstances/submissions` added to `apps/api/src/routes/circumstances.ts`. Requires `circumstances:submit` permission (student role). Sets `outcomeCode='pending'`, `determinationDate=today`, `notes=description`. The portal `CircumstancesPage` exposes a submission form toggled by a "Submit claim" button, with a 4 000-character textarea and success/error feedback.

**Permission** `circumstances:submit` added to `student` role.

---

## Track D — Demo Validator Extensions

### RR-001 — Story-marker DB validation (`checkStoryMarkersExist`)

For each story marker in a scenario manifest, validates that the deterministic person `personId(tenantId, i+1)` exists in the `persons` table. Uses `inArray` for a single round-trip. Injected into `validateScenario` for any scenario that declares `storyMarkers`.

### RR-009 — Domain-specific scenario validators

Five per-scenario checks added to `SCENARIO_CHECKS`:

| Scenario | Check | Assertion |
|----------|-------|-----------|
| `enrolment-induction` | `checkS2EnrolmentArcs` | Alice=enrolled, Bob=intermitting, Carol=graduated |
| `module-selection` | `checkS3ModuleRegistrations` | Alice (seq 1) has ≥1 module registration |
| `assessment-marks` | `checkS4EcAndAdjustmentPresent` | EC record count > 0 |
| `exam-board` | `checkS5ProgressionAndAward` | Locked progression decisions exist |
| `applicant-pipeline` | (UCAS check) | UCAS applications exist |
| `institution-year` | (awards count) | Awards table non-empty |

The `enrolments.id` (bitemporal logical ID) is used throughout — not `enrolmentId`, which is not a column on the `enrolments` table.

---

## Test Matrix

| Suite | Result |
|-------|--------|
| `@revelation-srs/api` unit tests | 28/28 ✓ |
| TypeScript (`tsc --noEmit`) — api | Clean ✓ |
| TypeScript (`tsc --noEmit`) — portal | Clean ✓ |
| TypeScript (`tsc --noEmit`) — admin | Clean ✓ |
| TypeScript (`tsc --noEmit`) — demo-data | Clean ✓ |
| OpenAPI spec regenerated | ✓ (`/api/v1/notifications`, `/api/v1/notifications/stream`, `/api/v1/notifications/{id}/read`, `/api/v1/exceptional-circumstances/submissions`) |

---

## Acceptance Criteria Checklist

- [x] R-NOTIFY-001: SSE notification stream authenticated via Bearer header (fetch + ReadableStream)
- [x] R-NOTIFY-001: Notifications persisted to DB with `read_at` column; partial index on unread rows
- [x] R-NOTIFY-001: Portal page shows unread count badge; per-item mark-read; real-time push via SSE
- [x] R-VLE-001: Grade sync conflict panel on exam board page
- [x] R-VLE-002: VLE override audit trail on student corrections tab
- [x] R-VLE-003: Bulk 24 h reconciliation trigger on integration ops page
- [x] R-I18N-001: Welsh (cy) locale file with full translation coverage
- [x] R-I18N-002: `resolveValueSetLabel` helper exported from `@revelation-srs/ui`
- [x] R-API-003: `POST /exceptional-circumstances/submissions` with student permission gate
- [x] R-API-003: Portal CircumstancesPage submission form with success/error feedback
- [x] RR-001: Story-marker person DB validation in demo validator
- [x] RR-009: S2–S5 domain-specific scenario validators in demo validator

---

## Outstanding Items

None. Stage 5 is fully complete. Stage 6 work is already in progress in parallel (per Stage 0 plan).
