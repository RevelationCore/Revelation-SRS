# Stage 1 — Permission Audit Results

## Persona → Role mapping (demo data)

| Username | Roles |
|---|---|
| `registry` | `registry-administrator` |
| `examiner` | `external-examiner` |
| `wellbeing` | `wellbeing-advisor` |
| `dpo` | `dpo`, `wellbeing-auditor` |
| `chair` | `exam-board-chair`, `registry-administrator` |
| `ops` | `registry-administrator`, `tenant-administrator` |

## API permission gaps — all stories

No API permission gaps found. All roles hold the required `PERMISSION_ROLES` entries for
every remaining story's API calls.

### Evidence by story block

| Story | Persona | API permissions needed | Gap? |
|---|---|---|---|
| AR-01/03/05 | registry | `student:read:all`, `module-registration:read:all`, `notifications:read`, `communications:read` | None |
| WB-01/02/03 | wellbeing | `student:read:all`, `enrolment:read:all`, `adjustment:read:all`, `disability:read`, `circumstances:read`, `special-category:read` | None |
| EB-01/02/03/04 | chair | `exam-board:read`, `exam-board:ratify`, `mark:read:all`, `enrolment:read:all` | None |
| TI-01 | registry | `workflow-task:complete`, `workflow:read` | None |
| RE-06 | dpo | `regulatory:read`, `regulatory:write` | None (added prev session) |
| RE-07 | dpo | `regulatory:read`, `regulatory:write` | None (added prev session) |
| RP-01 | registry | `enrolment:read:all` | None |
| RP-02 | ops | `enrolment:read:all` | None |
| OP-01 through OP-09 | ops | `config:read/write`, `rule:read/write`, `workflow:read/write`, `feature-flag:read/write`, `globalisation:read/write`, `integration:read`, `integration:manage`, `environment:read/write` | None |
| AU-01 | dpo | `audit-log:read` | None (dpo in map) |

## UI route-guard gap — fixed

| Route | Old guard | Problem | Fix |
|---|---|---|---|
| `/tenant-admin/audit` | `RequireRole roles={TENANT_ADMIN_ROLES}` | `dpo` doesn't hold `tenant-administrator`, `registry-administrator`, or `system-administrator` → redirected to `/403` | Removed `RequireRole` wrapper; API `requirePermission('audit-log:read')` handles authorization |

**File changed:** `apps/admin/src/App.tsx`

## Notes

- `feature-flag:govern` (`system-administrator` only) is not called by the `FeatureFlagsPage` UI; OP-02 is unaffected.
- `circumstances:write` is `registry-administrator` only. WB-03 uses `circumstances:read` (available to `wellbeing-advisor`). If the story requires status updates, revisit.
