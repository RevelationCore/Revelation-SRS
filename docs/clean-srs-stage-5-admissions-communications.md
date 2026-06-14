# Stage 5 — Admissions and Communications Clean Cut

## Exit Criteria

| # | Criterion | Status |
|---|-----------|--------|
| 1 | UCAS is an adapter, not a process owner | ✅ Delivered |
| 2 | All admission routes enter Admissions through the same command surface | ✅ Delivered |
| 3 | Communication template selection is locale-aware and workflow/flag controlled | ✅ Delivered |
| 4 | Communication channel strategy is flag-controlled and fully auditable | ✅ Delivered |

---

## What changed

### Migration 0016

**Section 1 — Communication channel strategy flags**

Three new feature flags seeded globally (default `off`):

| Flag key | Purpose |
|----------|---------|
| `communications.channel.email.enabled` | Direct email dispatch |
| `communications.channel.crm-handoff.enabled` | Forward context to CRM endpoint |
| `communications.channel.integration-event.enabled` | Publish structured integration event |

All flags are `off` by default. Tenants opt-in. Suppressed dispatches are still recorded.

**Section 2 — `communication_template` table**

Stores locale-aware message templates. Key design choices:

- One row per `(template_key, channel_code, locale_code, tenant_id)`.
- `tenant_id IS NULL` = system-level default; tenant rows override.
- Uniqueness enforced by two partial indexes — one for system templates, one for tenant-specific — avoiding the `UNIQUE NULLS NOT DISTINCT` syntax which is incompatible with `ON CONFLICT` inference in this PostgreSQL version.
- `body_template` and `subject_template` support `{key}` placeholder substitution resolved at dispatch time.

**Section 3 — `communication_dispatch_log` table**

Append-only audit trail. Every dispatch attempt — whether dispatched, suppressed, or failed — writes a row. This is the evidentiary record for the "communications are auditable" criterion.

**Section 4 — Seed system templates (en-GB)**

Three system-level seed templates in `en-GB`:

| Template key | Channel | Purpose |
|-------------|---------|---------|
| `admissions.application-received` | `integration-event` | Application receipt notification |
| `enrolment.welcome` | `integration-event` | New student welcome event |
| `enrolment.welcome` | `email` | New student welcome email |

**Section 5 — Communication workflow trigger rules**

Deactivates the Stage 2 placeholder (`enrolment-created-future-communication`) and inserts two real trigger rules:

| Trigger key | Event type | Workflow |
|------------|-----------|---------|
| `admissions.handoff-started.application-received-comms` | `admissions.handoff-started` | `communication-dispatch` |
| `enrolment.created.welcome-comms` | `enrolment.created` | `communication-dispatch` |

---

### `AdmissionsService` (`src/platform/admissions/admissions-service.ts`)

Replaces the UCAS-only `AdmissionsWorkflowHandoffService` with a source-neutral service. All six admission routes map to a workflow definition:

| Source code | Workflow definition |
|------------|-------------------|
| `ucas` | `admissions-ucas-domestic` |
| `direct` | `admissions-direct-domestic` |
| `agent` | `admissions-international-agent` |
| `international-direct` | `admissions-international-direct` |
| `international-agent` | `admissions-international-agent` |
| `clearing` | `admissions-clearing` |

`startHandoff(tenantId, input, actorId)`:
1. Resolves the active workflow definition version for the source.
2. Creates a `workflow_instance` via `WorkflowBridgeService.startWorkflowInstance()`.
3. Records a G03 gateway decision (`confirmed-for-handoff`).
4. Assigns a `handoff-to-srs-enrolment` task to `registry-administrator`.

The old `AdmissionsWorkflowHandoffService` (`handoff-service.ts`) is retained but no longer wired into the application.

---

### `UcasService` — adapter role

`UcasService.ingestApplication()` now calls `AdmissionsService.startHandoff()` when:
- `statusCode === 'confirmed'`
- Application is not already linked to an enrolment
- Both `admissions.enabled` and `admissions.ucas-adapter.enabled` flags evaluate to `true`

The UCAS service is now clearly an adapter that feeds the admissions command surface, with no direct access to enrolment creation.

---

### `CommunicationService` (`src/platform/communications/communication-service.ts`)

Locale resolution order for `dispatch()`:

1. Tenant template, preferred locale
2. Tenant template, tenant fallback locale
3. System template, preferred locale
4. System template, tenant fallback locale
5. System template, `en-GB`

Channel flag gate: if the channel flag evaluates to `false`, the dispatch is suppressed — but a `communication_dispatch_log` row is still written with `status_code = 'suppressed'` and `suppression_reason` set.

Placeholder substitution: `{key}` tokens in `body_template` and `subject_template` are replaced with values from the `payload` object at dispatch time.

---

### Routes (`src/routes/communications.ts`)

| Method | Path | Permission |
|--------|------|-----------|
| `POST` | `/communication-templates` | `communications:write` |
| `GET` | `/communication-templates` | `communications:read` |
| `GET` | `/communication-templates/:templateId` | `communications:read` |
| `POST` | `/communications/dispatch` | `communications:write` |
| `GET` | `/communication-dispatch-log` | `communications:read` |

Both `communications:read` and `communications:write` are held by `registry-administrator` and `tenant-administrator`. Students receive 403.

---

## Test coverage (`test/stage5-admissions-communications.int.test.ts`)

| Test | What it proves |
|------|----------------|
| Three channel flags exist and default to `off` | Flag seeding in migration 0016 is correct |
| Communication trigger rules are active | Stage 2 placeholder deactivated; two real rules seeded |
| All 5 admission workflow definitions have a `handoff-to-srs-enrolment` step | Workflow shape is consistent across all routes |
| System templates are seeded with correct locale | Migration seed data lands correctly |
| Channel flag off → suppressed + audit log written | Suppression path records evidence |
| Channel flag on → dispatched + audit log written | Dispatch path works end-to-end |
| Locale fallback to `en-GB` when tenant locale missing | Locale resolution waterfall correct |
| Tenant template overrides system template for locale | Tenant-specific override respected |
| Template CRUD (create, list, get by ID) | Route and service layer correct |
| Permission guard: 403 for student role | RBAC enforced on communications routes |
| Dispatch log is queryable per tenant | Audit log scoped to tenant |
| Regression: UCAS confirmed application creates admissions workflow task | `UcasService` adapter handoff intact |

Total: **295 tests passing** across 32 files.

---

## What Stage 5 does NOT include

- Actual email transport (SMTP, SES, etc.) — the `email` channel flag is off by default; transport is a future integration concern.
- CRM integration endpoint implementation — the `crm-handoff` channel is scaffolded; endpoint configuration is tenant-specific future work.
- Direct, agent, international, and clearing admission route HTTP endpoints — these routes exist at the `AdmissionsService` level; HTTP entry points are Stage 6+ work aligned with each admission source team's timeline.
- Multi-language template authoring UI — templates are managed via the API; a UI is out of scope for this stage.
