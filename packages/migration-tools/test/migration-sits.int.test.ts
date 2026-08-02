import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDb, type Db } from '@revelation-srs/db';
import { sql } from 'drizzle-orm';

import { mapSitsToImportPayload, type SitsExport } from '../src/mappings/sits.js';
import { validatePayload } from '../src/validation/index.js';
import { runImport } from '../src/importer/index.js';

const TENANT_ID = '00000000-0000-0000-0001-000000000001';

async function applyMigration(db: Db, fileName: string): Promise<void> {
  const dir = new URL('../../../packages/db/migrations/', import.meta.url);
  const content = await readFile(fileURLToPath(new URL(fileName, dir)), 'utf8');
  await db.execute(sql.raw(content));
}

let container: StartedPostgreSqlContainer;
let db: Db;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('srs_migration_test')
    .start();
  db = createDb(container.getConnectionUri());

  await applyMigration(db, '0000_platform_foundations.sql');
  await applyMigration(db, '0001_platform_hardening_and_refinements.sql');
  await applyMigration(db, '0002_demo_performance_and_seed_data.sql');

  await db.execute(sql`
    INSERT INTO tenant (id, code, name, active)
    VALUES (${TENANT_ID}, 'SITS-TEST', 'SITS Migration Test Tenant', true)
  `);
}, 120_000);

afterAll(async () => {
  await container.stop();
});

describe('SITS migration — mapping', () => {
  it('maps a SITS fixture to a valid ImportPayload', async () => {
    const fixture = JSON.parse(
      await readFile(new URL('./fixtures/sits-sample.json', import.meta.url), 'utf8'),
    ) as SitsExport;

    const payload = mapSitsToImportPayload(fixture);

    expect(payload.meta.sourceSystem).toBe('sits-synthetic');
    expect(payload.persons).toHaveLength(3);
    expect(payload.programmes).toHaveLength(2);
    expect(payload.modules).toHaveLength(3);
    expect(payload.moduleOfferings).toHaveLength(3);
    expect(payload.enrolments).toHaveLength(3);
    expect(payload.moduleRegistrations).toHaveLength(3);
    expect(payload.marks).toHaveLength(3);
  });

  it('normalises SITS academic year format from 2024/25 to 2024-25', async () => {
    const fixture = JSON.parse(
      await readFile(new URL('./fixtures/sits-sample.json', import.meta.url), 'utf8'),
    ) as SitsExport;

    const payload = mapSitsToImportPayload(fixture);

    for (const enr of payload.enrolments ?? []) {
      expect(enr.academicYearOfEntry).toMatch(/^\d{4}-\d{2}$/);
    }
  });

  it('maps SITS status codes to SRS status codes', async () => {
    const fixture = JSON.parse(
      await readFile(new URL('./fixtures/sits-sample.json', import.meta.url), 'utf8'),
    ) as SitsExport;

    const payload = mapSitsToImportPayload(fixture);
    const statuses = new Set((payload.enrolments ?? []).map(e => e.statusCode));

    expect(statuses.has('enrolled')).toBe(true);
    expect(statuses.has('graduated')).toBe(true);
    // should never contain raw SITS codes like 'A' or 'G'
    expect(statuses.has('A')).toBe(false);
    expect(statuses.has('G')).toBe(false);
  });
});

describe('SITS migration — validation', () => {
  it('validates the SITS fixture with no errors', async () => {
    const fixture = JSON.parse(
      await readFile(new URL('./fixtures/sits-sample.json', import.meta.url), 'utf8'),
    ) as SitsExport;

    const payload = mapSitsToImportPayload(fixture);
    const report  = validatePayload(payload, TENANT_ID, true);

    expect(report.summary.hasErrors).toBe(false);
    expect(report.summary.errorCount).toBe(0);
    // Warnings are acceptable (e.g., unknown value-set codes extend via admin)
  });

  it('dry-run completes without writing any rows', async () => {
    const fixture = JSON.parse(
      await readFile(new URL('./fixtures/sits-sample.json', import.meta.url), 'utf8'),
    ) as SitsExport;

    const payload = mapSitsToImportPayload(fixture);
    const result = await runImport(db, payload, { dryRun: true, tenantId: TENANT_ID });

    expect(result.report.dryRun).toBe(true);
    expect(result.idMap).toBeUndefined();

    const rows = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*) as count FROM person WHERE tenant_id = ${TENANT_ID}`,
    );
    expect(Number(rows[0]?.count ?? '0')).toBe(0);
  });
});

describe('SITS migration — import', () => {
  it('imports all persons, enrolments, modules, and marks without errors', async () => {
    const fixture = JSON.parse(
      await readFile(new URL('./fixtures/sits-sample.json', import.meta.url), 'utf8'),
    ) as SitsExport;

    const payload = mapSitsToImportPayload(fixture);
    const result = await runImport(db, payload, { dryRun: false, tenantId: TENANT_ID });

    expect(result.report.summary.hasErrors).toBe(false);
    expect(result.idMap).toBeDefined();
  });

  it('creates 3 person rows in the DB', async () => {
    const rows = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*) as count FROM person WHERE tenant_id = ${TENANT_ID}`,
    );
    expect(Number(rows[0]?.count ?? '0')).toBe(3);
  });

  it('creates 3 person_identity rows in the DB', async () => {
    const rows = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*) as count FROM person_identity WHERE tenant_id = ${TENANT_ID}`,
    );
    expect(Number(rows[0]?.count ?? '0')).toBe(3);
  });

  it('creates person addresses correctly', async () => {
    const rows = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*) as count FROM student_address WHERE tenant_id = ${TENANT_ID}`,
    );
    // S001 has 2 addresses, S002 has 1, S003 has 0 → total 3
    expect(Number(rows[0]?.count ?? '0')).toBe(3);
  });

  it('creates 3 enrolment rows', async () => {
    const rows = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*) as count FROM enrolment WHERE tenant_id = ${TENANT_ID}`,
    );
    expect(Number(rows[0]?.count ?? '0')).toBe(3);
  });

  it('creates 3 module_registration rows', async () => {
    const rows = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*) as count FROM module_registration WHERE tenant_id = ${TENANT_ID}`,
    );
    expect(Number(rows[0]?.count ?? '0')).toBe(3);
  });

  it('creates 3 mark rows', async () => {
    const rows = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*) as count FROM mark WHERE tenant_id = ${TENANT_ID}`,
    );
    expect(Number(rows[0]?.count ?? '0')).toBe(3);
  });

  it('creates academic periods for each unique offering period code', async () => {
    const rows = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*) as count FROM academic_period WHERE tenant_id = ${TENANT_ID}`,
    );
    // sem1 and sem2 for 2024-25
    expect(Number(rows[0]?.count ?? '0')).toBeGreaterThanOrEqual(2);
  });

  it('creates assessment component stubs for marks', async () => {
    const rows = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*) as count FROM assessment_component WHERE tenant_id = ${TENANT_ID}`,
    );
    expect(Number(rows[0]?.count ?? '0')).toBeGreaterThan(0);
  });

  it('all person_identity rows have correct bitemporal state (recorded_until IS NULL)', async () => {
    const rows = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*) as count FROM person_identity WHERE tenant_id = ${TENANT_ID} AND recorded_until IS NOT NULL`,
    );
    expect(Number(rows[0]?.count ?? '0')).toBe(0);
  });

  it('graduated student has actualEndDate set on enrolment', async () => {
    const rows = await db.execute<{ actual_end_date: string | null; status_code: string }>(
      sql`SELECT actual_end_date, status_code FROM enrolment WHERE tenant_id = ${TENANT_ID} AND status_code = 'graduated'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.actual_end_date).not.toBeNull();
  });
});
