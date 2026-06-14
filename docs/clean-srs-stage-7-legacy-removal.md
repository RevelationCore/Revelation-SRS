# Clean SRS Convergence Plan — Stage 7 Coverage

## Stage: Legacy Removal and Schema Simplification

**Exit criterion:** The codebase has one internal implementation path per capability. Legacy behaviour survives only where exposed through an intentionally versioned public contract.

---

## What was removed

### 1. Dead service file — `AdmissionsWorkflowHandoffService`

**File deleted:** `apps/api/src/platform/admissions/handoff-service.ts`

This 112-line file contained `AdmissionsWorkflowHandoffService`, a UCAS-only admissions handoff that was superseded by the source-neutral `AdmissionsService` (in `admissions-service.ts`). It was never instantiated, never imported in app wiring, and had no tests. The comment in `admissions-service.ts` referencing the removed class was updated to describe only the current design.

**Before:** Two service classes targeting the same capability — `AdmissionsService` (active) and `AdmissionsWorkflowHandoffService` (dead code).

**After:** Single implementation — `AdmissionsService.startHandoff()` handles all five admission routes: UCAS domestic, direct domestic, international direct, international agent, clearing.

---

### 2. Retired flag constant — `LEGACY_UCAS_AUTO_ENROLMENT_FLAG_KEY`

**Removed from:** `apps/api/src/platform/regulatory/ucas-service.ts` (line 27)

The exported constant `LEGACY_UCAS_AUTO_ENROLMENT_FLAG_KEY = 'admissions.legacy-ucas-auto-enrolment.enabled'` existed to name a migration-class feature flag that allowed the old UCAS-to-enrolment auto-creation path to be selectively disabled. The flag itself (in the `feature_flag` table) was already set to `status='retired'` in migration 0009 and classified as `flag_class_code='migration'` in migration 0017.

No code path evaluates this flag at runtime. Removing the constant makes that explicit: no runtime branch in the codebase reads this flag key.

The DB record for this flag is retained with `status='retired'` for audit trail purposes. The governance metadata (`retirement_condition`) explains why it was retired.

**Test update:** `test/ucas-admissions-handoff.test.ts` — removed the test case that asserted the constant's string value. Replaced with a comment explaining why the constant was removed and what invariant now holds. The two substantive tests (`shouldStartUcasAdmissionsWorkflow` logic) are unchanged.

---

### 3. Legacy schema column — `fee_liability.amount_pence`

**Migration:** `packages/db/migrations/0018_stage7_legacy_removal.sql`

```sql
ALTER TABLE "fee_liability" DROP COLUMN IF EXISTS "amount_pence";
```

**History of this column:**
- `0000_initial_platform_schema.sql` — created `fee_liability` with `amount_pence integer` (GBP-implicit pence value)
- `0012_globalisation_foundation.sql` — added `amount_minor_units bigint` and `currency_code text DEFAULT 'GBP'` as currency-aware replacements; `amount_pence` explicitly marked for Stage 7 removal in both the migration comment and the Drizzle schema comment
- `enrolment/service.ts` — set `amountPence: null` on every new fee liability insert since migration 0012, meaning the column has been null on all new records for the entire lifecycle of this codebase

**Files updated to remove references:**

| File | Change |
|---|---|
| `packages/db/src/schema/enrolment.ts` | Removed `amountPence: integer('amount_pence')` field and its legacy comment; removed `integer` from import |
| `apps/api/src/platform/enrolment/service.ts` | Removed `amountPence: number | null` from `FeeLiabilityDto`; removed `amountPence: null` from INSERT; removed `amountPence: row.amountPence` from SELECT mapper |
| `apps/api/src/platform/regulatory/slc-service.ts` | Changed `feeRows[0]?.amountPence` → `feeRows[0]?.amountMinorUnits`; changed `fee?.amountPence` → `fee?.amountMinorUnits`; updated `formatFeeAmount` signature from `(number | null)` → `(bigint | null)` |
| `apps/api/src/routes/enrolments.ts` | Removed `amountPence: Type.Union([Type.Number(), Type.Null()])` from `FeeLiabilitySchema` |
| `apps/api/test/globalisation.int.test.ts` | Updated test to not SELECT `amount_pence`; simplified assertion to only check `currency_code = 'GBP'` |

---

## Single implementation paths confirmed

After Stage 7, each capability has exactly one internal implementation path:

| Capability | Single path |
|---|---|
| Admissions handoff | `AdmissionsService.startHandoff()` — source-neutral, multi-route |
| UCAS workflow trigger | `UcasService.#admissionsUcasWorkflowEnabled()` evaluates two flags only: `admissions.enabled` and `admissions.ucas-adapter.enabled` |
| Fee monetary representation | `amount_minor_units` (bigint) + `currency_code` (ISO 4217) |
| SLC fee formatting | `formatFeeAmount(amountMinorUnits: bigint | null)` |

---

## What was intentionally preserved

**`admissions.legacy-ucas-auto-enrolment.enabled` flag record** — retained in the `feature_flag` table with `status='retired'` and `flag_class_code='migration'`. This is the correct audit trail for a flag that was used during the migration from auto-enrolment to workflow-based handoff. The retirement condition documents why it was retired.

---

## Test coverage (`test/stage7-legacy-removal.int.test.ts`) — 8 tests

| # | Test |
|---|---|
| 1 | `fee_liability` table has no `amount_pence` column (information_schema check) |
| 2 | `fee_liability` table has `amount_minor_units` and `currency_code` columns |
| 3 | New enrolments produce a fee liability with `currency_code = 'GBP'` |
| 4 | `GET /enrolments/:id/fee-liabilities` response does not include `amountPence` |
| 5 | `admissions.legacy-ucas-auto-enrolment.enabled` exists with `status='retired'` and `flag_class_code='migration'` |
| 6 | Retired flag has no active assignments in any tenant |
| 7 | `shouldStartUcasAdmissionsWorkflow` depends only on two flags (admissions.enabled, ucas-adapter.enabled) — structural purity proof |
| 8 | Enrolment creation succeeds with no influence from the retired flag (end-to-end proof) |

---

## Total test counts after Stage 7

| Suite | Files | Tests |
|---|---|---|
| Unit tests | 7 | 28 |
| Integration tests | 34 | 320 |
| **Total** | **41** | **348** |

(Stage 7 removed 1 unit test — the `LEGACY_UCAS_AUTO_ENROLMENT_FLAG_KEY` string assertion — and added 8 integration regression tests.)
