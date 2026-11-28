/**
 * BL-385: the adjustment import carries the amount the previous system
 * recorded, under the same rules as the SRS's own write path, and a row the
 * database refuses is reported with its reason instead of being swallowed,
 * without aborting the rows around it.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDb, type Db } from '@revelation-srs/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ImportAdjustment, ImportPayload } from '../src/contracts/payload.js';
import { runImport } from '../src/importer/index.js';
import { validatePayload } from '../src/validation/index.js';

const TENANT_ID = '00000000-0000-0000-0001-000000000385';
const MIGRATIONS_DIR = new URL('../../../packages/db/migrations/', import.meta.url);

let container: StartedPostgreSqlContainer;
let db: Db;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').withDatabase('srs_migration_adj').start();
  db = createDb(container.getConnectionUri());
  const journal = JSON.parse(await readFile(fileURLToPath(new URL('meta/_journal.json', MIGRATIONS_DIR)), 'utf8')) as { entries: Array<{ tag: string }> };
  for (const { tag } of journal.entries) {
    await db.execute(sql.raw(await readFile(fileURLToPath(new URL(`${tag}.sql`, MIGRATIONS_DIR)), 'utf8')));
  }
  await db.execute(sql`INSERT INTO tenant (id, code, name, active) VALUES (${TENANT_ID}, 'ADJ-MIG', 'Adjustment migration test', true)`);
}, 120_000);

afterAll(async () => {
  await container.stop();
});

function person(externalId: string, studentNumber: string) {
  return { externalId, studentNumber, legalFirstName: 'Test', legalFamilyName: externalId };
}

function enrolment(externalId: string, personExternalId: string) {
  return {
    externalId, personExternalId, statusCode: 'enrolled', modeOfStudyCode: 'full-time',
    academicYearOfEntry: '2025-26', startDate: '2025-09-22',
  };
}

function adjustment(externalId: string, personExternalId: string, enrolmentExternalId: string, extra: Partial<ImportAdjustment> = {}) {
  return {
    externalId, personExternalId, enrolmentExternalId,
    adjustmentTypeCode: 'extra-time', scopeCode: 'exam', validFrom: '2025-09-22T00:00:00Z', ...extra,
  };
}

describe('adjustment amount validation', () => {
  it('refuses an amount the SRS would refuse, and warns on an unknown unit', () => {
    const payload: ImportPayload = {
      meta: { sourceSystem: 'test' },
      persons: [person('P1', 'A0001')],
      enrolments: [enrolment('E1', 'P1')],
      adjustments: [
        adjustment('ADJ-DAYS', 'P1', 'E1', { amount: { value: 3, unitCode: 'days' } }),
        adjustment('ADJ-ROOM', 'P1', 'E1', { adjustmentTypeCode: 'separate-room', amount: { value: 1, unitCode: 'days' } }),
        adjustment('ADJ-ZERO', 'P1', 'E1', { amount: { value: 0, unitCode: 'percent-of-duration' } }),
        adjustment('ADJ-OK', 'P1', 'E1', { amount: { value: 25, unitCode: 'percent-of-duration' } }),
        adjustment('ADJ-LOCAL', 'P1', 'E1', { adjustmentTypeCode: 'local-type', amount: { value: 2, unitCode: 'sessions' } }),
      ],
    };
    const report = validatePayload(payload, TENANT_ID, true);
    const invalid = report.issues.filter((i) => i.code === 'INVALID_VALUE').map((i) => [i.externalId, i.field]);
    expect(invalid).toEqual([
      ['ADJ-DAYS', 'amount.unitCode'],
      ['ADJ-ROOM', 'amount'],
      ['ADJ-ZERO', 'amount.value'],
    ]);
    expect(report.issues.some((i) => i.externalId === 'ADJ-LOCAL' && i.field === 'amount.unitCode' && i.severity === 'warning')).toBe(true);
    expect(report.issues.some((i) => i.externalId === 'ADJ-OK' && i.severity === 'error')).toBe(false);
  });
});

describe('adjustment import', () => {
  it('stores the amount, and reports a row the database refuses without losing the others', async () => {
    const payload: ImportPayload = {
      meta: { sourceSystem: 'legacy' },
      // P2 reuses P1's student number: validation cannot see it, the database refuses it.
      persons: [person('P1', 'A0001'), person('P2', 'A0001'), person('P3', 'A0003')],
      enrolments: [enrolment('E1', 'P1'), enrolment('E2', 'P2'), enrolment('E3', 'P3')],
      adjustments: [
        adjustment('ADJ-1', 'P1', 'E1', { amount: { value: 25, unitCode: 'percent-of-duration' } }),
        adjustment('ADJ-2', 'P2', 'E2', { amount: { value: 10, unitCode: 'minutes-per-hour' } }),
        adjustment('ADJ-3', 'P3', 'E3', { adjustmentTypeCode: 'separate-room' }),
      ],
    };
    expect(validatePayload(payload, TENANT_ID, true).summary.hasErrors).toBe(false);

    const { report } = await runImport(db, payload, { dryRun: false, tenantId: TENANT_ID });

    const counts = Object.fromEntries(report.recordCounts.map((c) => [c.entity, [c.loaded, c.failed]]));
    expect(counts.person).toEqual([2, 1]);
    expect(counts.enrolment).toEqual([2, 1]);
    expect(counts.adjustment).toEqual([2, 1]);
    expect(counts.exceptionalCircumstance).toEqual([0, 0]);

    const errors = report.issues.filter((i) => i.severity === 'error');
    expect(errors.map((i) => [i.code, i.entity, i.externalId])).toEqual([
      ['ROW_LOAD_FAILURE', 'person', 'P2'],
      ['UNRESOLVED_REFERENCE', 'enrolment', 'E2'],
      ['UNRESOLVED_REFERENCE', 'adjustment', 'ADJ-2'],
    ]);
    expect(errors[0]?.message).toMatch(/person_tenant_student_number_unique.*SQLSTATE 23505/);
    // The report holds the reason, never the statement's values.
    expect(errors[0]?.message).not.toMatch(/Failed query|insert into/i);
    expect(report.summary).toMatchObject({ hasErrors: true, errorCount: 3 });

    // Everything after the refused row was committed.
    const rows = await db.execute<{ ref: string; amount_value: string | null; amount_unit_code: string | null; provenance_code: string }>(sql`
      SELECT migration_source_reference AS ref, amount_value, amount_unit_code, provenance_code
      FROM reasonable_adjustment WHERE tenant_id = ${TENANT_ID} ORDER BY migration_source_reference`);
    expect(rows.map((r) => ({ ...r }))).toEqual([
      { ref: 'legacy:ADJ-1', amount_value: '25.00', amount_unit_code: 'percent-of-duration', provenance_code: 'migrated' },
      { ref: 'legacy:ADJ-3', amount_value: null, amount_unit_code: null, provenance_code: 'migrated' },
    ]);
    const persons = await db.execute<{ n: string }>(sql`SELECT count(*) AS n FROM person WHERE tenant_id = ${TENANT_ID}`);
    expect(Number(persons[0]?.n)).toBe(2);
  });
});

describe('adjustment migration batch (ADR-033 item 7)', () => {
  it('records the given batch on every imported adjustment, or generates one, and returns it', async () => {
    const given = '0c6c1f3e-6a43-4d1b-9a55-6b2d1c0e7a11';
    const payload: ImportPayload = {
      meta: { sourceSystem: 'sits' },
      persons: [person('B1', 'B0001'), person('B2', 'B0002')],
      enrolments: [enrolment('BE1', 'B1'), enrolment('BE2', 'B2')],
      adjustments: [adjustment('BADJ-1', 'B1', 'BE1'), adjustment('BADJ-2', 'B2', 'BE2')],
    };
    const first = await runImport(db, payload, { dryRun: false, tenantId: TENANT_ID, batchId: given });
    expect(first.adjustmentBatchId).toBe(given);
    const rows = await db.execute<{ batch: string; ref: string }>(sql`
      SELECT migration_batch_id AS batch, migration_source_reference AS ref FROM reasonable_adjustment
      WHERE tenant_id = ${TENANT_ID} AND migration_source_reference LIKE 'sits:BADJ-%' ORDER BY 2`);
    expect(rows.map((r) => ({ ...r }))).toEqual([{ batch: given, ref: 'sits:BADJ-1' }, { batch: given, ref: 'sits:BADJ-2' }]);
    // No distributions until the batch is released.
    const dist = await db.execute<{ n: string }>(sql`SELECT count(*) AS n FROM adjustment_distribution d
      JOIN reasonable_adjustment a ON a.id = d.adjustment_id WHERE a.migration_batch_id = ${given}`);
    expect(Number(dist[0]?.n)).toBe(0);

    const second = await runImport(db, {
      meta: { sourceSystem: 'sits' }, persons: [person('B3', 'B0003')], enrolments: [enrolment('BE3', 'B3')],
      adjustments: [adjustment('BADJ-3', 'B3', 'BE3')],
    }, { dryRun: false, tenantId: TENANT_ID });
    expect(second.adjustmentBatchId).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.adjustmentBatchId).not.toBe(given);
  });
});

