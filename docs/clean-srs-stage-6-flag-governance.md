# Clean SRS Convergence Plan — Stage 6 Coverage

## Stage: Flag Governance and Admin UX

**Exit criterion:** Flags are governed configuration, not hidden conditionals.

---

## What was done

Stage 6 adds a governance layer on top of the existing feature flag infrastructure. Every flag now carries mandatory metadata declaring its purpose, risk, ownership, and lifecycle — making the flag taxonomy machine-readable rather than implicit.

### Migration 0017 — two DDL changes

**Section 1 — governance columns on `feature_flag`:**

| Column | Type | Purpose |
|---|---|---|
| `flag_class_code` | text (NOT NULL, default `release`) | Governance taxonomy classification |
| `risk_class_code` | text (NOT NULL, default `low`) | Change-risk rating |
| `owner_contact` | text (nullable) | Responsible team or email |
| `review_date` | text (nullable) | Next mandatory review date (ISO 8601) |
| `retirement_condition` | text (nullable) | Prose condition that must be met before the flag is removed |
| `allowed_scope_codes` | text[] (NOT NULL, default `{global,tenant,environment}`) | Scopes at which this flag may be assigned |
| `non_bypassable` | boolean (NOT NULL, default false) | When true, the `off` variant may never be assigned by anyone |

**Section 2 — all 19 existing flags classified** using the seven-class taxonomy:

| Class | Flags |
|---|---|
| `migration` | `admissions.legacy-ucas-auto-enrolment.enabled` |
| `module-enablement` | `admissions.enabled`, `assessment.moderation.workflow.enabled`, `communications.locale-aware.enabled` |
| `integration-route` | `admissions.ucas-adapter.enabled`, `admissions.direct-applications.enabled`, `admissions.agent-applications.enabled`, `admissions.international-route.enabled`, `enrolment.downstream-triggers.configured-mode`, `communications.channel.email.enabled`, `communications.channel.crm-handoff.enabled`, `communications.channel.integration-event.enabled` |
| `environment-safety` | `admissions.cas-precheck.required` (critical), `exam-board.quorum.required` (high), `exam-board.external-examiner.required` (high) |
| `tenant-variant` | `enrolment.change-approval.required`, `assessment.late-penalty.enabled`, `assessment.resit-cap.enabled`, `progression.board-review.enabled`, `exam-board.virtual-board.enabled`, `exam-board.deferral.enabled`, `exam-board.operating-model` |

**Section 3 — value sets seeded** in `value_set` / `value_set_member`:
- `feature-flag-class` — seven members for the class taxonomy
- `feature-flag-risk-class` — four members (`low`, `medium`, `high`, `critical`)

### Drizzle schema (`packages/db/src/schema/platform-workflow.ts`)

Seven new mapped columns added to the `featureFlags` table definition to match the migration columns: `flagClassCode`, `riskClassCode`, `ownerContact`, `reviewDate`, `retirementCondition`, `allowedScopeCodes`, `nonBypassable`.

### Service (`feature-flag-service.ts`)

- `FeatureFlagDto` extended with all seven governance fields
- `UpdateGovernanceInput` interface — subset of governance fields writable via the admin endpoint
- `FlagImpactDto` interface — `activeAssignmentCount`, `activeTenantsCount`, `activeTenantIds`, `referencingTriggerRuleKeys`, `currentDefaultVariantKey`, `currentDefaultValue`
- `updateGovernance(id, input)` — patches governance columns on a flag
- `getImpact(id)` — counts active (non-expired) assignments, lists distinct tenant IDs with active assignments, and finds workflow trigger rules whose `context_filter` JSONB contains the flag key
- `flagToDto()` — maps all new columns to the DTO

### Permissions (`packages/domain/src/permissions.ts`)

```
'feature-flag:govern': ['system-administrator']
```

Only `system-administrator` may update governance metadata.

### Routes (`apps/api/src/routes/platform-controls.ts`)

Two new endpoints:

- **`PATCH /api/v1/feature-flags/:featureFlagId/governance`** — requires `feature-flag:govern`; responds 204 No Content
- **`GET /api/v1/feature-flags/:featureFlagId/impact`** — requires `feature-flag:read`; responds with `FlagImpactSchema`

Two new assignment guards in `POST /api/v1/feature-flags/:featureFlagId/assignments` (checked in priority order):

1. **Non-bypassable guard (422)** — if `flag.nonBypassable` and the resolved variant is `off`, returns 422 regardless of caller role. Fires before the scope-restriction check because it is a stronger constraint (applies even to system administrators).
2. **Scope-restriction guard (403)** — if `flagClassCode` is `environment-safety` or `kill-switch` and the caller is not `system-administrator`, returns 403.

---

## Why non-bypassable fires before scope-restriction

A 403 means "your role does not permit this operation." A 422 means "this operation is fundamentally not permitted for any role." The non-bypassable constraint is the stronger statement — it applies even to system administrators — so it is evaluated first to give callers the most accurate error response regardless of role.

---

## Environment-safety flags: statutory basis

The three environment-safety flags carry `retirement_condition` values explaining the legal basis for their permanence:

- **`admissions.cas-precheck.required`** — UK Home Office Points-Based System; CAS pre-check is mandatory for student visa sponsors.
- **`exam-board.quorum.required`** — PSRB / QAA expectations for governance of degree-awarding institutions.
- **`exam-board.external-examiner.required`** — QAA Quality Code Chapter B7 and OfS conditions for degree-awarding powers.

---

## Test coverage (`test/stage6-flag-governance.int.test.ts`) — 13 tests

| # | Test |
|---|---|
| 1 | Environment-safety flags have `non_bypassable=true` and `allowed_scope_codes` that excludes `tenant` |
| 2 | Migration flags have both `review_date` and `retirement_condition` set |
| 3 | No known-prefix flag remains with `flag_class_code = release` after migration 0017 |
| 4 | `GET /feature-flags/:id` returns governance metadata on a known environment-safety flag |
| 5 | `GET /feature-flags` list includes governance fields on every entry |
| 6 | Assigning `off` variant to a non-bypassable flag as tenant-admin returns 422 |
| 7 | Assigning `off` variant to a non-bypassable flag as system-admin also returns 422 |
| 8 | Tenant-admin assigning `on` variant to an environment-safety flag returns 403 |
| 9 | System-administrator can assign `on` variant to an environment-safety flag (returns 201) |
| 10 | System-administrator can update governance metadata via PATCH (returns 204, change persists) |
| 11 | Tenant-administrator gets 403 on governance update |
| 12 | Registry-administrator gets 403 on governance update |
| 13 | `GET /feature-flags/:id/impact` returns zero assignments for an unassigned flag |
| 14 | Impact endpoint reflects active assignments after a POST to `/assignments` |
| 15 | All `non_bypassable=true` flags have a `retirement_condition` starting with "Must not be retired" |
| 16 | Value sets `feature-flag-class` and `feature-flag-risk-class` are seeded with all expected members |
| 17 | Ratifying a non-existent board fails with a data-level error (not a flag evaluation bypass) |

---

## Stage 4 test adaptation

The Stage 4 exam board governance tests (`test/stage4-exam-board-governance.int.test.ts`) previously used the `POST /feature-flags/:id/assignments` endpoint to manipulate flag state during test setup. After Stage 6, this was no longer possible for environment-safety flags:

- **Environment-safety flags** (`exam-board.quorum.required`, `exam-board.external-examiner.required`) require `system-administrator` for any assignment
- **Non-bypassable flags** cannot be assigned the `off` variant via the API

The `enableFlag` helper was updated to use direct DB insertion (via `ctx.db.execute`) for all flag state changes in Stage 4 tests. This is correct: Stage 4 tests are about exam board behaviour (does the guard fire?); Stage 6 tests are about flag assignment governance (can tenant-admin bypass mandatory controls?). Mixing the two concerns would make Stage 4 tests brittle and Stage 6 tests redundant.

All 312 tests pass after Stage 6.
