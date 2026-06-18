import type { Db } from '@revelation-srs/db';

import type { ImportPayload } from '../contracts/payload.js';
import { validatePayload, updateCounts } from '../validation/index.js';
import type { ValidationReport } from '../validation/types.js';
import { IdMap } from './id-map.js';
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
 * With `dryRun: false`, the import runs inside a single transaction; any phase
 * failure causes a full rollback.
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

  await db.transaction(async (tx) => {
    const p1 = await importIdentity(tx as unknown as Db, opts.tenantId, payload, idMap);
    updateCounts(report, 'person', p1.loaded, p1.failed);

    const p2 = await importCatalogue(tx as unknown as Db, opts.tenantId, payload, idMap);
    updateCounts(report, 'programme',      p2.loaded, p2.failed);
    updateCounts(report, 'module',         p2.loaded, p2.failed);
    updateCounts(report, 'moduleOffering', p2.loaded, p2.failed);

    const p3 = await importEnrolments(tx as unknown as Db, opts.tenantId, payload, idMap);
    updateCounts(report, 'enrolment', p3.loaded, p3.failed);

    const p4 = await importRegistrations(tx as unknown as Db, opts.tenantId, payload, idMap);
    updateCounts(report, 'moduleRegistration', p4.loaded, p4.failed);

    const p5 = await importAssessment(tx as unknown as Db, opts.tenantId, payload, idMap);
    updateCounts(report, 'mark', p5.loaded, p5.failed);

    const p6 = await importAdjustments(tx as unknown as Db, opts.tenantId, payload, idMap);
    updateCounts(report, 'adjustment', p6.loaded, p6.failed);
    updateCounts(report, 'exceptionalCircumstance', p6.loaded, p6.failed);
  });

  return { report, idMap };
}
