import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDb, type Db } from '@revelation-srs/db';
import { sql } from 'drizzle-orm';

import { mapBannerToImportPayload, type BannerExport } from '../src/mappings/banner.js';
import { validatePayload } from '../src/validation/index.js';
import { runImport } from '../src/importer/index.js';

const TENANT_ID = '00000000-0000-0000-0002-000000000001';

async function applyMigration(db: Db, fileName: string): Promise<void> {
  const dir = new URL('../../../packages/db/migrations/', import.meta.url);
  const content = await readFile(fileURLToPath(new URL(fileName, dir)), 'utf8');
  await db.execute(sql.raw(content));
}

let container: StartedPostgreSqlContainer;
let db: Db;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('srs_migration_banner_test')
    .start();
  db = createDb(container.getConnectionUri());

  await applyMigration(db, '0000_initial_platform_schema.sql');
  await applyMigration(db, '0001_seed_value_sets.sql');
  await applyMigration(db, '0002_phase4_domain_schema.sql');
  await applyMigration(db, '0003_seed_phase4_field_mappings.sql');
  await applyMigration(db, '0004_phase5_assessment_schema.sql');
  await applyMigration(db, '0005_seed_phase5_field_mappings.sql');
  await applyMigration(db, '0006_phase6_regulatory_schema.sql');
  await applyMigration(db, '0007_seed_phase6_field_mappings.sql');
  await applyMigration(db, '0008_phase6_remediation.sql');
  await applyMigration(db, '0009_platform_workflow_feature_flags.sql');
  await applyMigration(db, '0010_relax_extensible_code_checks.sql');
  await applyMigration(db, '0011_environment_promotion_hardening.sql');
  await applyMigration(db, '0012_globalisation_foundation.sql');
  await applyMigration(db, '0013_workflow_coverage_matrix.sql');
  await applyMigration(db, '0014_stage3_assessment_grade_progression.sql');
  await applyMigration(db, '0015_stage4_exam_board_governance.sql');
  await applyMigration(db, '0016_stage5_admissions_communications.sql');
  await applyMigration(db, '0017_stage6_flag_governance.sql');
  await applyMigration(db, '0018_stage7_legacy_removal.sql');
  await applyMigration(db, '0019_phase7_integration_registry.sql');
  await applyMigration(db, '0020_phase7_contract_deprecation.sql');
  await applyMigration(db, '0021_phase9_vle_contracts.sql');
  await applyMigration(db, '0022_demo_tenant_mode.sql');
  await applyMigration(db, '0023_demo_status_checkpoint.sql');
  await applyMigration(db, '0024_phase11_performance_indexes.sql');
  await applyMigration(db, '0025_phase11_retention_anonymisation.sql');
  await applyMigration(db, '0026_phase11_notifications.sql');

  await db.execute(sql`
    INSERT INTO tenant (id, code, name, active)
    VALUES (${TENANT_ID}, 'BANNER-TEST', 'Banner Migration Test Tenant', true)
  `);
}, 120_000);

afterAll(async () => {
  await container.stop();
});

describe('Banner migration — mapping', () => {
  it('maps a Banner fixture to a valid ImportPayload', async () => {
    const fixture = JSON.parse(
      await readFile(new URL('./fixtures/banner-sample.json', import.meta.url), 'utf8'),
    ) as BannerExport;

    const payload = mapBannerToImportPayload(fixture);

    expect(payload.meta.sourceSystem).toBe('banner-synthetic');
    expect(payload.persons).toHaveLength(2);
    expect(payload.programmes).toHaveLength(2);
    expect(payload.modules).toHaveLength(3);
    expect(payload.moduleOfferings).toHaveLength(3);
    expect(payload.enrolments).toHaveLength(2);
    expect(payload.moduleRegistrations).toHaveLength(3);
    expect(payload.marks).toHaveLength(2);  // only 2 registrations have mark_percentage set
  });

  it('derives academic year correctly from Banner term codes', async () => {
    const fixture = JSON.parse(
      await readFile(new URL('./fixtures/banner-sample.json', import.meta.url), 'utf8'),
    ) as BannerExport;

    const payload = mapBannerToImportPayload(fixture);

    // term 202410 (autumn 2024) → academic year 2024-25
    const autumn = payload.enrolments?.find(e => e.academicYearOfEntry === '2024-25');
    expect(autumn).toBeDefined();

    // term 202310 (autumn 2023) → academic year 2023-24
    const prev = payload.enrolments?.find(e => e.academicYearOfEntry === '2023-24');
    expect(prev).toBeDefined();
  });

  it('maps Banner PIDM as externalId (string)', async () => {
    const fixture = JSON.parse(
      await readFile(new URL('./fixtures/banner-sample.json', import.meta.url), 'utf8'),
    ) as BannerExport;

    const payload = mapBannerToImportPayload(fixture);

    for (const p of payload.persons) {
      expect(typeof p.externalId).toBe('string');
    }
  });
});

describe('Banner migration — validation', () => {
  it('validates the Banner fixture with no errors', async () => {
    const fixture = JSON.parse(
      await readFile(new URL('./fixtures/banner-sample.json', import.meta.url), 'utf8'),
    ) as BannerExport;

    const payload = mapBannerToImportPayload(fixture);
    const report  = validatePayload(payload, TENANT_ID, true);

    expect(report.summary.hasErrors).toBe(false);
  });

  it('dry-run produces record count summary without writing', async () => {
    const fixture = JSON.parse(
      await readFile(new URL('./fixtures/banner-sample.json', import.meta.url), 'utf8'),
    ) as BannerExport;

    const payload = mapBannerToImportPayload(fixture);
    const result  = await runImport(db, payload, { dryRun: true, tenantId: TENANT_ID });

    expect(result.report.dryRun).toBe(true);
    const personCount = result.report.recordCounts.find(c => c.entity === 'person');
    expect(personCount?.source).toBe(2);

    // Nothing written
    const rows = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*) as count FROM person WHERE tenant_id = ${TENANT_ID}`,
    );
    expect(Number(rows[0]?.count ?? '0')).toBe(0);
  });
});

describe('Banner migration — import', () => {
  it('imports all Banner data without errors', async () => {
    const fixture = JSON.parse(
      await readFile(new URL('./fixtures/banner-sample.json', import.meta.url), 'utf8'),
    ) as BannerExport;

    const payload = mapBannerToImportPayload(fixture);
    const result  = await runImport(db, payload, { dryRun: false, tenantId: TENANT_ID });

    expect(result.report.summary.hasErrors).toBe(false);
    expect(result.idMap).toBeDefined();
  });

  it('creates 2 person rows', async () => {
    const rows = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*) as count FROM person WHERE tenant_id = ${TENANT_ID}`,
    );
    expect(Number(rows[0]?.count ?? '0')).toBe(2);
  });

  it('creates 2 enrolment rows', async () => {
    const rows = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*) as count FROM enrolment WHERE tenant_id = ${TENANT_ID}`,
    );
    expect(Number(rows[0]?.count ?? '0')).toBe(2);
  });

  it('creates 3 module_registration rows', async () => {
    const rows = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*) as count FROM module_registration WHERE tenant_id = ${TENANT_ID}`,
    );
    expect(Number(rows[0]?.count ?? '0')).toBe(3);
  });

  it('creates 2 mark rows (registrations without marks are skipped)', async () => {
    const rows = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*) as count FROM mark WHERE tenant_id = ${TENANT_ID}`,
    );
    expect(Number(rows[0]?.count ?? '0')).toBe(2);
  });

  it('imported person has correct student number from Banner ID', async () => {
    const rows = await db.execute<{ student_number: string }>(
      sql`SELECT student_number FROM person WHERE tenant_id = ${TENANT_ID} ORDER BY created_at LIMIT 1`,
    );
    expect(rows[0]?.student_number).toBe('B10001');
  });

  it('all enrolment bitemporal rows have recorded_until IS NULL (current)', async () => {
    const rows = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*) as count FROM enrolment WHERE tenant_id = ${TENANT_ID} AND recorded_until IS NOT NULL`,
    );
    expect(Number(rows[0]?.count ?? '0')).toBe(0);
  });

  it('mark raw_mark values are stored correctly', async () => {
    const rows = await db.execute<{ raw_mark: string }>(
      sql`SELECT raw_mark FROM mark WHERE tenant_id = ${TENANT_ID} ORDER BY raw_mark DESC LIMIT 1`,
    );
    // Highest mark in fixture is 91.0
    expect(parseFloat(rows[0]?.raw_mark ?? '0')).toBe(91.0);
  });
});
