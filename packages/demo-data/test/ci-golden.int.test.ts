import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDb,
  enrolments,
  examBoards,
  persons,
  workflowInstances,
  workflowTasks,
  type Db,
} from '@revelation-srs/db';

import { GOLDEN_IDS } from '../src/golden-ids.js';
import { resetScenario } from '../src/reset.js';
import { manifest } from '../src/scenarios/ci-golden.js';

const MIGRATIONS_DIR = new URL('../../db/migrations/', import.meta.url);
const DEMO_TENANT_ID = 'dd000000-0000-4000-8000-000000000001';

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
  await applyMigration(db, '0024_phase11_performance_indexes.sql');
  await applyMigration(db, '0025_phase11_retention_anonymisation.sql');
  await applyMigration(db, '0026_phase11_notifications.sql');
  await applyMigration(db, '0027_valueset_picklists.sql');
  await applyMigration(db, '0028_valueset_correction_status.sql');
  await applyMigration(db, '0029_valueset_activefrom_nullable.sql');
  await applyMigration(db, '0030_seed_nationality_domicile.sql');
  await applyMigration(db, '0031_person_identity_pronouns.sql');
  await applyMigration(db, '0032_seed_fee_band_code.sql');
  await applyMigration(db, '0033_disability_declaration_notes.sql');
  await applyMigration(db, '0037_engagement_intervention.sql');
  await applyMigration(db, '0038_engagement_policy_alert_immutability.sql');
  await applyMigration(db, '0039_engagement_intervention_idempotency.sql');
  await applyMigration(db, '0040_ukvi_engagement_decision_boundary.sql');
}

let container: StartedPostgreSqlContainer;
let db: Db;
let loadMs: number;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('srs_golden_test')
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
    VALUES (${DEMO_TENANT_ID}, 'DEMO', 'DEMO - Demo University', true, true)
  `);

  // Set env vars required by the safety gates.
  process.env['DEMO_DATA_ENABLED']  = 'true';
  process.env['DEMO_RESET_ALLOWED'] = 'true';

  // Load the scenario and measure elapsed time.
  const t0 = Date.now();
  await resetScenario({
    databaseUrl:  container.getConnectionUri(),
    tenantId:     DEMO_TENANT_ID,
    scenarioSlug: 'ci-golden',
  });
  loadMs = Date.now() - t0;
}, 120_000);

afterAll(async () => {
  delete process.env['DEMO_DATA_ENABLED'];
  delete process.env['DEMO_RESET_ALLOWED'];
  await container.stop();
});

// ─── Load time ────────────────────────────────────────────────────────────────

describe('CI Golden Dataset load time', () => {
  it('loads in under 10 seconds', () => {
    expect(loadMs).toBeLessThan(manifest.loadTimeBudgetMs);
  });
});

// ─── Persons ─────────────────────────────────────────────────────────────────

describe('Persons', () => {
  it('has all four golden persons', async () => {
    const rows = await db
      .select({ id: persons.id, studentNumber: persons.studentNumber })
      .from(persons)
      .where(eq(persons.tenantId, DEMO_TENANT_ID));

    const ids = rows.map(r => r.id);
    expect(ids).toContain(GOLDEN_IDS.PERSON_ENROLLED);
    expect(ids).toContain(GOLDEN_IDS.PERSON_INTERMITTING);
    expect(ids).toContain(GOLDEN_IDS.PERSON_WITHDRAWN);
    expect(ids).toContain(GOLDEN_IDS.PERSON_GRADUATED);
  });

  it('person student numbers are stable', async () => {
    const row = await db
      .select({ studentNumber: persons.studentNumber })
      .from(persons)
      .where(eq(persons.id, GOLDEN_IDS.PERSON_ENROLLED))
      .limit(1);
    expect(row[0]?.studentNumber).toBe('S24000001');
  });
});

// ─── Enrolments ──────────────────────────────────────────────────────────────

describe('Enrolments', () => {
  const cases: [string, string][] = [
    [GOLDEN_IDS.ENROLMENT_ENROLLED,     'enrolled'],
    [GOLDEN_IDS.ENROLMENT_INTERMITTING, 'intermitting'],
    [GOLDEN_IDS.ENROLMENT_WITHDRAWN,    'withdrawn'],
    [GOLDEN_IDS.ENROLMENT_GRADUATED,    'graduated'],
  ];

  it.each(cases)('enrolment %s has statusCode "%s"', async (enrolmentId, expectedStatus) => {
    const rows = await db
      .select({ statusCode: enrolments.statusCode })
      .from(enrolments)
      .where(eq(enrolments.id, enrolmentId));

    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.statusCode).toBe(expectedStatus);
  });
});

// ─── Exam boards ─────────────────────────────────────────────────────────────

describe('Exam boards', () => {
  it('BOARD_SCHEDULED has no ratifiedAt and no quorum', async () => {
    const rows = await db
      .select({ ratifiedAt: examBoards.ratifiedAt, quorumCount: examBoards.quorumCount })
      .from(examBoards)
      .where(eq(examBoards.id, GOLDEN_IDS.BOARD_SCHEDULED));

    expect(rows[0]?.ratifiedAt).toBeNull();
    expect(rows[0]?.quorumCount).toBeNull();
  });

  it('BOARD_OPEN has quorum but no ratifiedAt', async () => {
    const rows = await db
      .select({ ratifiedAt: examBoards.ratifiedAt, quorumCount: examBoards.quorumCount })
      .from(examBoards)
      .where(eq(examBoards.id, GOLDEN_IDS.BOARD_OPEN));

    expect(rows[0]?.ratifiedAt).toBeNull();
    expect(rows[0]?.quorumCount).toBe(5);
  });

  it('BOARD_RATIFIED has ratifiedAt set', async () => {
    const rows = await db
      .select({ ratifiedAt: examBoards.ratifiedAt })
      .from(examBoards)
      .where(eq(examBoards.id, GOLDEN_IDS.BOARD_RATIFIED));

    expect(rows[0]?.ratifiedAt).not.toBeNull();
  });
});

// ─── Workflow ─────────────────────────────────────────────────────────────────

describe('Workflow instances', () => {
  const cases: [string, string][] = [
    [GOLDEN_IDS.WORKFLOW_INSTANCE_PENDING,   'pending'],
    [GOLDEN_IDS.WORKFLOW_INSTANCE_ACTIVE,    'in-progress'],
    [GOLDEN_IDS.WORKFLOW_INSTANCE_COMPLETED, 'completed'],
  ];

  it.each(cases)('instance %s has statusCode "%s"', async (instanceId, expectedStatus) => {
    const rows = await db
      .select({ statusCode: workflowInstances.statusCode })
      .from(workflowInstances)
      .where(eq(workflowInstances.id, instanceId));

    expect(rows[0]?.statusCode).toBe(expectedStatus);
  });
});

describe('Workflow tasks', () => {
  const cases: [string, string][] = [
    [GOLDEN_IDS.WORKFLOW_TASK_PENDING, 'pending'],
    [GOLDEN_IDS.WORKFLOW_TASK_CLAIMED, 'in-progress'],
    [GOLDEN_IDS.WORKFLOW_TASK_DONE,    'completed'],
  ];

  it.each(cases)('task %s has statusCode "%s"', async (taskId, expectedStatus) => {
    const rows = await db
      .select({ statusCode: workflowTasks.statusCode })
      .from(workflowTasks)
      .where(eq(workflowTasks.id, taskId));

    expect(rows[0]?.statusCode).toBe(expectedStatus);
  });
});

// ─── Idempotency ──────────────────────────────────────────────────────────────

describe('Idempotency', () => {
  it('loading the scenario twice does not produce errors', async () => {
    await expect(
      resetScenario({
        databaseUrl:  container.getConnectionUri(),
        tenantId:     DEMO_TENANT_ID,
        scenarioSlug: 'ci-golden',
      }),
    ).resolves.toBeUndefined();
  });

  it('person count remains stable after second load', async () => {
    const rows = await db
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.tenantId, DEMO_TENANT_ID));
    expect(rows.length).toBe(4);
  });
});
