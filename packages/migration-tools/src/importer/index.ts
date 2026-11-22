import type { Db } from '@revelation-srs/db';

import type { ImportPayload } from '../contracts/payload.js';
import { validatePayload, updateCounts, addIssues } from '../validation/index.js';
import type { ValidationReport } from '../validation/types.js';

import { IdMap } from './id-map.js';
import { ImportLog } from './import-log.js';
import {
  importIdentity,
  importCatalogue,
  importEnrolments,
  importRegistrations,
  importAssessment,
  importAdjustments,
} from './phases.js';

export interface ImportOptions {
  dryRun:   boolean;
  tenantId: string;
}

export interface ImportResult {
  report:  ValidationReport;
  idMap?:  IdMap;
}

/**
 * Run the full migration import for a given payload.
 *
 * Phases (in order):
 *   1. identity   — persons + addresses
 *   2. catalogue  — programmes, modules, module offerings
 *   3. enrolments
 *   4. registrations
 *   5. assessment — marks (awards are not auto-created; require exam board ratification)
 *   6. adjustments + exceptional circumstances
 *
 * With `dryRun: true`, validation runs but no rows are written to the database.
 * With `dryRun: false`, the import runs inside a single transaction, each row
 * in its own savepoint. A row the database refuses is not loaded, is counted
 * as failed and is reported as an error issue with the reason, and rows that
 * refer to it are reported as unresolved (BL-385); the rows that did load are
 * committed. Any other failure rolls the whole import back.
 */
export async function runImport(
  db: Db,
  payload: ImportPayload,
  opts: ImportOptions,
): Promise<ImportResult> {
  const report = validatePayload(payload, opts.tenantId, opts.dryRun);

  if (opts.dryRun) {
    return { report };
  }

  if (report.summary.hasErrors) {
    // Pre-import validation failed — do not write anything.
    return { report };
  }

  const idMap = new IdMap();
  const log = new ImportLog();

  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    await importIdentity(t, opts.tenantId, payload, idMap, log);
    await importCatalogue(t, opts.tenantId, payload, idMap, log);
    await importEnrolments(t, opts.tenantId, payload, idMap, log);
    await importRegistrations(t, opts.tenantId, payload, idMap, log);
    await importAssessment(t, opts.tenantId, payload, idMap, log);
    await importAdjustments(t, opts.tenantId, payload, idMap, log);
  });

  for (const entity of log.entities()) {
    const c = log.counts(entity);
    updateCounts(report, entity, c.loaded, c.failed);
  }
  addIssues(report, log.issues);

  return { report, idMap };
}
