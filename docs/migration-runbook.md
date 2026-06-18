# Data Migration Runbook — Revelation SRS

> Version: 1.0.0 (Phase 11 Stage 6)

---

## Overview

The `@revelation-srs/migration-tools` package provides tooling for institutions
migrating historical student records into Revelation SRS from existing SRS
platforms. It delivers:

- **Canonical import contracts** — TypeScript interfaces defining the agreed
  interchange format between source systems and the SRS importer.
- **Synthetic mapping templates** — example transformers for SITS-style and
  Banner-style exports (see IP constraint notice below).
- **Validation engine** — pre-import checks for referential integrity,
  bitemporal consistency, value-set mapping failures, and special-category
  data warnings.
- **Staged importer** — phase-ordered, transactional import with `--dry-run`
  support.
- **CLI** — `pnpm migrate:import` entry point.

---

## IP Constraint and Disclaimer

> **IMPORTANT — READ BEFORE USING MAPPING TEMPLATES**

The SITS-style and Banner-style mapping templates in
`packages/migration-tools/src/mappings/` are **synthetic examples only**.

- Field names and conventions are derived exclusively from **publicly available**
  documentation: the HESA Student Record data items (hesa.ac.uk), and Ellucian
  Banner Student Integration API Guide (publicly available).
- No proprietary schema structures, undocumented field names, or
  vendor-confidential information have been reproduced.
- These templates demonstrate the **mapping pattern** and are **not certified
  production connectors** for SITS:Vision, Ellucian Banner, or any other vendor
  product.
- Institutions must validate all field mappings against their own system
  configuration before using these templates in a live migration.

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 22+ |
| pnpm | 9+ |
| PostgreSQL | 16+ |
| Docker | 25+ (for integration tests) |
| DATABASE_URL | Required for actual import |

---

## Institutional Responsibilities

Before running a migration, the institution must:

1. **Confirm lawful basis** under UK GDPR Art 6(1)(e) or (f) for transferring
   student records between systems.
2. **Confirm lawful basis** for special-category data (disability, ethnicity)
   under Art 9(2)(b) or (f) if `adjustments`, `ethnicityCode`, or similar
   fields are included.
3. **Take a full database backup** before running any import.
4. **Review the dry-run validation report** and resolve all `error`-severity
   issues before proceeding with the live import.
5. **Review the privacy warnings** emitted for adjustments and ethnicity codes
   to confirm they are expected and lawful.
6. **Retain the import log** for your data processing audit trail.

---

## Import Phases

The importer loads data in the following phase order, mirroring the SRS domain
model dependencies:

| Phase | Name | Entities |
|---|---|---|
| 1 | identity | persons, addresses |
| 2 | catalogue | programmes, modules, module offerings |
| 3 | enrolments | enrolments |
| 4 | registrations | module registrations |
| 5 | assessment | marks |
| 6 | adjustments | reasonable adjustments, exceptional circumstances |

Each phase runs in a single database transaction. If any phase fails critically,
the transaction rolls back and no data is written.

---

## Workflow

### Step 1 — Prepare your source export

Export student data from your source system in the format supported by the
appropriate mapping template. For SITS-style or Banner-style systems, the
synthetic mapping templates provide a reference for the expected field structure.

Save the export as a JSON file, e.g. `export-2025-06-01.json`.

### Step 2 — Dry-run validation

```bash
DATABASE_URL=postgres://... \
  pnpm --filter '@revelation-srs/migration-tools' migrate:import \
  import \
  --source sits \
  --file export-2025-06-01.json \
  --tenant-id <your-tenant-uuid> \
  --dry-run
```

Or, to validate without needing a database connection:

```bash
pnpm --filter '@revelation-srs/migration-tools' migrate:import \
  validate \
  --source sits \
  --file export-2025-06-01.json \
  --tenant-id <your-tenant-uuid>
```

Review the validation report output. Resolve all `error`-severity issues before
proceeding. `warning`-severity issues should be reviewed; they typically indicate
unmapped value-set codes that will be imported as-is (and can be corrected via
the admin UI after import). `info`-severity messages are for awareness only.

### Step 3 — Run the import

```bash
DATABASE_URL=postgres://... \
  pnpm --filter '@revelation-srs/migration-tools' migrate:import \
  import \
  --source sits \
  --file export-2025-06-01.json \
  --tenant-id <your-tenant-uuid>
```

The import runs within a single transaction. If the process is interrupted, the
database returns to its pre-import state. Re-run the import from the beginning.

### Step 4 — Post-import verification

After a successful import:

1. Log into the admin interface and verify that students, enrolments, and
   module registrations appear as expected.
2. Check the validation report's record counts (source vs loaded) — any
   `failed` rows indicate records that were skipped due to unresolvable
   references; investigate each.
3. Run the demo validator (if applicable) or a custom integrity check against
   the imported tenant.
4. Retain the full CLI output as evidence of the migration.

---

## Validation Report

The validation report is printed to stdout after every run. It covers:

| Check | Severity | Description |
|---|---|---|
| Missing required fields | `error` | Required fields absent from a record |
| Duplicate external IDs | `error` | Two records with the same `externalId` |
| Unresolved references | `error` | FK reference to unknown parent (e.g. enrolment → unknown person) |
| Value-set mapping failures | `warning` | Status/mode/type code not in the SRS known-value set |
| Bitemporal window violations | `error` | `expectedEndDate` before `startDate`; `validTo` before `validFrom` |
| Special-category data | `warning` / `info` | Records containing disability or ethnicity data |

---

## Bitemporal Import Model

All bitemporal records (enrolments, module registrations, adjustments, marks,
etc.) are imported as **current state only**:

- `validFrom` = record's natural date (enrolment start date, registration date, etc.)
- `validTo` = null (ongoing) or the record's end date where applicable
- `recordedAt` = import timestamp
- `recordedUntil` = null (current transaction)

Historical state reconstruction (importing prior versions of records) is not
supported in the initial importer. Post-import corrections should be made
through the standard SRS admin correction workflow.

---

## Custom Source Systems

To import from a source system other than SITS-style or Banner-style, use
`--source raw` with a JSON file that already conforms to the `ImportPayload`
interface defined in `packages/migration-tools/src/contracts/payload.ts`.

You may also write a custom mapping function:

```typescript
import type { ImportPayload } from '@revelation-srs/migration-tools';

export function mapMySystem(sourceData: MySystemExport): ImportPayload {
  // Transform sourceData into ImportPayload
}
```

---

## Rollback

Since the import runs in a single transaction, an interrupted or failed import
leaves the database unchanged. There is no need for explicit rollback.

If the import completed successfully but the data is incorrect, restore from
the pre-import backup you took in Step 1. Do not attempt to undo a completed
import manually.

---

## Known Limitations

- **Awards not auto-imported**: Formal awards require an exam board ratification
  record which cannot be synthesised from source data. Awards should be created
  through the standard governance workflow after import, or created manually
  via the admin interface.
- **Audit history not imported**: The importer records all entries with
  `actorId = 'migration-import'`. Prior audit history is not reconstructed.
- **Not a real-time sync**: The migration tool is for one-time or periodic
  batch imports. For continuous data exchange, use the VLE integration adapter
  or equivalent.
- **No certified connector**: The SITS-style and Banner-style templates are
  synthetic examples. Institutions must validate all field mappings against
  their own system configuration.

---

## Support

For questions or issues with the migration tooling, open an issue at the
project repository. Include: the source system type, the CLI output, and
the first 10 lines of the validation report (redact any personal data).
