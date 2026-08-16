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
  await applyMigration(db, '0000_platform_foundations.sql');
  await applyMigration(db, '0001_platform_hardening_and_refinements.sql');
  await applyMigration(db, '0002_demo_performance_and_seed_data.sql');
  await applyMigration(db, '0003_engagement_and_attendance.sql');
  await applyMigration(db, '0004_business_process_foundations.sql');
  await applyMigration(db, '0005_module_selection_rules.sql');
  await applyMigration(db, '0006_registration_window.sql');
  await applyMigration(db, '0007_module_registration_change_workflow.sql');
  await applyMigration(db, '0008_slc_submission_approval_workflow.sql');
  await applyMigration(db, '0009_legal_identity_change_workflow.sql');
  await applyMigration(db, '0010_hesa_submission_approval_workflow.sql');
  await applyMigration(db, '0011_ofs_extract_generation_workflow.sql');
  await applyMigration(db, '0012_ucas_confirmation_submission_workflow.sql');
  await applyMigration(db, '0013_ukvi_cas_submission_workflow.sql');
  await applyMigration(db, '0014_pgr_foundation.sql');
  await applyMigration(db, '0015_pgr_supervision.sql');
  await applyMigration(db, '0016_pgr_progress_review.sql');
  await applyMigration(db, '0017_pgr_thesis_examination.sql');
  await applyMigration(db, '0018_pgr_completion_and_research_award.sql');
  await applyMigration(db, '0019_partner_systems_contracts.sql');
  await applyMigration(db, '0020_reasonable_adjustment_source_case.sql');
  await applyMigration(db, '0021_adjustment_outcome_documents.sql');

  // Wellbeing module schema (separate pgSchema 'wellbeing' in same database)
  await applyMigration(db, '0000_wellbeing_foundations.sql', WELLBEING_MIGRATIONS_DIR);
  await applyMigration(db, '0001_adjustment_production_hardening.sql', WELLBEING_MIGRATIONS_DIR);
}
