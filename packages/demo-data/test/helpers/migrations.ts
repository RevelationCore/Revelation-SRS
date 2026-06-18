import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';
import type { Db } from '@revelation-srs/db';

const MIGRATIONS_DIR          = new URL('../../../db/migrations/', import.meta.url);
const WELLBEING_MIGRATIONS_DIR = new URL('../../../../modules/wellbeing/migrations/', import.meta.url);

async function applyMigration(db: Db, fileName: string, baseDir: URL = MIGRATIONS_DIR): Promise<void> {
  const sqlText = await readFile(
    fileURLToPath(new URL(fileName, baseDir)),
    'utf8',
  );
  await db.execute(sql.raw(sqlText));
}

export async function applyAllMigrations(db: Db): Promise<void> {
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

  // Wellbeing module schema (separate pgSchema 'wellbeing' in same database)
  await applyMigration(db, '0001_wellbeing_initial.sql',           WELLBEING_MIGRATIONS_DIR);
  await applyMigration(db, '0002_wellbeing_event_log.sql',         WELLBEING_MIGRATIONS_DIR);
  await applyMigration(db, '0003_wellbeing_audit_log.sql',         WELLBEING_MIGRATIONS_DIR);
  await applyMigration(db, '0004_wellbeing_adjustment_workflow.sql', WELLBEING_MIGRATIONS_DIR);
  await applyMigration(db, '0005_wellbeing_ec_workflow.sql',       WELLBEING_MIGRATIONS_DIR);
  await applyMigration(db, '0006_wellbeing_mh_session_notes.sql',  WELLBEING_MIGRATIONS_DIR);
  await applyMigration(db, '0007_wellbeing_retention_sar.sql',     WELLBEING_MIGRATIONS_DIR);
}
