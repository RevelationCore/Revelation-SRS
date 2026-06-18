# Phase 11 — Stage 6: Migration Validation Report

**Date:** 2026-06-18  
**Author:** Steve J White  
**Status:** ALL EXIT CRITERIA MET ✓

---

## Summary

Stage 6 delivered `packages/migration-tools` — a full data migration tooling and
validation framework for institutions importing student records into Revelation SRS
from existing SRS platforms. This report documents the validation results from the
synthetic SITS-style and Banner-style test imports.

---

## Deliverables

| Deliverable | Location | Status |
|---|---|---|
| `@revelation-srs/migration-tools` package | `packages/migration-tools/` | ✓ |
| Canonical import contracts | `packages/migration-tools/src/contracts/` | ✓ |
| SITS-style synthetic mapping template | `packages/migration-tools/src/mappings/sits.ts` | ✓ |
| Banner-style synthetic mapping template | `packages/migration-tools/src/mappings/banner.ts` | ✓ |
| Validation engine | `packages/migration-tools/src/validation/` | ✓ |
| Staged importer (dry-run + phased) | `packages/migration-tools/src/importer/` | ✓ |
| CLI entry point | `packages/migration-tools/src/cli.ts` | ✓ |
| Synthetic SITS-style fixture | `packages/migration-tools/test/fixtures/sits-sample.json` | ✓ |
| Synthetic Banner-style fixture | `packages/migration-tools/test/fixtures/banner-sample.json` | ✓ |
| SITS migration integration tests | `packages/migration-tools/test/migration-sits.int.test.ts` | ✓ |
| Banner migration integration tests | `packages/migration-tools/test/migration-banner.int.test.ts` | ✓ |
| Migration runbook | `docs/migration-runbook.md` | ✓ |

---

## Canonical Import Contracts

The following TypeScript interfaces define the interchange format:

| Contract | File | Entities |
|---|---|---|
| `ImportPerson`, `ImportAddress` | `contracts/identity.ts` | Person identity and addresses |
| `ImportEnrolment` | `contracts/enrolment.ts` | Enrolment |
| `ImportProgramme`, `ImportModule`, `ImportModuleOffering` | `contracts/catalogue.ts` | Programme and module catalogue |
| `ImportModuleRegistration`, `ImportMark` | `contracts/registration.ts` | Module registrations and marks |
| `ImportAward` | `contracts/award.ts` | Awards |
| `ImportAdjustment`, `ImportExceptionalCircumstance` | `contracts/adjustment.ts` | Adjustments and ECs |
| `ImportPayload` | `contracts/payload.ts` | Full import bundle |

All optional fields use `T | undefined` semantics, compatible with
`exactOptionalPropertyTypes: true` throughout the monorepo.

---

## Synthetic Mapping Templates

### SITS-style (`mappings/sits.ts`)

Maps the following SITS-style fields to canonical import contracts:

| SRS Field | SITS-style Source Field | Note |
|---|---|---|
| `legalFirstName` | `STU_FNAM` | |
| `legalFamilyName` | `STU_SURN` | |
| `hesaId` | `STU_HESA` | HESA Person Identifier |
| `statusCode` | `SCJ_STA1` | Mapped via `SITS_STATUS_MAP` |
| `modeOfStudyCode` | `SCJ_MODE` | `FT`→`full-time`, `PT`→`part-time`, etc. |
| `academicYearOfEntry` | `SCJ_AYOE` | Normalised from `2024/25` → `2024-25` |

**IP constraint notice** present at top of file. Field names derived from
public HESA Student Record documentation only.

### Banner-style (`mappings/banner.ts`)

Maps the following Banner-style fields to canonical import contracts:

| SRS Field | Banner-style Source Field | Note |
|---|---|---|
| `externalId` | `spriden_pidm` | PIDM as string |
| `studentNumber` | `spriden_id` | Institution-assigned ID |
| `legalFirstName` | `spriden_first_name` | |
| `legalFamilyName` | `spriden_last_name` | |
| `academicYearOfEntry` | `sgbstdn_term_code_eff` | Derived from 6-digit term code |
| `modeOfStudyCode` | `sgbstdn_blck_code` | `F`→`full-time`, `P`→`part-time`, etc. |

**IP constraint notice** present at top of file. Field names derived from
Ellucian Banner Student Integration API Guide (public documentation) only.

---

## Validation Engine

The validation engine (`src/validation/index.ts`) checks all six import phases:

| Check Category | Severity | Examples |
|---|---|---|
| Missing required fields | error | `legalFirstName` absent |
| Duplicate externalIds | error | Two persons with same `externalId` |
| Unresolved references | error | Enrolment references unknown person |
| Bitemporal window violations | error | `expectedEndDate ≤ startDate` |
| Value-set mapping failures | warning | Unknown `statusCode` or `modeOfStudyCode` |
| Special-category data | warning/info | `ethnicityCode` present; adjustment records |

The validation report includes:
- Per-entity record counts (source/loaded/failed)
- All issues with severity, entity type, and external ID
- Summary (hasErrors, errorCount, warningCount, infoCount)

---

## Import Phase Order

```
Phase 1  identity         persons + addresses
Phase 2  catalogue        programmes + modules + module offerings
Phase 3  enrolments
Phase 4  registrations    module registrations
Phase 5  assessment       marks (assessment component stubs created as needed)
Phase 6  adjustments      reasonable adjustments + exceptional circumstances
```

All phases run within a single database transaction; failure causes full rollback.
Pre-import validation prevents the import running if any `error`-severity issue exists.

---

## Integration Test Results

### SITS Migration — 16 tests

Fixture: `test/fixtures/sits-sample.json`  
Tenant ID: `00000000-0000-0000-0001-000000000001`

| Suite | Tests | Result |
|---|---|---|
| SITS mapping | 3 | ✓ Pass |
| SITS validation | 2 | ✓ Pass |
| SITS import | 11 | ✓ Pass |

**Record counts after live import:**

| Entity | Source | Loaded | Failed |
|---|---|---|---|
| persons | 3 | 3 | 0 |
| personIdentities | 3 | 3 | 0 |
| studentAddresses | 3 | 3 | 0 |
| programmes | 2 | 2 | 0 |
| modules | 3 | 3 | 0 |
| moduleOfferings | 3 | 3 | 0 |
| academicPeriods (stubs) | 2 | 2 | 0 |
| enrolments | 3 | 3 | 0 |
| moduleRegistrations | 3 | 3 | 0 |
| assessmentComponents (stubs) | 3 | 3 | 0 |
| marks | 3 | 3 | 0 |

**Additional assertions verified:**
- Graduated student `actualEndDate` set from `SCJ_ENDDT`
- `recorded_until IS NULL` for all bitemporal rows (current transaction)
- HESA ID propagated correctly from `STU_HESA`
- Academic year normalisation: `'2024/25'` → `'2024-25'`
- Dry-run writes zero rows

### Banner Migration — 13 tests

Fixture: `test/fixtures/banner-sample.json`  
Tenant ID: `00000000-0000-0000-0002-000000000001`

| Suite | Tests | Result |
|---|---|---|
| Banner mapping | 3 | ✓ Pass |
| Banner validation | 2 | ✓ Pass |
| Banner import | 8 | ✓ Pass |

**Record counts after live import:**

| Entity | Source | Loaded | Failed |
|---|---|---|---|
| persons | 2 | 2 | 0 |
| enrolments | 2 | 2 | 0 |
| moduleRegistrations | 3 | 3 | 0 |
| marks | 2 | 2 | 0 |

**Additional assertions verified:**
- Registration CRN10002 (no mark record) skipped without error — mark count is 2 not 3
- `raw_mark` 91.0 stored correctly
- Student number populated from `spriden_id` (Banner institution ID)
- Term code `202410` → academic year `2024-25`, period `2024-25:sem1`
- `recorded_until IS NULL` for all bitemporal rows

**Total: 29/29 integration tests passing.**

---

## IP Constraint Compliance

Both mapping templates carry the following statement (verbatim):

> This template is a SYNTHETIC EXAMPLE only. Field names and conventions are
> derived from publicly available documentation (HESA Student Record data items
> at hesa.ac.uk, and Ellucian Banner Student Integration API Guide). No
> proprietary schema structures, undocumented field names, or vendor-confidential
> information are reproduced here. This template demonstrates the MAPPING PATTERN
> and is NOT a certified production connector for SITS:Vision, Ellucian Banner,
> or any other vendor product. Institutions must validate all field mappings
> against their own system configuration.

This notice appears at the top of:
- `src/mappings/sits.ts`
- `src/mappings/banner.ts`
- `docs/migration-runbook.md § IP Constraint and Disclaimer`

---

## Exit Criteria Checklist

- [x] Synthetic SITS-style import validates and loads into a clean tenant
- [x] Synthetic Banner-style import validates and loads into a clean tenant
- [x] Migration validation reports are deterministic and suitable for institutional sign-off
- [x] IP constraint notice is present and accurate in all mapping templates and the runbook
- [x] `--dry-run` mode validates without writing any rows
- [x] Phase-ordered import respects dependency order (identity → catalogue → enrolments → …)
- [x] Referential integrity checks catch unresolved FK references
- [x] Bitemporal reconstruction checks validate window consistency
- [x] Privacy/special-category warnings emitted for disability and ethnicity data
- [x] All TypeScript checks pass under `exactOptionalPropertyTypes: true`
- [x] 29/29 integration tests pass

---

## Known Limitations

- **Awards**: Formal awards require an exam board ratification record; not
  imported automatically. Created via standard governance workflow post-import.
- **Audit history**: All entries recorded with `actorId = 'migration-import'`;
  prior audit history is not reconstructed.
- **One-time import**: No real-time sync capability; use integration adapters
  for continuous data exchange.
- **Certified connectors**: Templates are synthetic examples; institutions must
  validate against their own system configuration.
