# UAT Round 1 — Proactive Fix Plan

This plan applies the learnings from UAT Round 1 (stories P-01 through RE-05) to
proactively fix the same classes of bug elsewhere in the codebase, before they are
discovered during the remaining test stories.

The issue taxonomy that informed this plan is in [`issue-taxonomy.md`](./issue-taxonomy.md).
The assisted automation approach for the remaining stories is in
[`remaining-uat-automation.md`](./remaining-uat-automation.md).

---

## Stage 1 — Permission map completeness

**Category:** Missing RBAC permission assignments  
**Risk if deferred:** Every remaining admin story will encounter a 403 on first run  
**Effort:** Low — single file, purely additive  

### Method

1. Extract all `requirePermission(...)` calls across all route files to build a complete
   `permission → routes` map.
2. For each remaining UAT story, identify the test persona and every API route its UI calls.
3. Verify the persona's role appears in `PERMISSION_ROLES[permission]` for every route.
4. Add missing assignments in a single PR.

```bash
# Find every permission guard in the API
grep -rn "requirePermission(" apps/api/src/routes/ --include="*.ts" | sort
```

### Known gaps to fix immediately

| Role | Missing permission | Blocking story |
|---|---|---|
| `dpo` | `audit-log:read` | AU-01 |
| `dpo` | `regulatory:read` (UKVI, FOI endpoints) | RE-06, RE-07 |
| `wellbeing-advisor` | All `wellbeing:*` read/write permissions | WB-01, WB-02, WB-03 |
| `exam-board-chair` | `exam-board:read`, `mark:read:all`, `enrolment:read:all` | EB-01 through EB-04 |
| `registry-administrator` | `audit-log:read` | AU-01, RE-07 |
| `ops` | `feature-flag:*`, `value-set:*`, `integration:*`, `workflow:*` | OP-01 through OP-09 |

### Acceptance

No 403 errors when each remaining story's test persona loads the pages that story
exercises. Run all remaining story personas against the permission map before the
next UAT session begins.

---

## Stage 2 — Identity field audit (`sub` vs `srsPersonId`)

**Category:** Wrong identity field used in student-facing routes  
**Risk if deferred:** Silent wrong-data bugs — routes return data for the wrong person  
**Effort:** Low — grep and replace  

### Method

```bash
grep -rn "request\.user\.sub" apps/api/src/routes/ --include="*.ts"
```

For each match, determine the usage:

- **Audit logging** (`actorId`, `actorDisplayName` context) — `sub` is **correct**, leave it.
- **Data lookup** (passed to a service as a person/enrolment identifier) — `sub` is
  **wrong**; replace with `request.user.srsPersonId`.

The correct pattern for routes that need both:

```typescript
const actorId    = request.user.sub;           // Keycloak UUID — for audit only
const personId   = request.user.srsPersonId;   // SRS UUID — for all data queries
```

### Files to prioritise

- `apps/api/src/routes/students.ts`
- `apps/api/src/routes/module-registrations.ts`
- `apps/api/src/routes/exam-boards.ts`
- `apps/api/src/routes/notifications.ts` (admin endpoint)
- `apps/api/src/routes/value-sets.ts`

### Acceptance

`grep -rn "request\.user\.sub" apps/api/src/routes/` returns only occurrences inside
audit record blocks (`actorId:`, `actorDisplayName:`).

---

## Stage 3 — Bitemporal query completeness

**Category:** Missing `recordedUntil IS NULL` filter in service queries  
**Risk if deferred:** Duplicate rows after any state change; history leaks into current views  
**Effort:** Medium — requires reading every service method in `apps/api/src/platform/`  

### Method

1. Identify all bitemporal tables (any table with `recordedAt` + `recordedUntil` columns):

```bash
grep -rn "recordedUntil\|recorded_until" packages/db/src/schema/ --include="*.ts" -l
```

2. For each service file under `apps/api/src/platform/`, find every `.select().from(table)`
   call against a bitemporal table.
3. Confirm that queries intended to return **current** state include
   `isNull(table.recordedUntil)` in the `where` clause.
4. Confirm that queries against tables with a valid-time dimension also include
   `isNull(table.validTo)` where appropriate.

History/audit queries (intentionally returning all versions) are exempt — annotate
them with a comment: `// intentional: returns all bitemporal versions`.

### Tables to audit

| Table | Service file |
|---|---|
| `post_ratification_case` | `governance/correction-service.ts` ✓ fixed |
| `post_ratification_amendment` | `governance/correction-service.ts` |
| `enrolment` | `enrolment/service.ts` |
| `module_registration` | `registration/service.ts` |
| `module_result` | `assessment/*.ts` |
| `mark` | `assessment/*.ts` |
| `person_identity` | `students/service.ts` |
| `student_address` | `students/service.ts` |
| `reasonable_adjustment` | `wellbeing/*.ts` |
| `disability_declaration` | `students/service.ts` |
| `exam_entry` | `assessment/exam-entry-service.ts` |
| `fee_liability` | `registration/service.ts` |
| `progression_decision` | `governance/*.ts` |

### Acceptance

Every current-state query against a bitemporal table has `isNull(table.recordedUntil)`
in its `where` clause. Updating a correction case status no longer produces duplicate
cards in the list view.

---

## Stage 4 — Value-set label resolution and select state initialisation

**Categories:** Value-set / status code misalignment; React state not initialised to first option  
**Risk if deferred:** Raw internal codes displayed to users; form submissions silently send empty strings  
**Effort:** Medium — many small fixes across UI files  

### 4a — Raw code display

Any JSX that renders a `*Code`, `*StatusCode`, or `*TypeCode` field directly as text
is leaking internal codes to users. All such fields must be resolved to a `displayLabel`
via `useValueSet`.

```bash
# Find raw code rendering in portal and admin pages
grep -rn "\.\(status\|type\|mode\|scope\|nationality\|gender\)Code[^:=]" \
  apps/admin/src/pages/ apps/portal/src/pages/ --include="*.tsx"
```

For each hit, check whether the value passes through a `useValueSet` label lookup before
display. If not, add the hook and map `code → displayLabel`:

```typescript
const { members } = useValueSet('entity_name', 'field_code');
const label = members.find(m => m.code === row.fieldCode)?.displayLabel ?? row.fieldCode;
```

### 4b — Select state initialisation

Any `useState<string>('')` that backs a `<select>` populated asynchronously from a
value-set API call is vulnerable to submitting an empty string if the user does not
interact with the dropdown before submitting.

```bash
grep -rn "useState<string>('')" \
  apps/admin/src/pages/ apps/portal/src/pages/ --include="*.tsx"
```

For each hit paired with a `<select>` whose options come from `useValueSet`, ensure
there is a sync effect:

```typescript
useEffect(() => {
  if (stateValue === '' && members.length > 0) {
    setStateValue(members[0]!.code);
  }
}, [members, stateValue]);
```

### Acceptance

No raw `*Code` strings rendered anywhere in admin or portal UI.  
Creating a new record via any value-set-backed form never sends an empty string for
a required code field, regardless of whether the user touches the dropdown.

---

## Stage 5 — Demo data completeness and reset ordering

**Categories:** Demo data FK/deletion ordering; Demo data gaps across scenarios  
**Risk if deferred:** Reset failures mid-UAT; empty pages for data that should exist in a scenario  
**Effort:** Medium — data work across multiple scenario files  

### 5a — Reset FK ordering

Audit the full deletion sequence in `packages/demo-data/src/reset.ts` against the
actual FK dependency graph. Every table without a direct `tenant_id` column must be
deleted via a correlated subquery through its parent, and must appear **before** that
parent in the deletion order.

```bash
# Find tables without tenant_id in the schema
grep -rn "pgTable\|pgSchema" packages/db/src/schema/ --include="*.ts" -A 10 \
  | grep -v "tenant_id"
```

Known remaining gaps to verify and fix:

| Child table | Parent | Current order correct? |
|---|---|---|
| `hesa_submission` | `integration_exchange` | ✓ fixed in `c0f309e` |
| `slc_notification` | `integration_exchange` | Verify |
| `ofs_extract` | `integration_exchange` | Verify |
| `hesa_validation_issue` | `hesa_validation_report` | Verify present in wipe |
| `hesa_identifier_assignment` | `hesa_student_return` | Verify present in wipe |

### 5b — Scenario coverage matrix

For every table with regulatory or feature-specific data, confirm each scenario
(`S2`–`S6`) that exercises that feature has representative rows.

| Table | S2 | S3 | S4 | S5 | S6 |
|---|---|---|---|---|---|
| `notification` | — | — | ✓ | — | — |
| `ucas_application` | — | — | — | — | ✓ fixed |
| `hesa_student_return` | — | — | — | — | ✓ |
| `hesa_student_return_record` | — | — | — | — | ✓ fixed |
| `ofs_extract` | — | — | — | — | runtime only |
| `slc_notification` | — | — | — | — | runtime only |
| `ukvi_visa_status` | — | — | — | — | Verify |
| `ukvi_cas_request` | — | — | — | — | Verify |
| `ukvi_compliance_alert` | — | — | — | — | Verify |
| `post_ratification_case` | — | — | — | ✓ | ✓ |

Cells marked "Verify" require checking whether the relevant UAT story (RE-06 for UKVI,
AU-01 for audit log) needs pre-seeded rows or can generate them at runtime.

### Acceptance

`pnpm demo:reset <any-slug>` completes without FK constraint violations for all
six scenario slugs.  
Every page in every remaining UAT story loads with representative data immediately
after a scenario reset, without requiring the tester to first trigger a runtime
generation action.

---

## Stage 6 — Remaining UAT story readiness audit

**Category:** Missing UI tabs / features not wired to API  
**Risk if deferred:** Bugs found live during UAT rather than proactively  
**Effort:** High — depends on stages 1–5 being complete  

For each remaining story block, complete a pre-flight check before the UAT session:

1. **Permissions** — confirm all roles for this story block are in the permission map (Stage 1)
2. **Demo data** — confirm the required scenario has data for every page the story visits (Stage 5)
3. **UI surface** — confirm every API endpoint the story's UI calls exists and returns the correct shape
4. **Label resolution** — confirm all code fields are resolved to display labels (Stage 4)

### Story blocks and known pre-flight gaps

| Story block | Scenario | Persona | Pre-flight notes |
|---|---|---|---|
| AR-01, AR-03, AR-05 | S4 | registry | Student search not wired to API (placeholder); module registrations tab in student detail needs audit |
| WB-01, WB-02, WB-03 | S4 | wellbeing | Wellbeing-advisor permissions unaudited; confirm wellbeing pages exist and are routed |
| EB-01, EB-02, EB-03, EB-04 | S5 | chair | Exam-board-chair permissions unaudited; confirm candidate profile and data pack pages load |
| TI-01 | S4 | registry | Task inbox — confirm tasks are seeded in S4; confirm task completion routes exist |
| RE-05 | S6 | registry | ✓ complete — UCAS applications seeded |
| RE-06 | S6 | dpo | UKVI data gaps in S6; confirm visa status / CAS request data seeded |
| RE-07 | S4 | dpo | FOI/SAR page — confirm dpo has audit-log:read; confirm FOI route returns data |
| RP-01, RP-02 | S6 | registry/ops | Enrolment report — confirm reporting page loads and data is non-zero |
| OP-01 through OP-09 | S2 | ops | Ops-role permissions unaudited across all 9 operation pages |
| AU-01 | S4 | dpo | dpo missing audit-log:read (Stage 1 fix); confirm audit log page renders entries |
| X-01, X-02, X-03 | various | any | Demo banner, nav structure, accessibility — lower risk |

### Acceptance

Each story block passes its pre-flight check before the UAT session begins. Zero
403 errors on first page load for any remaining story.

---

## Execution order

| Stage | Dependency | Suggested order |
|---|---|---|
| 1 — Permissions | None | First — blocks everything else |
| 2 — Identity field | None | First — parallel with Stage 1 |
| 3 — Bitemporal filters | None | Second — data correctness risk |
| 4 — Value-set labels + state | None | Second — parallel with Stage 3 |
| 5 — Demo data | None | Third — needed before remaining UAT |
| 6 — Story readiness | Stages 1–5 | Last — validates the above |

Stages 1 and 2 are the highest-leverage: completing them before any further UAT
testing eliminates the most common class of blocker (403s and silent empty-data bugs)
across all remaining stories.
