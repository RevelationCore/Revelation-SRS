import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  academicPeriods,
  academicRules,
  awardingBodies,
  createDb,
  featureFlags,
  moduleOfferings,
  modules,
  programmes,
  type Db,
} from '@revelation-srs/db';

import { BASELINE_MODULES, BASELINE_PROGRAMMES, programmeId, moduleId, awardingBodyId } from '../src/generators/curriculum.js';
import { academicPeriodId } from '../src/generators/calendar.js';
import { generateAcademicRules } from '../src/generators/tenant-config.js';
import { resetScenario } from '../src/reset.js';
import { manifest } from '../src/scenarios/curriculum-baseline.js';

const MIGRATIONS_DIR = new URL('../../db/migrations/', import.meta.url);
const DEMO_TENANT_ID = 'cb000000-0000-4000-8000-000000000001';

async function applyMigration(db: Db, fileName: string): Promise<void> {
  const sqlText = await readFile(
    fileURLToPath(new URL(fileName, MIGRATIONS_DIR)),
    'utf8',
  );
  await db.execute(sql.raw(sqlText));
}

async function applyAllMigrations(db: Db): Promise<void> {
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
}

let container: StartedPostgreSqlContainer;
let db: Db;
let loadMs: number;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('srs_curriculum_test')
    .start();

  db = createDb(container.getConnectionUri());
  await applyAllMigrations(db);

  // Deactivate seeded production-like environments so Gate 5 passes.
  await db.execute(sql`
    UPDATE deployment_environment SET active = false
    WHERE production_like = true
  `);

  // Create the demo tenant.
  await db.execute(sql`
    INSERT INTO tenant (id, code, name, active, demo_mode)
    VALUES (${DEMO_TENANT_ID}, 'CBDEMO', 'DEMO - Curriculum Baseline University', true, true)
  `);

  process.env['DEMO_DATA_ENABLED']  = 'true';
  process.env['DEMO_RESET_ALLOWED'] = 'true';

  const t0 = Date.now();
  await resetScenario({
    databaseUrl:  container.getConnectionUri(),
    tenantId:     DEMO_TENANT_ID,
    scenarioSlug: 'curriculum-baseline',
  });
  loadMs = Date.now() - t0;
}, 120_000);

afterAll(async () => {
  delete process.env['DEMO_DATA_ENABLED'];
  delete process.env['DEMO_RESET_ALLOWED'];
  await container.stop();
});

// ─── Load time ────────────────────────────────────────────────────────────────

describe('Curriculum Baseline load time', () => {
  it('loads within budget', () => {
    expect(loadMs).toBeLessThan(manifest.loadTimeBudgetMs);
  });
});

// ─── Academic periods ─────────────────────────────────────────────────────────

describe('Academic periods', () => {
  it('has 3 periods per academic year (9 total for 3 years)', async () => {
    const rows = await db
      .select({ id: academicPeriods.id })
      .from(academicPeriods)
      .where(eq(academicPeriods.tenantId, DEMO_TENANT_ID));
    expect(rows).toHaveLength(9);
  });

  it('period IDs are deterministic and stable', async () => {
    const expectedId = academicPeriodId(DEMO_TENANT_ID, '2024-25', 'AUTUMN');
    const rows = await db
      .select({ id: academicPeriods.id })
      .from(academicPeriods)
      .where(eq(academicPeriods.id, expectedId));
    expect(rows).toHaveLength(1);
  });

  it('all three term codes exist for each year', async () => {
    const rows = await db
      .select({ periodCode: academicPeriods.periodCode, academicYear: academicPeriods.academicYear })
      .from(academicPeriods)
      .where(eq(academicPeriods.tenantId, DEMO_TENANT_ID));
    const pairs = rows.map(r => `${r.academicYear}:${r.periodCode}`);
    for (const year of manifest.academicYears) {
      expect(pairs).toContain(`${year}:AUTUMN`);
      expect(pairs).toContain(`${year}:SPRING`);
      expect(pairs).toContain(`${year}:SUMMER`);
    }
  });
});

// ─── Awarding body ────────────────────────────────────────────────────────────

describe('Awarding body', () => {
  it('exists with the correct ID', async () => {
    const expectedId = awardingBodyId(DEMO_TENANT_ID);
    const rows = await db
      .select({ id: awardingBodies.id, code: awardingBodies.code })
      .from(awardingBodies)
      .where(eq(awardingBodies.id, expectedId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.code).toBe('DEMO-UNI');
  });
});

// ─── Programmes ───────────────────────────────────────────────────────────────

describe('Programmes', () => {
  it('has all baseline programmes', async () => {
    const rows = await db
      .select({ id: programmes.id })
      .from(programmes)
      .where(eq(programmes.tenantId, DEMO_TENANT_ID));
    // Each programme creates one current version (recordedUntil IS NULL)
    expect(rows.length).toBeGreaterThanOrEqual(BASELINE_PROGRAMMES.length);
  });

  it('BSCS programme has a deterministic ID', async () => {
    const expectedId = programmeId(DEMO_TENANT_ID, 'BSCS');
    const rows = await db
      .select({ id: programmes.id, code: programmes.code })
      .from(programmes)
      .where(eq(programmes.id, expectedId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.code).toBe('BSCS');
  });
});

// ─── Modules ──────────────────────────────────────────────────────────────────

describe('Modules', () => {
  it('has all baseline modules', async () => {
    const rows = await db
      .select({ id: modules.id })
      .from(modules)
      .where(eq(modules.tenantId, DEMO_TENANT_ID));
    expect(rows.length).toBeGreaterThanOrEqual(BASELINE_MODULES.length);
  });

  it('CS101 module has a deterministic ID', async () => {
    const expectedId = moduleId(DEMO_TENANT_ID, 'CS101');
    const rows = await db
      .select({ id: modules.id, code: modules.code })
      .from(modules)
      .where(eq(modules.id, expectedId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.code).toBe('CS101');
  });
});

// ─── Module offerings ─────────────────────────────────────────────────────────

describe('Module offerings', () => {
  it('has offerings for all modules across all years', async () => {
    const rows = await db
      .select({ id: moduleOfferings.id })
      .from(moduleOfferings)
      .where(eq(moduleOfferings.tenantId, DEMO_TENANT_ID));
    const expectedMin = BASELINE_MODULES.reduce(
      (n, m) => n + m.terms.length * manifest.academicYears.length, 0,
    );
    expect(rows.length).toBeGreaterThanOrEqual(expectedMin);
  });
});

// ─── Academic rules ───────────────────────────────────────────────────────────

describe('Academic rules', () => {
  it('has all generated rules', async () => {
    const expected = generateAcademicRules(DEMO_TENANT_ID);
    const rows = await db
      .select({ id: academicRules.id })
      .from(academicRules)
      .where(eq(academicRules.tenantId, DEMO_TENANT_ID));
    expect(rows.length).toBeGreaterThanOrEqual(expected.length);
  });

  it('undergraduate pass mark rule exists with correct value', async () => {
    const rows = await db
      .select({ ruleValue: academicRules.ruleValue })
      .from(academicRules)
      .where(eq(academicRules.tenantId, DEMO_TENANT_ID));
    const passMark = rows.find(
      r => (r.ruleValue)['mark'] === 40,
    );
    expect(passMark).toBeDefined();
  });
});

// ─── Feature flags ────────────────────────────────────────────────────────────

describe('Feature flags', () => {
  it('has all demo flags', async () => {
    const rows = await db
      .select({ id: featureFlags.id, flagKey: featureFlags.flagKey })
      .from(featureFlags)
      .where(sql`${featureFlags.flagKey} LIKE 'demo.%'`);
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });

  it('all demo flag display names start with DEMO -', async () => {
    const rows = await db
      .select({ displayName: featureFlags.displayName })
      .from(featureFlags)
      .where(sql`${featureFlags.flagKey} LIKE 'demo.%'`);
    for (const r of rows) {
      expect(r.displayName).toMatch(/^DEMO - /);
    }
  });
});

// ─── Idempotency ──────────────────────────────────────────────────────────────

describe('Idempotency', () => {
  it('second load does not raise and keeps programme count stable', async () => {
    const beforeRows = await db
      .select({ id: programmes.id })
      .from(programmes)
      .where(eq(programmes.tenantId, DEMO_TENANT_ID));

    await resetScenario({
      databaseUrl:  container.getConnectionUri(),
      tenantId:     DEMO_TENANT_ID,
      scenarioSlug: 'curriculum-baseline',
    });

    const afterRows = await db
      .select({ id: programmes.id })
      .from(programmes)
      .where(eq(programmes.tenantId, DEMO_TENANT_ID));

    expect(afterRows.length).toBe(beforeRows.length);
  });

  it('period IDs remain stable after second load', async () => {
    const expectedId = academicPeriodId(DEMO_TENANT_ID, '2025-26', 'SPRING');
    const rows = await db
      .select({ id: academicPeriods.id })
      .from(academicPeriods)
      .where(eq(academicPeriods.id, expectedId));
    expect(rows).toHaveLength(1);
  });
});
